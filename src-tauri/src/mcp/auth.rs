//! MCP client authorization.
//!
//! Every external client (Claude Code, Cursor, ...) goes through the
//! authorize flow on its first connect: the backend emits an
//! `mcp:authorize-request` event, Tauri shows [`McpAuthorizeDialog`]
//! on the frontend, and the user approves or denies, optionally with a
//! restricted scope. On allow we generate an opaque token, store it in
//! the keychain, and return it to the client in the handshake response.
//! Subsequent connects skip the UI via token check.
//!
//! ## Components
//! - [`McpScope`] — discrete permission grants.
//! - [`AuthorizedClient`] — UI-friendly metadata (no token).
//! - [`AuthState`] — runtime registry: pending authorize requests,
//! per-token rate limiters, audit log writer.
//! - [`issue_token`] / [`revoke_token`] — backend ↔ keychain ↔ store.
//! - [`require_scope`] — helper for tool dispatch.

#![allow(
    clippy::missing_errors_doc,
    clippy::module_name_repetitions,
    clippy::doc_markdown,
    clippy::significant_drop_tightening,
    clippy::redundant_clone
)]

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use chrono::Utc;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use tokio::sync::{oneshot, Mutex};
use uuid::Uuid;

use crate::connection::Keychain;
use crate::mcp::server::McpError;
use crate::mcp::store_migration;

/// Service prefix used inside the OS keychain for MCP tokens.
const KEYCHAIN_PREFIX: &str = "mcp:";

/// Hard rate limit per token: 10 req/s. Blocks the 11th request in any
/// rolling 1-second window. Tuned for an interactive AI agent (Claude Code
/// rarely exceeds 3 req/s in practice).
pub const RATE_LIMIT_PER_SEC: u32 = 10;
const RATE_WINDOW: Duration = Duration::from_secs(1);

/// Permissions granted to a client. Scope-based: write always requires
/// a per-call confirm in the IDE regardless of scope (the scope only
/// gives the right to *ask*).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum McpScope {
    /// `db:list` — connection list only, without credentials.
    DbList,
    /// `db:read` — schema + read-only queries + EXPLAIN + health.
    DbRead,
    /// `db:write` — mutations in the DB (per-call confirm).
    DbWrite,
    /// `ide:read` — get_active_connection, get_current_query, ...
    IdeRead,
    /// `ide:write` — open_query_in_editor, run_in_editor, etc.
    IdeWrite,
}

impl McpScope {
    /// Default scope set on a vanilla "Allow" click — gives the agent
    /// enough to read schema, suggest edits, and drive the editor without
    /// touching the database. Aligns with the user-confirmed spec.
    #[must_use]
    pub fn default_grant() -> Vec<Self> {
        vec![Self::DbRead, Self::IdeRead, Self::IdeWrite]
    }

    /// "Allow read-only" — minimum to be useful for explanation/inspection.
    #[must_use]
    pub fn read_only_grant() -> Vec<Self> {
        vec![Self::DbRead, Self::IdeRead]
    }

    /// "Allow with write access" — adds `db:write`. Per-call confirm UI is
    /// still emitted by [`crate::mcp::commands::mcp_write_confirm_response`]
    /// before the actual mutation runs.
    #[must_use]
    pub fn write_grant() -> Vec<Self> {
        vec![Self::DbRead, Self::DbWrite, Self::IdeRead, Self::IdeWrite]
    }
}

/// Metadata for a single authorized client. Stored in the SQLite store;
/// the token goes into the keychain separately (never surfaced to the
/// frontend).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthorizedClient {
    pub id: String,
    pub name: String,
    pub scopes: Vec<McpScope>,
    pub created_at: String,
    pub last_used_at: Option<String>,
}

/// Pending authorize request: clients that just connected but haven't been
/// approved/denied by the user yet. Frontend resolves them via
/// `mcp_authorize_response` / `mcp_authorize_deny`.
#[derive(Debug)]
pub struct PendingAuthorize {
    pub client_name: String,
    pub responder: oneshot::Sender<Result<Vec<McpScope>, McpError>>,
}

/// Pending write-confirmation: a tool flagged as `db:write` blocks here
/// until the user clicks Allow/Deny in the inline confirm dialog.
#[derive(Debug)]
pub struct PendingWriteConfirm {
    pub client_name: String,
    pub sql: String,
    pub responder: oneshot::Sender<bool>,
}

/// Sliding window of recent request timestamps for one token. Old entries
/// are pruned on every check, so memory stays bounded by `RATE_LIMIT_PER_SEC`.
#[derive(Debug, Default)]
struct RateLimiter {
    hits: std::collections::VecDeque<Instant>,
}

