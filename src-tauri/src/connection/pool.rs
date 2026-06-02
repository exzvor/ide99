//! Per-connection deadpool-postgres pool registry.
//!
//! Pools are lazily created on first use, keyed by saved-connection id. The
//! free-form `test()` helper deliberately does NOT touch the pool: tests use
//! ephemeral, possibly-invalid credentials and pooling them would let bad
//! creds leak into later operations.

#![allow(
    clippy::missing_errors_doc,
    clippy::significant_drop_tightening,
    clippy::doc_markdown
)]

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use deadpool_postgres::{Manager, ManagerConfig, Pool, RecyclingMethod, Runtime};
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{ClientConfig, DigitallySignedStruct, RootCertStore, SignatureScheme};
use tokio::sync::Mutex;
use tokio_postgres::config::SslMode as PgSslMode;
use tokio_postgres::Config as PgConfig;
use tokio_postgres_rustls::MakeRustlsConnect;

use crate::connection::types::{Connection, ConnectionError, SslMode, TestInput, TestResult};

/// Marker for the rustls TLS connector flavor we want to build.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TlsFlavor {
    None,
    AcceptAny,
    VerifyCa,
    VerifyFull,
}

impl TlsFlavor {
    const fn from_ssl_mode(mode: SslMode) -> Self {
        match mode {
            SslMode::Disable => Self::None,
            SslMode::Allow | SslMode::Prefer | SslMode::Require => Self::AcceptAny,
            SslMode::VerifyCa => Self::VerifyCa,
            SslMode::VerifyFull => Self::VerifyFull,
        }
    }
}

/// Map our richer SslMode to tokio-postgres's three-state (Disable/Prefer/Require).
/// `verify-ca` / `verify-full` collapse to `Require` because their stricter
/// guarantees live entirely in the rustls verifier, not in PG's own negotiation.
const fn pg_ssl_mode(mode: SslMode) -> PgSslMode {
    match mode {
        SslMode::Disable => PgSslMode::Disable,
        SslMode::Allow | SslMode::Prefer => PgSslMode::Prefer,
        SslMode::Require | SslMode::VerifyCa | SslMode::VerifyFull => PgSslMode::Require,
    }
}

pub struct PoolRegistry {
    pools: Mutex<HashMap<String, Pool>>,
}

impl PoolRegistry {
    #[must_use]
    pub fn new() -> Self {
        Self {
            pools: Mutex::new(HashMap::new()),
        }
    }

    fn pg_config(
        host: &str,
        port: u16,
        database: &str,
        username: &str,
        password: Option<&str>,
        mode: SslMode,
    ) -> PgConfig {
        let mut cfg = PgConfig::new();
        cfg.host(host)
            .port(port)
            .dbname(database)
            .user(username)
            .ssl_mode(pg_ssl_mode(mode))
            .connect_timeout(Duration::from_secs(10));
        if let Some(pw) = password {
            cfg.password(pw);
        }
        cfg
    }

    /// Get-or-create the pool for a saved connection.
    pub async fn get_or_init(
        &self,
        connection: &Connection,
        password: Option<&str>,
    ) -> Result<Pool, ConnectionError> {
        let mut guard = self.pools.lock().await;
        if let Some(pool) = guard.get(&connection.id) {
            return Ok(pool.clone());
        }
        let pool = build_pool(
            &connection.host,
            connection.port,
            &connection.database,
            &connection.username,
            password,
            connection.ssl_mode,
        )?;
        guard.insert(connection.id.clone(), pool.clone());
        Ok(pool)
    }

    /// One-shot connection test using free-form credentials. Bypasses the pool
    /// because callers may pass throwaway/invalid creds via the form.
    pub async fn test(&self, input: TestInput) -> Result<TestResult, ConnectionError> {
        let start = Instant::now();
        let cfg = Self::pg_config(
            &input.host,
            input.port,
            &input.database,
            &input.username,
            input.password.as_deref(),
            input.ssl_mode,
        );

        match run_probe(cfg, input.ssl_mode).await {
            Ok(version) => Ok(TestResult {
                ok: true,
                duration_ms: u64::try_from(start.elapsed().as_millis()).unwrap_or(u64::MAX),
                error: None,
                server_version: Some(version),
            }),
            Err(err) => {
                // Rewrite the cryptic "invalid configuration: password missing"
                // chain when the caller passed no password — the form Test
                // button + test_saved_connection both surface this when PG
                // requires auth and we didn't have a saved password to send.
                // Trust-auth setups never hit this branch (probe succeeds).
                let user_facing = if input.password.is_none() && err.contains("password missing") {
                    "password not set — enter the password and retry the test".to_string()
                } else {
                    err
                };
                Ok(TestResult {
                    ok: false,
                    duration_ms: u64::try_from(start.elapsed().as_millis()).unwrap_or(u64::MAX),
                    error: Some(user_facing),
                    server_version: None,
                })
            }
        }
    }

