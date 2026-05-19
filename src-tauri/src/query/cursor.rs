//! In-memory registry of live PG cursors.
//!
//! Holds one `CursorState` per live `query_open_cursor` invocation.
//!
//! Cleanup happens in three places:
//! 1. Explicit `query_close_cursor` / `query_cancel` Tauri commands.
//! 2. `cleanup_for_conn(conn_id)` from `connection_disconnect` /
//! `delete_connection` / `update_connection`.
//! 3. `idle_sweeper` background task — closes cursors that haven't been
//! fetched from in `IDLE_TIMEOUT`.
//!
//! Cursors are tied to a checked-out pool client (`deadpool::Object`) which
//! must outlive the transaction. Drop of `CursorState` returns the client
//! to the pool, but does NOT execute `ROLLBACK` synchronously — that has
//! to happen via an explicit close call before the state is dropped,
//! otherwise the pool may hand the connection back to another caller while
//! the old transaction is still open.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use deadpool_postgres::Object;
use tokio::sync::Mutex;
use tokio_postgres::CancelToken;

use crate::query::types::{ColumnMeta, CursorId};

/// Cursors idle longer than this are reaped by the background sweeper.
///
/// 30 minutes — long enough that opening a result set and stepping away to
/// read code/docs is fine, short enough that abandoned tabs don't hold an
/// open transaction overnight.
// Pair `unknown_lints` so toolchains pre-Rust-1.95 don't error on the unknown
// `duration_suboptimal_units` name.
#[allow(unknown_lints)]
#[allow(clippy::duration_suboptimal_units)]
pub const IDLE_TIMEOUT: Duration = Duration::from_secs(30 * 60);

pub struct CursorState {
    pub cursor_id: CursorId,
    pub conn_id: String,
    pub client: Object,
    pub cancel_token: CancelToken,
    pub columns: Vec<ColumnMeta>,
    pub total_fetched: u64,
    pub last_fetch_at: Instant,
    /// SQL the cursor was opened for. Captured so `query_cancel` can write a
    /// faithful row to history without round-tripping through the registry's
    /// callers.
    pub sql: String,
    /// Wall-clock timestamp at the point `query_open_cursor` started. Used by
    /// `query_cancel`'s history-record path to populate `executed_at`.
    pub started_at: chrono::DateTime<chrono::Utc>,
    /// — per-result-column source metadata captured from the
    /// PG `RowDescription` (`tokio_postgres::Column::table_oid()` /
    /// `column_id()`). Authoritative input for `jsonb::resolve_row_key`;
    /// no SQL parsing needed.
    pub column_sources: Vec<crate::query::jsonb::ColumnSource>,
    /// — per-row ctid values captured when the cursor was opened
    /// against a single-base-table SELECT (regex-detected). Index aligns 1:1
    /// with the rows returned to the frontend. `None` at index `i` ⇔ no ctid
    /// for that row (e.g., ctid wasn't injected because the SQL didn't
    /// match the conservative regex).
    pub ctid_values: Vec<Option<String>>,
}

/// Metadata snapshot kept for a cursor AFTER it has been closed.
///
/// Closure happens when a cursor is exhausted on first fetch, or
/// auto-closed on a page boundary. enables
/// `jsonb_resolve_row_key` to find `column_sources` + `ctid_values`
/// even when the open `CursorState` no longer exists, since the user
/// might dbl-click a jsonb cell well after the SELECT finished. Tiny
/// (just a few `Vec`s) — kept in-memory and reaped by the idle sweeper.
#[derive(Debug, Clone)]
pub struct FinishedCursorMetadata {
    pub conn_id: String,
    pub columns: Vec<ColumnMeta>,
    pub column_sources: Vec<crate::query::jsonb::ColumnSource>,
    pub ctid_values: Vec<Option<String>>,
    pub last_access: Instant,
}

#[derive(Default)]
pub struct CursorRegistry {
    inner: Mutex<HashMap<CursorId, CursorState>>,
    finished: Mutex<HashMap<CursorId, FinishedCursorMetadata>>,
}