impl RateLimiter {
    fn check_and_record(&mut self) -> bool {
        let now = Instant::now();
        // `checked_sub` guards against the (impossible-on-stable) edge of
        // `Instant::now()` predating `RATE_WINDOW`. If it does, the limiter
        // simply hasn't seen enough time yet — be permissive.
        let Some(cutoff) = now.checked_sub(RATE_WINDOW) else {
            self.hits.push_back(now);
            return true;
        };
        while self.hits.front().is_some_and(|t| *t < cutoff) {
            self.hits.pop_front();
        }
        if self.hits.len() >= RATE_LIMIT_PER_SEC as usize {
            return false;
        }
        self.hits.push_back(now);
        true
    }
}

/// In-process state for the MCP server: pending UI dialogs + per-token rate
/// limiters. Persistent state (clients, scopes) lives in SQLite via
/// [`store_migration`].
#[derive(Debug, Default)]
pub struct AuthState {
    pub pending_authorize: Mutex<HashMap<String, PendingAuthorize>>,
    pub pending_write: Mutex<HashMap<String, PendingWriteConfirm>>,
    rate_limiters: Mutex<HashMap<String, RateLimiter>>,
}

impl AuthState {
    #[must_use]
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    /// Register a pending authorize request. Returns the request_id which
    /// frontend uses to resolve it.
    pub async fn register_authorize(
        &self,
        client_name: String,
        responder: oneshot::Sender<Result<Vec<McpScope>, McpError>>,
    ) -> String {
        let request_id = Uuid::new_v4().to_string();
        let mut g = self.pending_authorize.lock().await;
        g.insert(
            request_id.clone(),
            PendingAuthorize {
                client_name,
                responder,
            },
        );
        request_id
    }

    /// Resolve an authorize request positively (user clicked Allow).
    pub async fn resolve_authorize(
        &self,
        request_id: &str,
        scopes: Vec<McpScope>,
    ) -> Result<(), McpError> {
        let mut g = self.pending_authorize.lock().await;
        let entry = g
            .remove(request_id)
            .ok_or_else(|| McpError::Internal(format!("no pending authorize: {request_id}")))?;
        // Receiver may have been dropped if client disconnected mid-flow;
        // ignoring the send error matches that semantics.
        let _ = entry.responder.send(Ok(scopes));
        Ok(())
    }

    /// Resolve negatively (user clicked Deny / closed dialog).
    pub async fn deny_authorize(&self, request_id: &str) -> Result<(), McpError> {
        let mut g = self.pending_authorize.lock().await;
        let entry = g
            .remove(request_id)
            .ok_or_else(|| McpError::Internal(format!("no pending authorize: {request_id}")))?;
        let _ = entry
            .responder
            .send(Err(McpError::AuthDenied(entry.client_name.clone())));
        Ok(())
    }

    /// Register a pending write-confirm request.
    pub async fn register_write_confirm(
        &self,
        client_name: String,
        sql: String,
        responder: oneshot::Sender<bool>,
    ) -> String {
        let request_id = Uuid::new_v4().to_string();
        let mut g = self.pending_write.lock().await;
        g.insert(
            request_id.clone(),
            PendingWriteConfirm {
                client_name,
                sql,
                responder,
            },
        );
        request_id
    }

    /// Resolve a write-confirm.
    pub async fn resolve_write_confirm(
        &self,
        request_id: &str,
        allow: bool,
    ) -> Result<(), McpError> {
        let mut g = self.pending_write.lock().await;
        let entry = g
            .remove(request_id)
            .ok_or_else(|| McpError::Internal(format!("no pending write: {request_id}")))?;
        let _ = entry.responder.send(allow);
        Ok(())
    }

    /// Throttle by token-id. Returns false if the request should be blocked.
    pub async fn check_rate(&self, token_id: &str) -> bool {
        let mut g = self.rate_limiters.lock().await;
        let limiter = g.entry(token_id.to_string()).or_default();
        limiter.check_and_record()
    }
}