    /// One-shot enumeration of databases reachable with the given free-form
    /// credentials. Connects to a maintenance DB (`postgres`, falling back to
    /// `template1`) rather than the typed `database`, so it works even when the
    /// user mistyped the target DB name — the whole point of the "browse
    /// databases" affordance. Bypasses the pool.
    pub async fn list_databases(&self, input: TestInput) -> Result<Vec<String>, ConnectionError> {
        let mut last_err: Option<String> = None;
        for maint_db in ["postgres", "template1"] {
            let cfg = Self::pg_config(
                &input.host,
                input.port,
                maint_db,
                &input.username,
                input.password.as_deref(),
                input.ssl_mode,
            );
            match probe_databases(cfg, input.ssl_mode).await {
                Ok(dbs) => return Ok(dbs),
                Err(err) => last_err = Some(err),
            }
        }
        // Mirror `test()`'s password-missing rewrite so a blank password on a
        // password-required server surfaces an actionable message.
        let err = last_err.unwrap_or_else(|| "could not list databases".to_string());
        let user_facing = if input.password.is_none() && err.contains("password missing") {
            "password not set — enter the password and retry".to_string()
        } else {
            err
        };
        Err(ConnectionError::Postgres(user_facing))
    }

    /// Idempotent — closing an absent pool is a no-op so retries are safe.
    pub async fn evict(&self, connection_id: &str) {
        let mut guard = self.pools.lock().await;
        if let Some(pool) = guard.remove(connection_id) {
            pool.close();
        }
    }

    /// Lookup the pool for a connection id without creating it. Returns a
    /// cloned `Pool` handle (deadpool-postgres pools are cheap `Arc` clones)
    /// or `None` if the connection has not been opened. Schema commands call
    /// this to decide whether to fail with `NotConnected`.
    pub async fn get(&self, connection_id: &str) -> Option<Pool> {
        let guard = self.pools.lock().await;
        guard.get(connection_id).cloned()
    }

    /// Insert a freshly-built pool. Replaces any existing entry (and closes
    /// the old one) so reconnect after credential change does the right thing.
    pub async fn insert(&self, connection_id: &str, pool: Pool) {
        let mut guard = self.pools.lock().await;
        if let Some(old) = guard.insert(connection_id.to_string(), pool) {
            old.close();
        }
    }

    /// Drop the pool for `connection_id` and remove it from the registry.
    /// Idempotent: closing an absent pool is a no-op so disconnect retries
    /// are safe. Currently behaves identically to `evict` but the name
    /// matches the public `connection_disconnect` Tauri command verb.
    pub async fn close(&self, connection_id: &str) {
        self.evict(connection_id).await;
    }

    /// Build a pool for a saved connection without inserting it. Pool
    /// construction is offline (no TCP yet) — failures here come from invalid
    /// config or TLS-stack init, not from the remote server. Used by
    /// `connection_connect` so the call site can run a validation probe before
    /// committing the pool to the registry.
    pub fn build_for(
        connection: &Connection,
        password: Option<&str>,
    ) -> Result<Pool, ConnectionError> {
        build_pool(
            &connection.host,
            connection.port,
            &connection.database,
            &connection.username,
            password,
            connection.ssl_mode,
        )
    }
}

impl Default for PoolRegistry {
    fn default() -> Self {
        Self::new()
    }
}

fn build_pool(
    host: &str,
    port: u16,
    database: &str,
    username: &str,
    password: Option<&str>,
    mode: SslMode,
) -> Result<Pool, ConnectionError> {
    let pg_cfg = PoolRegistry::pg_config(host, port, database, username, password, mode);
    let manager_cfg = ManagerConfig {
        recycling_method: RecyclingMethod::Fast,
    };

    let manager = match TlsFlavor::from_ssl_mode(mode) {
        TlsFlavor::None => Manager::from_config(pg_cfg, tokio_postgres::NoTls, manager_cfg),
        flavor => Manager::from_config(pg_cfg, build_tls_connector(flavor)?, manager_cfg),
    };

    Pool::builder(manager)
        .max_size(4)
        .runtime(Runtime::Tokio1)
        .build()
        .map_err(|e| ConnectionError::Postgres(format!("failed to build pool: {e}")))
}

