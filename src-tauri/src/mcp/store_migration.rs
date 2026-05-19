//! `SQLite` access layer for the `mcp_clients` table.
//!
//! Schema definition lives in `migrations/012_mcp_clients.sql`; this
//! module provides the CRUD operations that [`crate::mcp::auth`] uses
//! to issue / revoke.
//!
//! Token hashing: an incoming request carries a bearer token, we
//! SHA-256 it and look up by `token_hash`. This gives O(1) auth without
//! hitting the keychain on every request. The raw token itself is
//! stored separately in the keychain under `mcp:<id>` so it can be
//! revoked (delete keychain entry + delete row).

#![allow(
    clippy::missing_errors_doc,
    clippy::module_name_repetitions,
    clippy::doc_markdown,
    clippy::single_match_else,
    clippy::too_long_first_doc_paragraph
)]

use rusqlite::{params, OptionalExtension};
use sha2::{Digest, Sha256};

use crate::connection::types::ConnectionError;
use crate::mcp::auth::{AuthorizedClient, McpScope};
use crate::mcp::server::McpError;

/// Compute SHA-256 hex digest of a bearer token.
#[must_use]
pub fn hash_token(token: &str) -> String {
    let digest = Sha256::digest(token.as_bytes());
    hex::encode(digest)
}

/// Inserts a new MCP client row. Caller is responsible for storing the
/// raw token in the keychain under `mcp:<id>` *before* calling this so
/// recovery on crash is consistent (orphan keychain entry is harmless,
/// orphan SQLite row would prevent revoke).
pub fn insert_client(
    conn: &rusqlite::Connection,
    id: &str,
    name: &str,
    scopes: &[McpScope],
    token_hash: &str,
    created_at: &str,
) -> Result<(), ConnectionError> {
    let scopes_json = serde_json::to_string(scopes)
        .map_err(|e| ConnectionError::Storage(format!("scopes serialize: {e}")))?;
    conn.execute(
        "INSERT INTO mcp_clients (id, name, scopes, created_at, last_used_at, token_hash) \
         VALUES (?1, ?2, ?3, ?4, NULL, ?5)",
        params![id, name, scopes_json, created_at, token_hash],
    )
    .map_err(|e| ConnectionError::Storage(e.to_string()))?;
    Ok(())
}

/// List all authorized clients (newest first by created_at).
pub fn list_clients(conn: &rusqlite::Connection) -> Result<Vec<AuthorizedClient>, ConnectionError> {
    let mut stmt = conn
        .prepare(
            "SELECT id, name, scopes, created_at, last_used_at \
             FROM mcp_clients ORDER BY created_at DESC",
        )
        .map_err(|e| ConnectionError::Storage(e.to_string()))?;
    let rows = stmt
        .query_map([], row_to_client)
        .map_err(|e| ConnectionError::Storage(e.to_string()))?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| ConnectionError::Storage(e.to_string()))?);
    }
    Ok(out)
}

/// Find a client by its token-hash. Returns `Ok(None)` if no such client.
pub fn find_by_token_hash(
    conn: &rusqlite::Connection,
    token_hash: &str,
) -> Result<Option<AuthorizedClient>, ConnectionError> {
    conn.query_row(
        "SELECT id, name, scopes, created_at, last_used_at \
         FROM mcp_clients WHERE token_hash = ?1",
        params![token_hash],
        row_to_client,
    )
    .optional()
    .map_err(|e| ConnectionError::Storage(e.to_string()))
}

/// Refresh `last_used_at` to the given RFC3339 timestamp. Best-effort —
/// failures are logged by caller, never bubbled (would block tool calls).
pub fn touch_last_used(
    conn: &rusqlite::Connection,
    id: &str,
    at: &str,
) -> Result<(), ConnectionError> {
    conn.execute(
        "UPDATE mcp_clients SET last_used_at = ?1 WHERE id = ?2",
        params![at, id],
    )
    .map_err(|e| ConnectionError::Storage(e.to_string()))?;
    Ok(())
}