/// Generate a 32-byte URL-safe random token (base64-url, no padding).
/// 256 bits of entropy — same posture as Stripe API keys.
#[must_use]
pub fn generate_token() -> String {
    let mut bytes = [0_u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    // Base64-url alphabet without padding: agents see one opaque blob.
    base64_url_encode(&bytes)
}

/// Tiny in-tree base64-url encoder so we don't pull in the `base64` crate
/// just for token generation. Fixed alphabet, no padding.
fn base64_url_encode(input: &[u8]) -> String {
    const ALPH: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = Vec::with_capacity(input.len() * 4 / 3 + 4);
    let mut i = 0;
    while i + 3 <= input.len() {
        let n =
            (u32::from(input[i]) << 16) | (u32::from(input[i + 1]) << 8) | u32::from(input[i + 2]);
        out.push(ALPH[((n >> 18) & 0x3F) as usize]);
        out.push(ALPH[((n >> 12) & 0x3F) as usize]);
        out.push(ALPH[((n >> 6) & 0x3F) as usize]);
        out.push(ALPH[(n & 0x3F) as usize]);
        i += 3;
    }
    let rem = input.len() - i;
    if rem == 1 {
        let n = u32::from(input[i]) << 16;
        out.push(ALPH[((n >> 18) & 0x3F) as usize]);
        out.push(ALPH[((n >> 12) & 0x3F) as usize]);
    } else if rem == 2 {
        let n = (u32::from(input[i]) << 16) | (u32::from(input[i + 1]) << 8);
        out.push(ALPH[((n >> 18) & 0x3F) as usize]);
        out.push(ALPH[((n >> 12) & 0x3F) as usize]);
        out.push(ALPH[((n >> 6) & 0x3F) as usize]);
    }
    String::from_utf8(out).expect("base64 alphabet is ASCII")
}

/// Issue a fresh token for a newly-authorized client. Persists:
/// 1. raw token in keychain under `mcp:<id>`
/// 2. metadata + token_hash in `mcp_clients`
///
/// Returns the (id, raw token). The raw token is the only artifact handed
/// to the external agent; it never leaves this function path.
pub fn issue_token(
    conn: &rusqlite::Connection,
    keychain: &dyn Keychain,
    client_name: &str,
    scopes: &[McpScope],
) -> Result<(String, String), McpError> {
    let id = Uuid::new_v4().to_string();
    let token = generate_token();
    let token_hash = store_migration::hash_token(&token);
    let created_at = Utc::now().to_rfc3339();

    keychain
        .store(&format!("{KEYCHAIN_PREFIX}{id}"), &token)
        .map_err(|e| McpError::Internal(format!("keychain store: {e}")))?;

    if let Err(e) =
        store_migration::insert_client(conn, &id, client_name, scopes, &token_hash, &created_at)
    {
        // Roll back keychain write so we don't leave an orphan entry.
        let _ = keychain.delete(&format!("{KEYCHAIN_PREFIX}{id}"));
        return Err(McpError::Internal(format!("store insert: {e}")));
    }

    Ok((id, token))
}

/// Revoke a previously-issued token. Idempotent on the keychain side
/// (missing entry is not an error); SQLite delete returns NotAuthorized
/// for unknown ids so the UI can surface "no such client".
pub fn revoke_token(
    conn: &rusqlite::Connection,
    keychain: &dyn Keychain,
    id: &str,
) -> Result<(), McpError> {
    // Delete keychain first — even if SQLite delete fails, the token
    // becomes invalid (the next request can't lookup the hash anyway).
    let _ = keychain.delete(&format!("{KEYCHAIN_PREFIX}{id}"));
    store_migration::delete_client(conn, id)
}

/// Resolve a bearer token to an AuthorizedClient. Updates `last_used_at`
/// as a side effect (best-effort; failures are logged, not raised).
pub fn authorize_request(
    conn: &rusqlite::Connection,
    token: &str,
) -> Result<AuthorizedClient, McpError> {
    let hash = store_migration::hash_token(token);
    let client = store_migration::find_by_token_hash(conn, &hash)
        .map_err(|e| McpError::Internal(format!("store lookup: {e}")))?
        .ok_or_else(|| McpError::NotAuthorized("token not recognized".into()))?;
    let now = Utc::now().to_rfc3339();
    if let Err(e) = store_migration::touch_last_used(conn, &client.id, &now) {
        tracing::warn!(error = %e, client = %client.id, "MCP touch_last_used failed");
    }
    Ok(client)
}

/// Assert that `client` carries the required scope. Returns a tidy
/// `ScopeInsufficient` error otherwise — the dispatch layer renders it
/// into a JSON-RPC error reply.
pub fn require_scope(client: &AuthorizedClient, required: McpScope) -> Result<(), McpError> {
    if client.scopes.contains(&required) {
        Ok(())
    } else {
        let granted = client
            .scopes
            .iter()
            .map(|s| serde_json::to_string(s).unwrap_or_default())
            .collect::<Vec<_>>()
            .join(",");
        Err(McpError::ScopeInsufficient {
            required: serde_json::to_string(&required).unwrap_or_default(),
            granted,
        })
    }
}

/// Lightweight one-line audit entry. The actual file appender is owned by
/// `crate::mcp::server::AuditLog` — this struct is what gets serialized.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditEntry {
    pub timestamp: String,
    pub client_id: String,
    pub client_name: String,
    pub tool: String,
    pub status: String,
    pub duration_ms: u64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::connection::keychain::MemoryKeychain;
    use crate::connection::store::Store;

    fn fresh_store() -> Store {
        let mut s = Store::open_in_memory().unwrap();
        s.run_migrations().unwrap();
        s
    }

    #[test]
    fn token_is_random_and_url_safe() {
        let a = generate_token();
        let b = generate_token();
        assert_ne!(a, b, "two tokens must not collide");
        assert!(a
            .chars()
            .all(|c| { c.is_ascii_alphanumeric() || c == '-' || c == '_' }));
        // 32 bytes → ceil(32 * 4/3) = 43 chars without padding.
        assert!(a.len() >= 42, "token too short: {}", a.len());
    }

    #[test]
    fn issue_then_authorize_round_trip() {
        let store = fresh_store();
        let kc: Box<dyn Keychain> = Box::new(MemoryKeychain::new());
        let scopes = McpScope::default_grant();
        let (id, token) = issue_token(store.conn(), kc.as_ref(), "Claude Code", &scopes).unwrap();
        // Authorize works on the just-issued token.
        let client = authorize_request(store.conn(), &token).unwrap();
        assert_eq!(client.id, id);
        assert_eq!(client.name, "Claude Code");
        assert_eq!(client.scopes, scopes);
    }

    #[test]
    fn revoke_invalidates_token() {
        let store = fresh_store();
        let kc: Box<dyn Keychain> = Box::new(MemoryKeychain::new());
        let (id, token) = issue_token(store.conn(), kc.as_ref(), "X", &[McpScope::DbRead]).unwrap();
        revoke_token(store.conn(), kc.as_ref(), &id).unwrap();
        let err = authorize_request(store.conn(), &token).unwrap_err();
        assert!(matches!(err, McpError::NotAuthorized(_)));
    }

    #[test]
    fn require_scope_rejects_missing() {
        let client = AuthorizedClient {
            id: "x".into(),
            name: "X".into(),
            scopes: vec![McpScope::DbRead],
            created_at: "".into(),
            last_used_at: None,
        };
        require_scope(&client, McpScope::DbRead).unwrap();
        let err = require_scope(&client, McpScope::DbWrite).unwrap_err();
        assert!(matches!(err, McpError::ScopeInsufficient { .. }));
    }

    #[tokio::test]
    async fn rate_limiter_blocks_eleventh_in_one_second() {
        let auth = AuthState::new();
        for _ in 0..RATE_LIMIT_PER_SEC {
            assert!(auth.check_rate("tok").await, "first 10 must pass");
        }
        assert!(!auth.check_rate("tok").await, "11th must be blocked");
        // A different token is a separate bucket.
        assert!(auth.check_rate("other").await);
    }

    #[tokio::test]
    async fn rate_limiter_recovers_after_window() {
        let auth = AuthState::new();
        for _ in 0..RATE_LIMIT_PER_SEC {
            auth.check_rate("tok").await;
        }
        assert!(!auth.check_rate("tok").await);
        // Sleep slightly > window so old hits expire.
        tokio::time::sleep(RATE_WINDOW + Duration::from_millis(50)).await;
        assert!(auth.check_rate("tok").await, "after window must pass again");
    }

    #[tokio::test]
    async fn pending_authorize_resolves() {
        let auth = AuthState::new();
        let (tx, rx) = oneshot::channel();
        let req_id = auth.register_authorize("Cursor".into(), tx).await;
        auth.resolve_authorize(&req_id, vec![McpScope::DbRead])
            .await
            .unwrap();
        let scopes = rx.await.unwrap().unwrap();
        assert_eq!(scopes, vec![McpScope::DbRead]);
    }

    #[tokio::test]
    async fn pending_authorize_denies() {
        let auth = AuthState::new();
        let (tx, rx) = oneshot::channel();
        let req_id = auth.register_authorize("Cursor".into(), tx).await;
        auth.deny_authorize(&req_id).await.unwrap();
        let err = rx.await.unwrap().unwrap_err();
        assert!(matches!(err, McpError::AuthDenied(_)));
    }

    #[tokio::test]
    async fn pending_write_confirm_flow() {
        let auth = AuthState::new();
        let (tx, rx) = oneshot::channel();
        let req_id = auth
            .register_write_confirm("Claude Code".into(), "DELETE * FROM t".into(), tx)
            .await;
        auth.resolve_write_confirm(&req_id, true).await.unwrap();
        assert!(rx.await.unwrap());
    }
}