async fn run_probe(cfg: PgConfig, mode: SslMode) -> Result<String, String> {
    match TlsFlavor::from_ssl_mode(mode) {
        TlsFlavor::None => {
            let (client, conn) = cfg
                .connect(tokio_postgres::NoTls)
                .await
                .map_err(|e| format_error_chain(&e))?;
            tokio::spawn(conn);
            fetch_version(&client).await
        }
        flavor => {
            let tls = build_tls_connector(flavor).map_err(|e| e.to_string())?;
            let (client, conn) = cfg.connect(tls).await.map_err(|e| format_error_chain(&e))?;
            tokio::spawn(conn);
            fetch_version(&client).await
        }
    }
}

async fn fetch_version(client: &tokio_postgres::Client) -> Result<String, String> {
    let row = client
        .query_one("SELECT version()", &[])
        .await
        .map_err(|e| format_error_chain(&e))?;
    let v: String = row.try_get(0).map_err(|e| format_error_chain(&e))?;
    Ok(v)
}

/// Connect with the given config + TLS mode, then enumerate databases. Mirrors
/// `run_probe`'s connect handling but runs the `pg_database` listing query.
async fn probe_databases(cfg: PgConfig, mode: SslMode) -> Result<Vec<String>, String> {
    match TlsFlavor::from_ssl_mode(mode) {
        TlsFlavor::None => {
            let (client, conn) = cfg
                .connect(tokio_postgres::NoTls)
                .await
                .map_err(|e| format_error_chain(&e))?;
            tokio::spawn(conn);
            fetch_databases(&client).await
        }
        flavor => {
            let tls = build_tls_connector(flavor).map_err(|e| e.to_string())?;
            let (client, conn) = cfg.connect(tls).await.map_err(|e| format_error_chain(&e))?;
            tokio::spawn(conn);
            fetch_databases(&client).await
        }
    }
}

async fn fetch_databases(client: &tokio_postgres::Client) -> Result<Vec<String>, String> {
    // Exclude template databases and any the role can't CONNECT to, so the list
    // matches what the user could actually open. Ordered for a stable UI.
    let rows = client
        .query(
            "SELECT datname FROM pg_database \
             WHERE datistemplate = false AND has_database_privilege(datname, 'CONNECT') \
             ORDER BY datname",
            &[],
        )
        .await
        .map_err(|e| format_error_chain(&e))?;
    rows.iter()
        .map(|r| {
            r.try_get::<_, String>(0)
                .map_err(|e| format_error_chain(&e))
        })
        .collect()
}