/// Delete a client row. Caller must also `keychain.delete("mcp:<id>")`.
/// Returns `McpError::NotAuthorized` if no such id (so the IPC handler
/// surfaces a meaningful error to the UI).
pub fn delete_client(conn: &rusqlite::Connection, id: &str) -> Result<(), McpError> {
    let rows = conn
        .execute("DELETE FROM mcp_clients WHERE id = ?1", params![id])
        .map_err(|e| McpError::Internal(e.to_string()))?;
    if rows == 0 {
        return Err(McpError::NotAuthorized(id.to_string()));
    }
    Ok(())
}

fn row_to_client(row: &rusqlite::Row<'_>) -> rusqlite::Result<AuthorizedClient> {
    let scopes_json: String = row.get("scopes")?;
    let scopes: Vec<McpScope> = serde_json::from_str(&scopes_json).unwrap_or_default();
    Ok(AuthorizedClient {
        id: row.get("id")?,
        name: row.get("name")?,
        scopes,
        created_at: row.get("created_at")?,
        last_used_at: row.get("last_used_at")?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::connection::store::Store;

    fn fresh_store() -> Store {
        let mut s = Store::open_in_memory().unwrap();
        s.run_migrations().unwrap();
        s
    }

    #[test]
    fn token_hash_is_stable() {
        assert_eq!(hash_token("abc"), hash_token("abc"));
        assert_ne!(hash_token("abc"), hash_token("abd"));
        // Sanity: SHA-256 hex is always 64 chars.
        assert_eq!(hash_token("anything").len(), 64);
    }

    #[test]
    fn insert_then_list_round_trip() {
        let store = fresh_store();
        insert_client(
            store.conn(),
            "client-1",
            "Claude Code",
            &[McpScope::DbRead, McpScope::IdeRead],
            &hash_token("tok-1"),
            "2026-05-06T12:00:00Z",
        )
        .unwrap();
        let listed = list_clients(store.conn()).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, "client-1");
        assert_eq!(listed[0].name, "Claude Code");
        assert_eq!(listed[0].scopes.len(), 2);
    }

    #[test]
    fn find_by_token_hash_locates_client() {
        let store = fresh_store();
        let h = hash_token("secret-token");
        insert_client(
            store.conn(),
            "c-1",
            "Cursor",
            &[McpScope::DbRead],
            &h,
            "2026-05-06T12:00:00Z",
        )
        .unwrap();
        let found = find_by_token_hash(store.conn(), &h).unwrap();
        assert!(found.is_some());
        assert_eq!(found.unwrap().name, "Cursor");
        assert!(find_by_token_hash(store.conn(), "deadbeef")
            .unwrap()
            .is_none());
    }

    #[test]
    fn delete_client_removes_row() {
        let store = fresh_store();
        insert_client(
            store.conn(),
            "c-1",
            "X",
            &[McpScope::DbList],
            &hash_token("t"),
            "2026-05-06T12:00:00Z",
        )
        .unwrap();
        delete_client(store.conn(), "c-1").unwrap();
        assert!(list_clients(store.conn()).unwrap().is_empty());
        // Deleting a missing client surfaces NotAuthorized.
        let err = delete_client(store.conn(), "nope").unwrap_err();
        assert!(matches!(err, McpError::NotAuthorized(_)));
    }

    #[test]
    fn touch_last_used_updates_timestamp() {
        let store = fresh_store();
        insert_client(
            store.conn(),
            "c-1",
            "X",
            &[McpScope::DbRead],
            &hash_token("t"),
            "2026-05-06T12:00:00Z",
        )
        .unwrap();
        touch_last_used(store.conn(), "c-1", "2026-05-06T13:00:00Z").unwrap();
        let listed = list_clients(store.conn()).unwrap();
        assert_eq!(
            listed[0].last_used_at.as_deref(),
            Some("2026-05-06T13:00:00Z")
        );
    }

    #[test]
    fn unique_token_hash_constraint_blocks_duplicates() {
        let store = fresh_store();
        let h = hash_token("same");
        insert_client(
            store.conn(),
            "c-1",
            "X",
            &[McpScope::DbRead],
            &h,
            "2026-05-06T12:00:00Z",
        )
        .unwrap();
        let err = insert_client(
            store.conn(),
            "c-2",
            "Y",
            &[McpScope::DbRead],
            &h,
            "2026-05-06T12:00:00Z",
        );
        assert!(err.is_err());
    }
}
