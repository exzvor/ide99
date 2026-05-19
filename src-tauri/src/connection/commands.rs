//! Tauri command handlers — the IPC surface.
//!
//! Handlers are thin orchestrators: validate, dispatch to store/keychain/pool,
//! map errors. Keeping them slim makes the integration test trivial — it
//! drives the same code paths the frontend will, by calling these handler
//! bodies via the inherent helpers below.

#![allow(
    clippy::missing_errors_doc,
    clippy::missing_panics_doc,
    clippy::needless_pass_by_value
)]

use std::time::Duration;

use chrono::Utc;

use crate::connection::pool::PoolRegistry;
use crate::connection::types::{
    Connection, ConnectionError, Environment, NewConnection, ParsedUri, SslMode, TestInput,
    TestResult, UpdateConnection, UpdatePassword,
};
use crate::schema::types::ConnectInfo;
use crate::AppState;

/// Hard ceiling for the synchronous portion of `connection_connect`. Pool
/// build itself is offline so the timeout effectively guards the validation
/// probe (`SELECT version(), current_database()`).
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);

/// Walk an error's `source()` chain and concatenate Display messages with
/// `: ` separators. Without this, `deadpool::PoolError::Backend(...)` only
/// prints `Error occurred while creating a new object` and `tokio_postgres`
/// `Kind::Config` only prints `invalid configuration` — completely opaque
/// to the user. Walking the chain surfaces the underlying io / TLS / auth
/// error that actually broke the connect.
fn format_error_chain(err: &(dyn std::error::Error + 'static)) -> String {
    let mut parts = vec![err.to_string()];
    let mut cur = err.source();
    while let Some(c) = cur {
        let s = c.to_string();
        // Skip duplicate adjacent strings — both deadpool and tokio_postgres
        // sometimes echo the same prefix at multiple chain levels.
        if parts.last().map(String::as_str) != Some(s.as_str()) {
            parts.push(s);
        }
        cur = c.source();
    }
    parts.join(": ")
}

/// True when a `ConnectionError::Postgres` chain mentions the PG /
/// tokio-postgres "password missing" config error — the wrapped string
/// that surfaces when we build a `tokio_postgres::Config` without a
/// `password` and the server refuses auth. Used to swap in a friendlier
/// "connection has no saved password" message instead of the raw
/// deadpool wrapper.
fn error_says_password_missing(err: &ConnectionError) -> bool {
    matches!(err, ConnectionError::Postgres(msg) if msg.contains("password missing"))
}

#[tauri::command]
pub async fn list_connections(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<Connection>, ConnectionError> {
    state.list_connections().await
}

#[tauri::command]
pub async fn create_connection(
    state: tauri::State<'_, AppState>,
    input: NewConnection,
) -> Result<Connection, ConnectionError> {
    state.create_connection(input).await
}

#[tauri::command]
pub async fn duplicate_connection(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<Connection, ConnectionError> {
    state.duplicate_connection(&id).await
}

#[tauri::command]
pub async fn update_connection(
    state: tauri::State<'_, AppState>,
    id: String,
    input: UpdateConnection,
) -> Result<Connection, ConnectionError> {
    state.update_connection(&id, input).await
}

#[tauri::command]
pub async fn delete_connection(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<(), ConnectionError> {
    state.delete_connection(&id).await
}

#[tauri::command]
pub async fn test_connection(
    state: tauri::State<'_, AppState>,
    input: TestInput,
) -> Result<TestResult, ConnectionError> {
    state.test_connection(input).await
}

/// Edit-form variant of `test_connection`.
///
/// Uses the supplied form values for host/port/database/user/sslmode, but if
/// `input.password` is `None`, falls back to the keychain-stored password for
/// `id` (the connection being edited). This is what backs the "Test
/// connection" button in the Edit form: the user leaves the password field
/// blank intending to keep the saved password — without this fallback, PG
/// would reject with "invalid configuration" / auth failure.
#[tauri::command]
pub async fn test_connection_for_edit(
    state: tauri::State<'_, AppState>,
    id: String,
    input: TestInput,
) -> Result<TestResult, ConnectionError> {
    state.test_connection_for_edit(&id, input).await
}

#[tauri::command]
pub async fn test_saved_connection(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<TestResult, ConnectionError> {
    state.test_saved_connection(&id).await
}

#[tauri::command]
pub fn parse_connection_uri(uri: String) -> Result<ParsedUri, ConnectionError> {
    parse_uri(&uri)
}

#[tauri::command]
pub async fn connection_connect(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<ConnectInfo, ConnectionError> {
    state.connection_connect(&id).await
}

#[tauri::command]
pub async fn connection_disconnect(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<(), ConnectionError> {
    state.connection_disconnect(&id).await
}

#[tauri::command]
pub async fn connection_set_exclude_from_history(
    state: tauri::State<'_, AppState>,
    id: String,
    exclude: bool,
) -> Result<(), ConnectionError> {
    state
        .connection_set_exclude_from_history(&id, exclude)
        .await
}

/// — toggle the per-connection Recent Plans opt-out flag.
#[tauri::command]
pub async fn connection_set_exclude_from_recent_plans(
    state: tauri::State<'_, AppState>,
    id: String,
    exclude: bool,
) -> Result<(), ConnectionError> {
    state
        .connection_set_exclude_from_recent_plans(&id, exclude)
        .await
}

#[tauri::command]
pub async fn connection_set_environment(
    state: tauri::State<'_, AppState>,
    id: String,
    environment: Environment,
) -> Result<Connection, ConnectionError> {
    state.connection_set_environment(&id, environment).await
}

#[tauri::command]
pub async fn connection_set_read_only(
    state: tauri::State<'_, AppState>,
    id: String,
    read_only: bool,
) -> Result<Connection, ConnectionError> {
    state.connection_set_read_only(&id, read_only).await
}

#[tauri::command]
pub async fn connection_set_slow_query_warning(
    state: tauri::State<'_, AppState>,
    id: String,
    enabled: bool,
) -> Result<Connection, ConnectionError> {
    state.connection_set_slow_query_warning(&id, enabled).await
}

#[tauri::command]
pub async fn connection_set_confirm_destructive(
    state: tauri::State<'_, AppState>,
    id: String,
    enabled: bool,
) -> Result<Connection, ConnectionError> {
    state.connection_set_confirm_destructive(&id, enabled).await
}

#[tauri::command]
pub async fn connection_set_squawk_lint_enabled(
    state: tauri::State<'_, AppState>,
    id: String,
    enabled: bool,
) -> Result<Connection, ConnectionError> {
    state.connection_set_squawk_lint_enabled(&id, enabled).await
}

/// Persist a test result that the frontend already obtained via
/// `test_connection` / `test_connection_for_edit`. Used by the connection
/// form right after Save to mirror the "successful test" outcome onto the
/// freshly-created (or just-edited) row, so the saved-connections list
/// no longer shows "Never tested" right next to a green check the user
/// just dismissed (). Returns the updated row so the frontend can
/// upsert without a separate `list_connections` round-trip.
#[tauri::command]
pub async fn connection_record_test_result(
    state: tauri::State<'_, AppState>,
    id: String,
    ok: bool,
) -> Result<Connection, ConnectionError> {
    state.connection_record_test_result(&id, ok).await
}

// ---------------------------------------------------------------------------
// Inherent helpers on AppState — exercised directly by integration tests so we
// don't have to spin up the Tauri runtime.
// ---------------------------------------------------------------------------

impl AppState {
    pub async fn list_connections(&self) -> Result<Vec<Connection>, ConnectionError> {
        self.store.lock().await.list()
    }

    pub async fn create_connection(
        &self,
        input: NewConnection,
    ) -> Result<Connection, ConnectionError> {
        let password_present = input.password.as_ref().is_some_and(|p| !p.is_empty());
        let row = self.store.lock().await.create(&input, password_present)?;
        if password_present {
            // Safe to unwrap: password_present guarantees Some.
            let pw = input.password.expect("checked above");
            self.keychain.store(&row.id, &pw)?;
        }
        Ok(row)
    }

    /// Server-side duplicate of an existing connection. Copies metadata + the
    /// keychain-stored password, picks a unique " copy" / " copy 2" / ... name
    /// so the duplicate is immediately usable (audit M4).
    pub async fn duplicate_connection(&self, id: &str) -> Result<Connection, ConnectionError> {
        let source = self.store.lock().await.get_by_id(id)?;
        let password = self.keychain.get(id)?;
        let new_name = self.unique_copy_name(&source.name).await?;
        let input = NewConnection {
            name: new_name,
            host: source.host.clone(),
            port: source.port,
            database: source.database.clone(),
            username: source.username.clone(),
            password,
            ssl_mode: source.ssl_mode,
            exclude_from_history: source.exclude_from_history,
            exclude_from_recent_plans: source.exclude_from_recent_plans,
            environment: source.environment,
            read_only: source.read_only,
            slow_query_warning: source.slow_query_warning,
            confirm_destructive: source.confirm_destructive,
            migrations_dir: source.migrations_dir.clone(),
            migration_tracking_enabled: source.migration_tracking_enabled,
            migration_snapshots_enabled: source.migration_snapshots_enabled,
            squawk_lint_enabled: source.squawk_lint_enabled,
        };
        self.create_connection(input).await
    }

    /// Build the next free " copy" / " copy 2" / ... suffix for the source
    /// name. Avoids `DuplicateName` errors when a previous duplicate already
    /// occupies the obvious slot.
    async fn unique_copy_name(&self, source: &str) -> Result<String, ConnectionError> {
        // Lock just long enough to snapshot existing names; release before
        // we do any string formatting / loops to avoid holding the mutex.
        let existing: std::collections::HashSet<String> = {
            let store = self.store.lock().await;
            store.list()?.into_iter().map(|c| c.name).collect()
        };
        let base = format!("{source} copy");
        if !existing.contains(&base) {
            return Ok(base);
        }
        for n in 2..1000 {
            let candidate = format!("{base} {n}");
            if !existing.contains(&candidate) {
                return Ok(candidate);
            }
        }
        // Astronomically unlikely; fall back to a duplicate-name error so the
        // user sees a deterministic failure rather than a silent loop.
        Err(ConnectionError::DuplicateName(base))
    }

    pub async fn update_connection(
        &self,
        id: &str,
        input: UpdateConnection,
    ) -> Result<Connection, ConnectionError> {
        let existing = self.store.lock().await.get_by_id(id)?;

        // Pre-decide has_password and side-effects against the keychain so the
        // SQLite row truthfully reflects post-state.
        let has_password = match &input.password {
            UpdatePassword::Keep => existing.has_password,
            UpdatePassword::Set { .. } => true,
            UpdatePassword::Clear => false,
        };

        // Only the connection-level fields that the pool actually consumes
        // (host / port / database / username / sslmode / password) require
        // pool eviction. Renaming, toggling read-only, slow-query warnings,
        // exclude-from-history, environment label, or confirm-destructive
        // are pure metadata for the UI — keeping the pool alive avoids the
        // stale-connected state where the UI looks connected but
        // every query fails with "connection is no longer active".
        let pool_invalidating = existing.host != input.host
            || existing.port != input.port
            || existing.database != input.database
            || existing.username != input.username
            || existing.ssl_mode != input.ssl_mode
            || !matches!(input.password, UpdatePassword::Keep);

        match &input.password {
            UpdatePassword::Set { value } => self.keychain.store(id, value)?,
            UpdatePassword::Clear => self.keychain.delete(id)?,
            UpdatePassword::Keep => {}
        }

        let row = self.store.lock().await.update(id, &input, has_password)?;

        if pool_invalidating {
            self.pools.evict(id).await;
            cleanup_cursors_for_conn(self, id).await;
        }
        Ok(row)
    }

    pub async fn delete_connection(&self, id: &str) -> Result<(), ConnectionError> {
        // Order matters: keychain delete is idempotent, pool evict is
        // idempotent, and both must complete before SQLite delete so a partial
        // failure leaves a deletable row + recoverable secret. Cursors must
        // close BEFORE the pool evicts so the CLOSE/ROLLBACK SQL can still
        // ride the original client.
        self.keychain.delete(id)?;
        cleanup_cursors_for_conn(self, id).await;
        self.pools.evict(id).await;
        let store = self.store.lock().await;
        if let Err(err) =
            crate::query::jsonb::inference::cache::evict_for_connection(store.conn(), id)
        {
            tracing::warn!(                connection_id = id,
                            error = %err,
                            "inference cache evict failed during connection delete; orphaned rows may remain",
            );
        }
        store.delete(id)
    }

    pub async fn test_connection(&self, input: TestInput) -> Result<TestResult, ConnectionError> {
        self.pools.test(input).await
    }

    /// See the `test_connection_for_edit` Tauri command. If `input.password` is
    /// `None`, fills it from the keychain entry for `id` before delegating to
    /// `test_connection`. Defends against "invalid configuration" failures when
    /// the user keeps a saved password by leaving the field blank.
    pub async fn test_connection_for_edit(
        &self,
        id: &str,
        mut input: TestInput,
    ) -> Result<TestResult, ConnectionError> {
        if input.password.is_none() {
            // Verify the connection still exists; without this the keychain lookup
            // could silently return None and the test fall through to a confusing
            // "no password" failure instead of a clean NotFound.
            self.store.lock().await.get_by_id(id)?;
            input.password = self.keychain.get(id)?;
        }
        self.pools.test(input).await
    }

    pub async fn test_saved_connection(&self, id: &str) -> Result<TestResult, ConnectionError> {
        let conn = self.store.lock().await.get_by_id(id)?;
        let password = self.keychain.get(id)?;
        let input = TestInput {
            host: conn.host.clone(),
            port: conn.port,
            database: conn.database.clone(),
            username: conn.username.clone(),
            password,
            ssl_mode: conn.ssl_mode,
        };
        let result = self.pools.test(input).await?;
        let now = Utc::now().to_rfc3339();
        // Persisting a failure is intentional — UI shows "last test failed".
        self.store
            .lock()
            .await
            .record_test_result(id, result.ok, &now)?;
        Ok(result)
    }

    /// Open the pool for a saved connection and validate it with a
    /// `SELECT version(), current_database()` probe. The whole flow is bound
    /// by `CONNECT_TIMEOUT` so an unreachable PG never wedges the UI thread.
    /// On success the pool is registered in `state.pools` and returned to the
    /// caller via `ConnectInfo`.
    pub async fn connection_connect(&self, id: &str) -> Result<ConnectInfo, ConnectionError> {
        // Tolerate "already connected" by replacing the pool — keeps the
        // post-state of connect deterministic for retry / reconnect flows.
        let conn = self.store.lock().await.get_by_id(id)?;
        let password = self.keychain.get(id)?;

        // Diagnostic guard: SQLite says we stored a password for this id, but
        // the OS keychain returned nothing. Most common cause on dev macOS:
        // the binary's code signature changed between rebuilds, the keychain
        // ACL invalidated, and `keyring` reports `NoEntry` (which maps to
        // `Ok(None)` here). Without this check the user sees a cryptic
        // "invalid configuration: password missing" wrapped through deadpool;
        // bail out early with an actionable Keychain error instead.
        //
        // Also flip `has_password` to false in SQLite so the rest of the UI
        // (Edit form placeholder, list state) reflects reality on the next
        // render — otherwise the user reopens Edit, sees "Leave blank to
        // keep current", saves, and the same keychain hole reappears.
        if conn.has_password && password.is_none() {
            let sync = {
                let store = self.store.lock().await;
                store.set_has_password(id, false)
            };
            if let Err(e) = sync {
                tracing::warn!(                    connection_id = id,
                                    error = %e,
                                    "failed to sync has_password flag after keychain miss",
                );
            }
            // Same recovery as the connect-probe "no saved password" branch
            // below — frontend renders a clean i18n string with an "Open Edit"
            // button. Used to be `Keychain(...)` with hardcoded Russian text,
            // which the FE prefixed with "no access to keychain" — confusing,
            // because keychain access itself worked fine; the entry was just
            // gone (ACL invalidation on rebuild, etc.).
            return Err(ConnectionError::PasswordMissing(conn.name.clone()));
        }

        let pool = PoolRegistry::build_for(&conn, password.as_deref())?;

        // The pool itself is built synchronously; the timeout wraps the
        // first checkout + validation probe, which is where unreachable
        // hosts hang.
        let probe = tokio::time::timeout(CONNECT_TIMEOUT, async {
            let client = pool
                .get()
                .await
                .map_err(|e| ConnectionError::Postgres(format_error_chain(&e)))?;
            let row = client
                .query_one("SELECT version(), current_database()", &[])
                .await
                .map_err(|e| ConnectionError::Postgres(format_error_chain(&e)))?;
            let server_version: String = row
                .try_get(0)
                .map_err(|e| ConnectionError::Postgres(format_error_chain(&e)))?;
            let database: String = row
                .try_get(1)
                .map_err(|e| ConnectionError::Postgres(format_error_chain(&e)))?;
            Ok::<ConnectInfo, ConnectionError>(ConnectInfo {
                server_version,
                database,
            })
        })
        .await;

        match probe {
            Ok(Ok(info)) => {
                self.pools.insert(id, pool).await;
                Ok(info)
            }
            Ok(Err(err)) => {
                pool.close();
                tracing::warn!(                    connection_id = id,
                                    error = %err,
                                    "connection_connect probe failed",
                );
                // Rewrite the cryptic `tokio_postgres` "password missing" chain
                // into something the user can act on. We hit this path when the
                // user saved a connection without entering a password (or the
                // diagnostic above flipped `has_password=false` after a prior
                // keychain miss) — `pool.get` then fails with the deadpool /
                // tokio-postgres "invalid configuration" string. Trust-auth
                // setups never reach this branch (probe succeeds without a
                // password), so the rewrite only fires when PG actually
                // demanded credentials we don't have.
                let mapped = if password.is_none() && error_says_password_missing(&err) {
                    // Hand the connection name to the FE — i18n template builds
                    // the user-facing copy. Earlier we fed a hardcoded Russian
                    // string into `ConnectionError::Keychain`, which the
                    // frontend then prefixed with "no access to keychain"
                    // (misleading: keychain access was fine, the password was
                    // simply never stored).
                    ConnectionError::PasswordMissing(conn.name.clone())
                } else {
                    err
                };
                Err(mapped)
            }
            Err(_elapsed) => {
                pool.close();
                Err(ConnectionError::Io("connect timeout".into()))
            }
        }
    }

    /// Close the active pool for `id`, removing it from the registry.
    /// Idempotent — disconnecting an already-disconnected id is a no-op so
    /// retry / double-click is safe.
    pub async fn connection_disconnect(&self, id: &str) -> Result<(), ConnectionError> {
        cleanup_cursors_for_conn(self, id).await;
        self.pools.close(id).await;
        Ok(())
    }

    /// Toggle the per-connection History opt-out flag without forcing the
    /// caller to re-submit a full `UpdateConnection` payload.
    pub async fn connection_set_exclude_from_history(
        &self,
        id: &str,
        exclude: bool,
    ) -> Result<(), ConnectionError> {
        let store = self.store.lock().await;
        store.set_exclude_from_history(id, exclude)
    }

    /// — Recent Plans opt-out toggle (mirror of
    /// `connection_set_exclude_from_history`).
    pub async fn connection_set_exclude_from_recent_plans(
        &self,
        id: &str,
        exclude: bool,
    ) -> Result<(), ConnectionError> {
        let store = self.store.lock().await;
        store.set_exclude_from_recent_plans(id, exclude)
    }

    pub async fn connection_set_environment(
        &self,
        id: &str,
        env: Environment,
    ) -> Result<Connection, ConnectionError> {
        let store = self.store.lock().await;
        store.set_environment(id, env)?;
        store.get_by_id(id)
    }

    pub async fn connection_set_read_only(
        &self,
        id: &str,
        value: bool,
    ) -> Result<Connection, ConnectionError> {
        let store = self.store.lock().await;
        store.set_read_only(id, value)?;
        store.get_by_id(id)
    }

    pub async fn connection_set_slow_query_warning(
        &self,
        id: &str,
        value: bool,
    ) -> Result<Connection, ConnectionError> {
        let store = self.store.lock().await;
        store.set_slow_query_warning(id, value)?;
        store.get_by_id(id)
    }

    pub async fn connection_set_confirm_destructive(
        &self,
        id: &str,
        value: bool,
    ) -> Result<Connection, ConnectionError> {
        let store = self.store.lock().await;
        store.set_confirm_destructive(id, value)?;
        store.get_by_id(id)
    }

    pub async fn connection_set_squawk_lint_enabled(
        &self,
        id: &str,
        value: bool,
    ) -> Result<Connection, ConnectionError> {
        let store = self.store.lock().await;
        store.set_squawk_lint_enabled(id, value)?;
        store.get_by_id(id)
    }

    pub async fn connection_record_test_result(
        &self,
        id: &str,
        ok: bool,
    ) -> Result<Connection, ConnectionError> {
        let now = Utc::now().to_rfc3339();
        let store = self.store.lock().await;
        store.record_test_result(id, ok, &now)?;
        store.get_by_id(id)
    }
}

/// Drain any cursors for `conn_id` and run their CLOSE/ROLLBACK so the open
/// transactions don't leak when the pool gets evicted out from under them.
/// Best-effort: errors during cleanup are logged via tracing but never
/// surface to the caller — there's nothing useful the user could do about
/// a failed cleanup ROLLBACK.
async fn cleanup_cursors_for_conn(state: &AppState, conn_id: &str) {
    let drained = state.cursors.drain_for_conn(conn_id).await;
    for cs in drained {
        if let Err(err) = cs
            .client
            .batch_execute(&format!("CLOSE \"{}\"; ROLLBACK;", cs.cursor_id))
            .await
        {
            tracing::warn!(                cursor_id = cs.cursor_id,
                            conn_id = cs.conn_id,
                            error = %err,
                            "cursor cleanup SQL failed during conn lifecycle hook",
            );
        }
    }
    // also drop finished-cursor metadata for this conn so a
    // re-connect doesn't see stale `column_sources` / `ctid_values` from
    // the previous connection's cursors.
    let n = state.cursors.cleanup_finished_for_conn(conn_id).await;
    if n > 0 {
        tracing::debug!(            conn_id = %conn_id,
                    cleared = n,
                    "finished-cursor metadata cleared during conn lifecycle hook",
        );
    }
}

// ---------------------------------------------------------------------------
// URI parser
// ---------------------------------------------------------------------------

fn parse_uri(uri: &str) -> Result<ParsedUri, ConnectionError> {
    let parsed = url::Url::parse(uri.trim())
        .map_err(|e| ConnectionError::InvalidUri(format!("could not parse URI: {e}")))?;

    let scheme = parsed.scheme();
    if scheme != "postgres" && scheme != "postgresql" {
        return Err(ConnectionError::InvalidUri(format!(
            "unsupported scheme '{scheme}'; expected postgres or postgresql"
        )));
    }

    let host_raw = parsed
        .host_str()
        .ok_or_else(|| ConnectionError::InvalidUri("host is required".into()))?;
    // url crate keeps brackets on IPv6 (`[::1]`); strip them so consumers don't
    // have to special-case literal addresses.
    let host = host_raw
        .trim_start_matches('[')
        .trim_end_matches(']')
        .to_string();
    if host.is_empty() {
        return Err(ConnectionError::InvalidUri("host is required".into()));
    }

    let port = parsed.port().unwrap_or(5432);

    // Path is "/dbname"; strip leading slash and require non-empty.
    let database = parsed.path().trim_start_matches('/').to_string();
    if database.is_empty() {
        return Err(ConnectionError::InvalidUri("database is required".into()));
    }

    let username_raw = parsed.username();
    if username_raw.is_empty() {
        return Err(ConnectionError::InvalidUri("username is required".into()));
    }
    let username = percent_decode(username_raw)?;

    let password = match parsed.password() {
        Some(p) => Some(percent_decode(p)?),
        None => None,
    };

    let ssl_mode = parsed
        .query_pairs()
        .find(|(k, _)| k == "sslmode")
        .map_or(SslMode::Prefer, |(_, v)| SslMode::parse_lenient(&v));

    Ok(ParsedUri {
        host,
        port,
        database,
        username,
        password,
        ssl_mode,
    })
}

/// Minimal RFC 3986 percent-decoder for username/password. Returns the
/// resulting UTF-8 string or an error if the byte sequence is not valid UTF-8.
fn percent_decode(s: &str) -> Result<String, ConnectionError> {
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            if i + 2 >= bytes.len() {
                return Err(ConnectionError::InvalidUri(
                    "truncated percent-encoding in URI".into(),
                ));
            }
            let hi = hex_value(bytes[i + 1])?;
            let lo = hex_value(bytes[i + 2])?;
            out.push((hi << 4) | lo);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out)
        .map_err(|e| ConnectionError::InvalidUri(format!("invalid UTF-8 in URI: {e}")))
}

fn hex_value(b: u8) -> Result<u8, ConnectionError> {
    match b {
        b'0'..=b'9' => Ok(b - b'0'),
        b'a'..=b'f' => Ok(b - b'a' + 10),
        b'A'..=b'F' => Ok(b - b'A' + 10),
        _ => Err(ConnectionError::InvalidUri(format!(
            "invalid hex digit '{}' in percent-encoding",
            b as char
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_basic_uri() {
        let p = parse_uri("postgres://user:pw@localhost:5432/mydb").unwrap();
        assert_eq!(p.host, "localhost");
        assert_eq!(p.port, 5432);
        assert_eq!(p.database, "mydb");
        assert_eq!(p.username, "user");
        assert_eq!(p.password.as_deref(), Some("pw"));
        assert_eq!(p.ssl_mode, SslMode::Prefer);
    }

    #[test]
    fn parses_postgresql_scheme() {
        let p = parse_uri("postgresql://u@h:5433/db").unwrap();
        assert_eq!(p.username, "u");
        assert_eq!(p.port, 5433);
        assert!(p.password.is_none());
    }

    #[test]
    fn missing_port_defaults_to_5432() {
        let p = parse_uri("postgres://u@host/db").unwrap();
        assert_eq!(p.port, 5432);
    }

    #[test]
    fn parses_sslmode_query() {
        let p = parse_uri("postgres://u@h/db?sslmode=require").unwrap();
        assert_eq!(p.ssl_mode, SslMode::Require);
        let p2 = parse_uri("postgres://u@h/db?sslmode=verify-full").unwrap();
        assert_eq!(p2.ssl_mode, SslMode::VerifyFull);
    }

    #[test]
    fn unknown_sslmode_is_lenient_prefer() {
        let p = parse_uri("postgres://u@h/db?sslmode=bogus").unwrap();
        assert_eq!(p.ssl_mode, SslMode::Prefer);
    }

    #[test]
    fn percent_encoded_password() {
        let p = parse_uri("postgres://u:p%40ss%21@host/db").unwrap();
        assert_eq!(p.password.as_deref(), Some("p@ss!"));
    }

    #[test]
    fn ipv6_host_brackets_stripped() {
        let p = parse_uri("postgres://u@[::1]:5432/db").unwrap();
        assert_eq!(p.host, "::1");
    }

    #[test]
    fn rejects_unsupported_scheme() {
        let err = parse_uri("mysql://u@h/db").unwrap_err();
        assert!(matches!(err, ConnectionError::InvalidUri(_)));
    }

    #[test]
    fn rejects_missing_database() {
        let err = parse_uri("postgres://u@h").unwrap_err();
        assert!(matches!(err, ConnectionError::InvalidUri(_)));
    }

    #[test]
    fn rejects_missing_user() {
        let err = parse_uri("postgres://h/db").unwrap_err();
        assert!(matches!(err, ConnectionError::InvalidUri(_)));
    }

    #[test]
    fn rejects_garbage() {
        let err = parse_uri("not a uri at all").unwrap_err();
        assert!(matches!(err, ConnectionError::InvalidUri(_)));
    }

    fn percent_encode(s: &str) -> String {
        use std::fmt::Write as _;
        let mut out = String::with_capacity(s.len());
        for b in s.bytes() {
            // Encode any byte outside unreserved ASCII so the URI parser
            // round-trips it via percent_decode.
            if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
                out.push(b as char);
            } else {
                write!(out, "%{b:02X}").unwrap();
            }
        }
        out
    }

    use proptest::prelude::*;

    proptest! {
            #[test]
            fn percent_encoded_passwords_round_trip(            pw in "[A-Za-z0-9!@#$%^&*()_+=\\-]{1,32}"
    ) {
                let encoded = percent_encode(&pw);
                let uri = format!("postgres://user:{encoded}@h/db");
                let p = parse_uri(&uri).unwrap();
                prop_assert_eq!(p.password.as_deref(), Some(pw.as_str()));
            }
        }
}