/// Walk an `std::error::Error` source chain and join Display messages with
/// `: ` separators. Without this, callers see the outermost wrapper only —
/// e.g. `tokio_postgres::Error{Kind::Config}` displays as `invalid
/// configuration` while the real cause (TLS handshake / auth / IO) lives in
/// `.source()`. Surfacing the chain is essential for diagnosing local-PG
/// failures where the wrapper is generic.
fn format_error_chain(err: &(dyn std::error::Error + 'static)) -> String {
    let mut parts = vec![err.to_string()];
    let mut cur = err.source();
    while let Some(c) = cur {
        let s = c.to_string();
        if parts.last().map(String::as_str) != Some(s.as_str()) {
            parts.push(s);
        }
        cur = c.source();
    }
    parts.join(": ")
}

fn build_tls_connector(flavor: TlsFlavor) -> Result<MakeRustlsConnect, ConnectionError> {
    // Install a default crypto provider once per process. Not fatal if a
    // different provider was already installed (e.g. by another crate).
    let _ = rustls::crypto::ring::default_provider().install_default();

    let config = match flavor {
        TlsFlavor::None => unreachable!("None flavor goes through NoTls path"),
        TlsFlavor::AcceptAny => ClientConfig::builder()
            .dangerous()
            .with_custom_certificate_verifier(Arc::new(NoCertificateVerification))
            .with_no_client_auth(),
        TlsFlavor::VerifyCa => {
            // verify-ca: chain-of-trust against Mozilla roots, but hostname
            // verification is intentionally disabled.
            let mut roots = RootCertStore::empty();
            roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
            let inner = rustls::client::WebPkiServerVerifier::builder(Arc::new(roots))
                .build()
                .map_err(|e| ConnectionError::Postgres(format!("verifier: {e}")))?;
            ClientConfig::builder()
                .dangerous()
                .with_custom_certificate_verifier(Arc::new(SkipHostnameVerifier { inner }))
                .with_no_client_auth()
        }
        TlsFlavor::VerifyFull => {
            let mut roots = RootCertStore::empty();
            roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
            ClientConfig::builder()
                .with_root_certificates(roots)
                .with_no_client_auth()
        }
    };

    Ok(MakeRustlsConnect::new(config))
}

/// `verify-full` cert verifier: accepts any chain + any name. Used for
/// `allow` / `prefer` / `require` modes per spec §6.5.
#[derive(Debug)]
struct NoCertificateVerification;

impl ServerCertVerifier for NoCertificateVerification {
    fn verify_server_cert(
        &self,
        _end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        _message: &[u8],
        _cert: &CertificateDer<'_>,
        _dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        Ok(HandshakeSignatureValid::assertion())
    }

    fn verify_tls13_signature(
        &self,
        _message: &[u8],
        _cert: &CertificateDer<'_>,
        _dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        Ok(HandshakeSignatureValid::assertion())
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        vec![
            SignatureScheme::RSA_PKCS1_SHA1,
            SignatureScheme::ECDSA_SHA1_Legacy,
            SignatureScheme::RSA_PKCS1_SHA256,
            SignatureScheme::ECDSA_NISTP256_SHA256,
            SignatureScheme::RSA_PKCS1_SHA384,
            SignatureScheme::ECDSA_NISTP384_SHA384,
            SignatureScheme::RSA_PKCS1_SHA512,
            SignatureScheme::ECDSA_NISTP521_SHA512,
            SignatureScheme::RSA_PSS_SHA256,
            SignatureScheme::RSA_PSS_SHA384,
            SignatureScheme::RSA_PSS_SHA512,
            SignatureScheme::ED25519,
            SignatureScheme::ED448,
        ]
    }
}

/// `verify-ca` verifier: full chain validation but hostname mismatches are
/// accepted. Wraps WebPki and only intercepts the final step.
#[derive(Debug)]
struct SkipHostnameVerifier {
    inner: Arc<rustls::client::WebPkiServerVerifier>,
}

impl ServerCertVerifier for SkipHostnameVerifier {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        intermediates: &[CertificateDer<'_>],
        server_name: &ServerName<'_>,
        ocsp_response: &[u8],
        now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        match self.inner.verify_server_cert(
            end_entity,
            intermediates,
            server_name,
            ocsp_response,
            now,
        ) {
            Ok(v) => Ok(v),
            // Hostname mismatch is allowed under verify-ca.
            Err(rustls::Error::InvalidCertificate(rustls::CertificateError::NotValidForName)) => {
                Ok(ServerCertVerified::assertion())
            }
            Err(other) => Err(other),
        }
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        self.inner.verify_tls12_signature(message, cert, dss)
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        self.inner.verify_tls13_signature(message, cert, dss)
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.inner.supported_verify_schemes()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ssl_flavor_mapping() {
        assert_eq!(TlsFlavor::from_ssl_mode(SslMode::Disable), TlsFlavor::None);
        assert_eq!(
            TlsFlavor::from_ssl_mode(SslMode::Allow),
            TlsFlavor::AcceptAny
        );
        assert_eq!(
            TlsFlavor::from_ssl_mode(SslMode::Prefer),
            TlsFlavor::AcceptAny
        );
        assert_eq!(
            TlsFlavor::from_ssl_mode(SslMode::Require),
            TlsFlavor::AcceptAny
        );
        assert_eq!(
            TlsFlavor::from_ssl_mode(SslMode::VerifyCa),
            TlsFlavor::VerifyCa
        );
        assert_eq!(
            TlsFlavor::from_ssl_mode(SslMode::VerifyFull),
            TlsFlavor::VerifyFull
        );
    }

    #[test]
    fn pg_ssl_mode_mapping() {
        assert!(matches!(pg_ssl_mode(SslMode::Disable), PgSslMode::Disable));
        assert!(matches!(pg_ssl_mode(SslMode::Allow), PgSslMode::Prefer));
        assert!(matches!(pg_ssl_mode(SslMode::Prefer), PgSslMode::Prefer));
        assert!(matches!(pg_ssl_mode(SslMode::Require), PgSslMode::Require));
        assert!(matches!(pg_ssl_mode(SslMode::VerifyCa), PgSslMode::Require));
        assert!(matches!(
            pg_ssl_mode(SslMode::VerifyFull),
            PgSslMode::Require
        ));
    }

    #[tokio::test]
    async fn evict_missing_is_noop() {
        let r = PoolRegistry::new();
        r.evict("nope").await;
    }

    #[tokio::test]
    async fn build_pool_with_disable_succeeds() {
        // Pool construction is offline — only fails on bad config, not on
        // actual TCP connect (that's lazy on first checkout).
        let pool = build_pool(
            "127.0.0.1",
            5432,
            "postgres",
            "user",
            Some("pw"),
            SslMode::Disable,
        )
        .unwrap();
        assert_eq!(pool.status().max_size, 4);
    }
}