impl CursorRegistry {
    #[must_use]
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            inner: Mutex::new(HashMap::new()),
            finished: Mutex::new(HashMap::new()),
        })
    }

    /// Insert a fresh cursor state. Returns the same `cursor_id` for caller
    /// chaining convenience.
    pub async fn insert(&self, state: CursorState) -> CursorId {
        let id = state.cursor_id.clone();
        let mut guard = self.inner.lock().await;
        guard.insert(id.clone(), state);
        id
    }

    /// Remove and return the state for `cursor_id`. Caller is responsible
    /// for running `CLOSE` / `ROLLBACK` against the contained client.
    pub async fn take(&self, cursor_id: &str) -> Option<CursorState> {
        let mut guard = self.inner.lock().await;
        guard.remove(cursor_id)
    }

    /// Update `last_fetch_at` for an active cursor. No-op if absent.
    pub async fn touch(&self, cursor_id: &str) {
        let mut guard = self.inner.lock().await;
        if let Some(s) = guard.get_mut(cursor_id) {
            s.last_fetch_at = Instant::now();
        }
    }

    /// Remove every cursor that belongs to `conn_id` and return their
    /// states. Caller must run cleanup SQL on each before the states drop.
    pub async fn drain_for_conn(&self, conn_id: &str) -> Vec<CursorState> {
        let mut guard = self.inner.lock().await;
        let ids: Vec<CursorId> = guard
            .iter()
            .filter(|(_, s)| s.conn_id == conn_id)
            .map(|(k, _)| k.clone())
            .collect();
        let mut out = Vec::with_capacity(ids.len());
        for id in ids {
            if let Some(s) = guard.remove(&id) {
                out.push(s);
            }
        }
        out
    }

    /// Remove every cursor whose `last_fetch_at` is older than
    /// `IDLE_TIMEOUT`. Caller must run cleanup SQL on returned states.
    pub async fn drain_idle(&self) -> Vec<CursorState> {
        // `Instant::now()` may be very close to process start in tests, so
        // subtract via `checked_sub` to avoid panicking on saturating math.
        let now = Instant::now();
        let mut guard = self.inner.lock().await;
        let ids: Vec<CursorId> = guard
            .iter()
            .filter_map(|(k, s)| {
                let age = now.checked_duration_since(s.last_fetch_at)?;
                (age >= IDLE_TIMEOUT).then(|| k.clone())
            })
            .collect();
        let mut out = Vec::with_capacity(ids.len());
        for id in ids {
            if let Some(s) = guard.remove(&id) {
                out.push(s);
            }
        }
        out
    }

    pub async fn len(&self) -> usize {
        self.inner.lock().await.len()
    }

    pub async fn is_empty(&self) -> bool {
        self.inner.lock().await.is_empty()
    }

    // -------- — finished-cursor metadata side table --------

    /// Stash metadata for a cursor that just finished (exhausted on first
    /// fetch, or auto-closed on page boundary). `jsonb_resolve_row_key`
    /// reads from here when the open registry no longer has the cursor.
    pub async fn insert_finished(&self, cursor_id: &str, meta: FinishedCursorMetadata) {
        let mut guard = self.finished.lock().await;
        guard.insert(cursor_id.to_string(), meta);
    }

    /// Read finished-cursor metadata + bump `last_access` for sweeping.
    /// Returns `None` when the cursor never finished or was already
    /// reaped. Caller should NOT rely on entries living forever — the
    /// idle sweeper drops them after `IDLE_TIMEOUT`.
    pub async fn get_finished(&self, cursor_id: &str) -> Option<FinishedCursorMetadata> {
        let mut guard = self.finished.lock().await;
        let snapshot = {
            let meta = guard.get_mut(cursor_id)?;
            meta.last_access = Instant::now();
            meta.clone()
        };
        drop(guard);
        Some(snapshot)
    }

    /// Drop finished-cursor entries whose `last_access` is older than
    /// `IDLE_TIMEOUT`. Called from the same sweeper that drains idle
    /// open cursors.
    pub async fn drain_idle_finished(&self) -> usize {
        let now = Instant::now();
        let mut guard = self.finished.lock().await;
        let ids: Vec<CursorId> = guard
            .iter()
            .filter_map(|(k, m)| {
                let age = now.checked_duration_since(m.last_access)?;
                (age >= IDLE_TIMEOUT).then(|| k.clone())
            })
            .collect();
        let n = ids.len();
        for id in ids {
            guard.remove(&id);
        }
        n
    }

    /// Clean up finished-cursor entries that belong to `conn_id`. Mirrors
    /// `drain_for_conn` for open cursors — called when a connection
    /// disconnects, gets deleted, or its config changes.
    pub async fn cleanup_finished_for_conn(&self, conn_id: &str) -> usize {
        let mut guard = self.finished.lock().await;
        let ids: Vec<CursorId> = guard
            .iter()
            .filter(|(_, m)| m.conn_id == conn_id)
            .map(|(k, _)| k.clone())
            .collect();
        let n = ids.len();
        for id in ids {
            guard.remove(&id);
        }
        n
    }
}

#[cfg(test)]
mod tests {
    // CursorState holds deadpool::Object and tokio_postgres::CancelToken —
    // neither has a Default or test-friendly constructor. Real coverage of
    // the registry's insert/take/touch/drain logic happens in the integration
    // test (cursor_lifecycle_against_real_postgres in
    // tests/connection_integration.rs) where a live PG provides genuine
    // Objects + CancelTokens. This stub documents that intent so a future
    // maintainer doesn't think the gap was forgetful.
    #[test]
    fn registry_unit_coverage_lives_in_integration_test() {
        // documentary marker
    }
}
