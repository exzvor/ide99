//! Tauri command handlers for query execution + editor-tab persistence.
//!
//! Pattern mirrors `connection::commands` and `schema::commands`: the
//! `#[tauri::command]` fns are thin wrappers over inherent helpers on
//! `AppState`, so the integration test can exercise the same code paths
//! without spinning up the Tauri runtime.

#![allow(    clippy::missing_errors_doc,
    clippy::missing_panics_doc,
    clippy::needless_pass_by_value,
    // History-recording helpers use a `_` prefix on private impls
    // (`_query_execute_inner`, `_record_history`) by plan
    // convention — flags them as the wrapper-vs-original boundary.
    clippy::used_underscore_items
)]

use std::time::Instant;

use deadpool_postgres::Pool;
use futures_util::{pin_mut, TryStreamExt};
use tauri::State;
use tokio_postgres::error::ErrorPosition;

use crate::connection::types::ConnectionError;
use crate::query::cursor::CursorState;
use crate::query::explain;
use crate::query::format;
use crate::query::tabs;
use crate::query::types::{
    ColumnMeta, EditorTabRow, FetchPage, HistoryStatus, NewHistoryRecord, OpenCursorResult,
    QueryError, QueryResult,
};
use crate::AppState;

/// Hard cap on returned rows. The 1001th poll triggers `truncated = true`
/// without including the row in the payload — matches spec §5.4 exactly.
const MAX_ROWS: usize = 1000;

// ---------------------------------------------------------------------------
// Tauri command handlers — thin wrappers over inherent helpers below.
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn query_execute(    state: State<'_, AppState>,
    conn_id: String,
    sql: String,
) -> Result<QueryResult, QueryError> {
    state.query_execute(&conn_id, &sql).await
}

#[tauri::command]
pub async fn tabs_list(state: State<'_, AppState>) -> Result<Vec<EditorTabRow>, QueryError> {
    state.tabs_list().await
}

#[tauri::command]
pub async fn tabs_save(state: State<'_, AppState>, tab: EditorTabRow) -> Result<(), QueryError> {
    state.tabs_save(tab).await
}

#[tauri::command]
pub async fn tabs_delete(state: State<'_, AppState>, id: String) -> Result<(), QueryError> {
    state.tabs_delete(&id).await
}

// ---------------------------------------------------------------------------
// — Query history command stubs (bodies filled in Phase 2B).
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn history_search(    state: State<'_, AppState>,
    filter: crate::query::types::HistorySearchFilter,
) -> Result<crate::query::types::HistorySearchResult, QueryError> {
    state.history_search(&filter).await
}

#[tauri::command]
pub async fn history_set_pinned(    state: State<'_, AppState>,
    id: String,
    pinned: bool,
) -> Result<(), QueryError> {
    state.history_set_pinned(&id, pinned).await
}

#[tauri::command]
pub async fn history_set_tag(    state: State<'_, AppState>,
    id: String,
    tag: Option<String>,
) -> Result<(), QueryError> {
    state.history_set_tag(&id, tag.as_deref()).await
}

#[tauri::command]
pub async fn history_set_comment(    state: State<'_, AppState>,
    id: String,
    comment: Option<String>,
) -> Result<(), QueryError> {
    state.history_set_comment(&id, comment.as_deref()).await
}

#[tauri::command]
pub async fn history_delete(state: State<'_, AppState>, id: String) -> Result<(), QueryError> {
    state.history_delete(&id).await
}

#[tauri::command]
pub async fn history_clear_for_connection(    state: State<'_, AppState>,
    connection_id: String,
) -> Result<u64, QueryError> {
    state.history_clear_for_connection(&connection_id).await
}

#[tauri::command]
pub async fn history_export(    state: State<'_, AppState>,
    filter: crate::query::types::HistorySearchFilter,
    path: String,
) -> Result<crate::query::types::HistoryExportResult, QueryError> {
    state.history_export(&filter, &path).await
}

#[tauri::command]
pub async fn query_open_cursor(    state: State<'_, AppState>,
    conn_id: String,
    sql: String,
) -> Result<OpenCursorResult, QueryError> {
    state.query_open_cursor(&conn_id, &sql).await
}

#[tauri::command]
pub async fn query_run_batch(    state: State<'_, AppState>,
    conn_id: String,
    statements: Vec<String>,
    cursor_for_last: bool,
) -> Result<crate::query::types::BatchResult, QueryError> {
    crate::query::batch::run_batch(        &state,
        crate::query::types::BatchInput {
            conn_id,
            statements,
            cursor_for_last,
        },
)
    .await
}

#[tauri::command]
pub async fn query_explain_cost(    state: State<'_, AppState>,
    conn_id: String,
    sql: String,
) -> Result<f64, ConnectionError> {
    let pool = state
        .pools
        .get(&conn_id)
        .await
        .ok_or_else(|| ConnectionError::NotConnected(conn_id.clone()))?;
    explain::explain_cost(&pool, &sql).await
}

/// — full EXPLAIN visualizer. Returns parsed plan JSON + duration.
///
/// The `tab_id` is the EXPLAIN tab id (`explain-${sourceTabId}`), used to
/// track in-flight pid in `state.explain_in_flight` so that
/// `query_explain_cancel` can target it.
#[tauri::command]
pub async fn query_explain(    state: State<'_, AppState>,
    conn_id: String,
    tab_id: String,
    sql: String,
    options: explain::ExplainOptions,
) -> Result<explain::ExplainResult, ConnectionError> {
    let pool = state
        .pools
        .get(&conn_id)
        .await
        .ok_or_else(|| ConnectionError::NotConnected(conn_id.clone()))?;

    let in_flight_for_set = state.explain_in_flight.clone();
    let tab_id_for_set = tab_id.clone();

    let result = explain::run_explain(&pool, &sql, &options, move |pid| {
        let in_flight = in_flight_for_set.clone();
        tokio::spawn(async move {
            in_flight.write().await.insert(tab_id_for_set, pid);
        });
    })
    .await;

    // Always clear the in-flight entry on completion / error / cancel so a
    // stale pid never points at an unrelated session if the same tab id is
    // reused later.
    state.explain_in_flight.write().await.remove(&tab_id);
    result
}

/// — cancel an in-flight EXPLAIN by tab id. No-op when the tab is
/// already finished (no entry in `explain_in_flight`).
#[tauri::command]
pub async fn query_explain_cancel(    state: State<'_, AppState>,
    conn_id: String,
    tab_id: String,
) -> Result<(), ConnectionError> {
    let pid = state.explain_in_flight.read().await.get(&tab_id).copied();
    let Some(pid) = pid else {
        return Ok(());
    };
    let pool = state
        .pools
        .get(&conn_id)
        .await
        .ok_or_else(|| ConnectionError::NotConnected(conn_id.clone()))?;
    explain::cancel_explain(&pool, pid).await
}

// ---------- — Recent Plans ----------

/// Save a captured EXPLAIN plan, honoring the connection-level opt-out.
///
/// When `excludeFromRecentPlans` is set on the connection, returns an empty
/// string so the frontend's fire-and-forget caller treats the no-op the same
/// way it treats a successful save.
#[tauri::command]
pub async fn recent_plans_save(    state: State<'_, AppState>,
    new: crate::query::types::NewRecentPlan,
) -> Result<String, QueryError> {
    let exclude = {
        let store = state.store.lock().await;
        store
            .get_by_id(&new.connection_id)
            .ok()
            .is_some_and(|c| c.exclude_from_recent_plans)
    };
    if exclude {
        return Ok(String::new());
    }
    let mut store = state.store.lock().await;
    crate::query::recent_plans::save(store.conn_mut(), new).map_err(|e| QueryError::StorageError {
        message: e.to_string(),
    })
}

#[tauri::command]
pub async fn recent_plans_search(    state: State<'_, AppState>,
    filter: crate::query::types::RecentPlansFilter,
) -> Result<crate::query::types::RecentPlansSearchResult, QueryError> {
    let store = state.store.lock().await;
    crate::query::recent_plans::search(store.conn(), &filter).map_err(|e| {
        QueryError::StorageError {
            message: e.to_string(),
        }
    })
}

#[tauri::command]
pub async fn recent_plans_get(    state: State<'_, AppState>,
    id: String,
) -> Result<Option<crate::query::types::RecentPlanRow>, QueryError> {
    let store = state.store.lock().await;
    crate::query::recent_plans::get(store.conn(), &id).map_err(|e| QueryError::StorageError {
        message: e.to_string(),
    })
}

#[tauri::command]
pub async fn recent_plans_set_pinned(    state: State<'_, AppState>,
    id: String,
    pinned: bool,
) -> Result<(), QueryError> {
    let store = state.store.lock().await;
    crate::query::recent_plans::set_pinned(store.conn(), &id, pinned).map_err(|e| {
        QueryError::StorageError {
            message: e.to_string(),
        }
    })
}

#[tauri::command]
pub async fn recent_plans_delete(state: State<'_, AppState>, id: String) -> Result<(), QueryError> {
    let store = state.store.lock().await;
    crate::query::recent_plans::delete(store.conn(), &id).map_err(|e| QueryError::StorageError {
        message: e.to_string(),
    })
}

#[tauri::command]
pub async fn recent_plans_clear_for_connection(    state: State<'_, AppState>,
    connection_id: String,
) -> Result<u64, QueryError> {
    let store = state.store.lock().await;
    crate::query::recent_plans::clear_for_connection(store.conn(), &connection_id).map_err(|e| {
        QueryError::StorageError {
            message: e.to_string(),
        }
    })
}

#[tauri::command]
pub async fn query_fetch_page(    state: State<'_, AppState>,
    cursor_id: String,
    limit: u32,
) -> Result<FetchPage, QueryError> {
    state.query_fetch_page(&cursor_id, limit).await
}

#[tauri::command]
pub async fn query_close_cursor(    state: State<'_, AppState>,
    cursor_id: String,
) -> Result<(), QueryError> {
    state.query_close_cursor(&cursor_id).await
}

#[tauri::command]
pub async fn query_cancel(state: State<'_, AppState>, cursor_id: String) -> Result<(), QueryError> {
    state.query_cancel(&cursor_id).await
}

// ---- — JSONB write path ---------------------------------------

/// Resolve the `RowKey` (PK / ctid / `ReadOnly`) for a cell that the user
/// is about to edit in the tree-editor modal. Frontend passes the live row
/// values it has in memory; backend reads the cursor's stored
/// `column_sources` to identify the source table.
///
/// `cursor_id == "<inline>"` is allowed — the inline / single-page path
/// doesn't keep a `CursorState` around, so we cannot resolve via the
/// cursor's stashed metadata. Returns `ReadOnly{NoColumnMetadata}` in that
/// case (frontend falls back to the read-only banner with copy-template).
#[tauri::command]
#[allow(clippy::needless_pass_by_value)] // tauri command invariants
pub async fn jsonb_resolve_row_key(    state: State<'_, AppState>,
    conn_id: String,
    cursor_id: String,
    row_idx: u32,
    row_values: Vec<Option<String>>,
) -> Result<crate::query::types::RowKey, QueryError> {
    let pool = require_pool(&state, &conn_id).await?;

    if cursor_id == "<inline>" {
        return Err(QueryError::ReadOnlyResult {
            reason: crate::query::types::ReadOnlyReason::NoColumnMetadata,
        });
    }

    // Snapshot the cursor's column_sources / ctid_values without holding
    // the registry lock across the catalog query. Two paths:
    // 1) Cursor still open (multi-page result currently being scrolled)
    // → take from `cursors`, snapshot, re-insert.
    // 2) Cursor already finished (exhausted=true at open time, or
    // auto-closed on the last fetch page) → read the metadata
    // side table populated by the open / fetch close paths.
    let (column_sources, column_names, ctid_value) =
        if let Some(mut entry) = state.cursors.take(&cursor_id).await {
            let csrcs = entry.column_sources.clone();
            let cnames: Vec<String> = entry.columns.iter().map(|c| c.name.clone()).collect();
            let ctid = entry.ctid_values.get(row_idx as usize).cloned().flatten();
            // Re-insert so the cursor stays usable.
            entry.last_fetch_at = std::time::Instant::now();
            state.cursors.insert(entry).await;
            (csrcs, cnames, ctid)
        } else if let Some(meta) = state.cursors.get_finished(&cursor_id).await {
            let cnames: Vec<String> = meta.columns.iter().map(|c| c.name.clone()).collect();
            let ctid = meta.ctid_values.get(row_idx as usize).cloned().flatten();
            (meta.column_sources, cnames, ctid)
        } else {
            return Err(QueryError::CursorNotFound {
                cursor_id: cursor_id.clone(),
            });
        };

    crate::query::jsonb::resolve_row_key(        &pool,
        &column_sources,
        &column_names,
        &row_values,
        ctid_value.as_deref(),
)
    .await
}

/// Apply a JSONB write. Validates JSON, computes diff, builds + executes
/// a parameterized UPDATE. Honors the production guard (typing-confirm
/// token) inside `crate::query::jsonb::apply`.
#[tauri::command]
#[allow(clippy::needless_pass_by_value)] // tauri command invariants
pub async fn jsonb_save(    state: State<'_, AppState>,
    ctx: crate::query::types::JsonbWriteContext,
) -> Result<crate::query::types::JsonbSaveResult, QueryError> {
    let pool = require_pool(&state, &ctx.conn_id).await?;

    // Look up the connection's environment tag (defaults to Local on
    // unknown / missing — apply() then skips the prod-guard branch). We
    // hold the store lock for the minimum interval.
    let env = {
        let store = state.store.lock().await;
        store
            .get_by_id(&ctx.conn_id)
            .map(|c| c.environment)
            .unwrap_or(crate::connection::types::Environment::Local)
    };

    let old_v: serde_json::Value =
        serde_json::from_str(&ctx.old_value).map_err(|e| QueryError::JsonbParseError {
            message: format!("old_value: {e}"),
        })?;
    let new_v: serde_json::Value =
        serde_json::from_str(&ctx.new_value).map_err(|e| QueryError::JsonbParseError {
            message: format!("new_value: {e}"),
        })?;

    let diff = crate::query::jsonb::compute_diff(&old_v, &new_v);

    crate::query::jsonb::apply(&pool, env, &ctx, &diff).await
}

/// — request inferred JSONB schema. Returns immediately with
/// one of `Ready { schema }` / `Stale { schema }` / `Pending`. Stale and
/// Pending statuses spawn (or join) a background task that emits
/// `jsonb-inference-updated` with the fresh schema when ready, or
/// `jsonb-inference-failed` on error.
#[tauri::command]
#[allow(clippy::needless_pass_by_value)] // tauri command invariants
pub async fn jsonb_inference_request(    state: State<'_, AppState>,
    app: tauri::AppHandle,
    conn_id: String,
    schema: String,
    table: String,
    column: String,
) -> Result<
    crate::query::jsonb::inference::InferenceResponse,
    crate::query::jsonb::inference::types::InferenceError,
> {
    let pool = state
        .pools
        .get(&conn_id)
        .await
        .ok_or(crate::query::jsonb::inference::types::InferenceError::NotConnected)?;
    let fqn = crate::query::jsonb::inference::types::FullyQualifiedColumn {
        schema,
        table,
        column,
    };
    crate::query::jsonb::inference::request_schema(        state.inference_state.clone(),
        app,
        pool,
        state.store.clone(),
        conn_id,
        fqn,
)
    .await
}

/// — manual "Re-infer". Drops the cache row and respawns
/// the background task. Frontend will receive
/// `jsonb-inference-updated` (or `-failed`) when finished.
#[tauri::command]
#[allow(clippy::needless_pass_by_value)] // tauri command invariants
pub async fn jsonb_inference_invalidate(    state: State<'_, AppState>,
    app: tauri::AppHandle,
    conn_id: String,
    schema: String,
    table: String,
    column: String,
) -> Result<(), crate::query::jsonb::inference::types::InferenceError> {
    let pool = state
        .pools
        .get(&conn_id)
        .await
        .ok_or(crate::query::jsonb::inference::types::InferenceError::NotConnected)?;
    let fqn = crate::query::jsonb::inference::types::FullyQualifiedColumn {
        schema,
        table,
        column,
    };
    crate::query::jsonb::inference::invalidate(        state.inference_state.clone(),
        app,
        pool,
        state.store.clone(),
        conn_id,
        fqn,
)
    .await
}

// ---------------------------------------------------------------------------
// Inherent helpers on AppState — same pattern as connection/schema commands so
// the integration test can drive the IPC surface without the Tauri runtime.
// ---------------------------------------------------------------------------

impl AppState {
    /// Execute `sql` against the live pool for `conn_id`.
    ///
    /// Wraps `_query_execute_inner` with timing + history recording. The inner
    /// fn carries the original three-way branch on the prepared statement's
    /// column metadata; the outer fn captures `started_at`, computes
    /// `duration_ms`, and feeds both into `_record_history` regardless of
    /// success/error so cancelled and failed runs still surface in History.
    pub async fn query_execute(&self, conn_id: &str, sql: &str) -> Result<QueryResult, QueryError> {
        let started_at = chrono::Utc::now();
        let start = Instant::now();
        let result = self._query_execute_inner(conn_id, sql).await;
        let duration_ms = elapsed_ms(start);
        let outcome = match &result {
            Ok(qr) => HistoryOutcome::Ok(qr),
            Err(err) => HistoryOutcome::Error(err),
        };
        self._record_history(conn_id, sql, started_at, duration_ms, outcome)
            .await;
        result
    }

    /// Original body of `query_execute`. Kept private so the public outer
    /// can wrap it with history recording without reshuffling logic.
    async fn _query_execute_inner(        &self,
        conn_id: &str,
        sql: &str,
) -> Result<QueryResult, QueryError> {
        let pool = require_pool(self, conn_id).await?;
        let client = pool.get().await.map_err(|e| QueryError::PoolError {
            message: e.to_string(),
        })?;

        let start = Instant::now();

        let stmt = client.prepare(sql).await.map_err(map_pg_error)?;

        let columns: Vec<ColumnMeta> = stmt
            .columns()
            .iter()
            .map(|c| ColumnMeta {
                name: c.name().to_string(),
                type_name: c.type_().name().to_string(),
                is_numeric: format::is_numeric_type(c.type_().name()),
            })
            .collect();

        // Empty column list almost always means a non-row-returning statement
        // (INSERT/UPDATE/DELETE/DDL). The exception is `SELECT FROM tbl` —
        // valid PG syntax that returns rows with zero columns. Without the
        // SQL-prefix sniff, that case takes this branch, gets reported as
        // `rows_affected`, and the UI shows "2500 rows changed" for a
        // SELECT (). `is_row_returning_sql` keeps SELECTs out of the
        // execute path so they stay labelled as SELECT downstream.
        if columns.is_empty() && !is_row_returning_sql(sql) {
            let affected = client.execute(&stmt, &[]).await.map_err(map_pg_error)?;
            return Ok(QueryResult {
                columns: Vec::new(),
                rows: Vec::new(),
                truncated: false,
                duration_ms: elapsed_ms(start),
                affected_rows: Some(affected),
                status_message: format!("OK ({affected} rows affected)"),
            });
        }

        // Row-returning path: stream + early-exit at MAX_ROWS + 1.
        let stream = client
            .query_raw(&stmt, std::iter::empty::<i32>())
            .await
            .map_err(map_pg_error)?;
        pin_mut!(stream);

        let mut rows: Vec<Vec<Option<String>>> = Vec::new();
        let mut truncated = false;
        while let Some(row) = stream.try_next().await.map_err(map_pg_error)? {
            if rows.len() >= MAX_ROWS {
                truncated = true;
                break;
            }
            let mapped: Vec<Option<String>> = (0..row.len())
                .map(|i| format::cell_to_string(&row, i))
                .collect();
            rows.push(mapped);
        }

        Ok(QueryResult {
            columns,
            rows,
            truncated,
            duration_ms: elapsed_ms(start),
            affected_rows: None,
            status_message: "SELECT".to_string(),
        })
    }

    /// Open a cursor for `sql` and return the first 1000 rows.
    ///
    /// Wraps `_query_open_cursor_inner` with timing + history recording so
    /// that cursor opens (DML inline path, single-page exhaustion, and live
    /// cursor handoff) all surface as History rows. The cursor itself
    /// captures `sql` + `started_at` on `CursorState` so a subsequent
    /// `query_cancel` can record a faithful Cancelled row without needing
    /// to round-trip through the open-time arguments.
    pub async fn query_open_cursor(        &self,
        conn_id: &str,
        sql: &str,
) -> Result<OpenCursorResult, QueryError> {
        let started_at = chrono::Utc::now();
        let start = Instant::now();
        let result = self
            ._query_open_cursor_inner(conn_id, sql, started_at)
            .await;
        let duration_ms = elapsed_ms(start);
        let outcome = match &result {
            Ok(ocr) => HistoryOutcome::OpenCursorOk(ocr),
            Err(err) => HistoryOutcome::Error(err),
        };
        self._record_history(conn_id, sql, started_at, duration_ms, outcome)
            .await;
        result
    }

    /// Original body of `query_open_cursor`. The `started_at` parameter is
    /// threaded through so `CursorState::started_at` matches what the outer
    /// fn already recorded — keeps cancel-history rows aligned with the
    /// open-cursor row written by the wrapper.
    #[allow(clippy::too_many_lines)] // added ctid wrap + per-row strip
    async fn _query_open_cursor_inner(        &self,
        conn_id: &str,
        sql: &str,
        started_at: chrono::DateTime<chrono::Utc>,
) -> Result<OpenCursorResult, QueryError> {
        let pool = require_pool(self, conn_id).await?;
        let client = pool.get().await.map_err(|e| QueryError::PoolError {
            message: e.to_string(),
        })?;

        let start = Instant::now();
        let stmt = client.prepare(sql).await.map_err(map_pg_error)?;

        let columns: Vec<ColumnMeta> = stmt
            .columns()
            .iter()
            .map(|c| ColumnMeta {
                name: c.name().to_string(),
                type_name: c.type_().name().to_string(),
                is_numeric: format::is_numeric_type(c.type_().name()),
            })
            .collect();

        // Path 1: DML / DDL (no rowset). See `is_row_returning_sql` ():
        // a `SELECT FROM tbl` also has zero columns but must NOT be routed
        // here, otherwise the UI labels it as "rows affected".
        if columns.is_empty() && !is_row_returning_sql(sql) {
            let affected = client.execute(&stmt, &[]).await.map_err(map_pg_error)?;
            return Ok(OpenCursorResult {
                cursor_id: "<inline>".to_string(),
                columns: Vec::new(),
                first_page: FetchPage {
                    rows: Vec::new(),
                    exhausted: true,
                },
                duration_ms: elapsed_ms(start),
                affected_rows: Some(affected),
                status_message: format!("OK ({affected} rows affected)"),
            });
        }

        // capture per-column source metadata from the
        // RowDescription. Authoritative input for `jsonb::resolve_row_key`.
        let column_sources: Vec<crate::query::jsonb::ColumnSource> = stmt
            .columns()
            .iter()
            .map(|c| crate::query::jsonb::ColumnSource {
                table_oid: c.table_oid(),
                attnum: c.column_id(),
            })
            .collect();

        // Path 2: rowset cursor.
        let cursor_id = format!("c_{}", uuid::Uuid::new_v4().simple());
        let cancel_token = client.cancel_token();

        // when the SQL looks like a single-base-table SELECT
        // (conservative regex), inject `, ctid::text AS __ctid__` into the
        // SELECT-list so the cursor stashes per-row identifiers we can use
        // for ctid-based UPDATEs on tables without a PK. We can't wrap with
        // a subquery — `ctid` is a row identifier on the base relation and
        // doesn't propagate through subquery output — so we rewrite the
        // outer SELECT-list directly. `inject_ctid_column` skips quoted
        // strings, double-quoted identifiers, and comments to find the
        // first top-level FROM. Frontend never sees `__ctid__`: it's
        // filtered from columns + rows on both open and fetch paths.
        let trimmed_sql = sql.trim().trim_end_matches(';').trim();
        let injected_sql = if crate::query::jsonb::looks_like_single_base_table(trimmed_sql) {
            crate::query::jsonb::inject_ctid_column(trimmed_sql)
        } else {
            None
        };
        let wrap_ctid = injected_sql.is_some();
        let cursor_sql: &str = injected_sql.as_deref().unwrap_or(sql);

        client
            .batch_execute(&format!(                "BEGIN; DECLARE \"{cursor_id}\" NO SCROLL CURSOR FOR {cursor_sql}"
))
            .await
            .map_err(map_pg_error)?;

        let stream = client
            .query(&format!("FETCH FORWARD 1000 FROM \"{cursor_id}\""), &[])
            .await
            .map_err(map_pg_error)?;

        // Locate the synthetic __ctid__ column index in the cursor result
        // (when wrapping is on AND the wrap actually succeeded — the
        // server-side column count tells us). This index is used to
        // strip the column from the payload + stash ctid values per row.
        let ctid_idx: Option<usize> = if wrap_ctid {
            stream
                .first()
                .and_then(|r| r.columns().iter().position(|c| c.name() == "__ctid__"))
        } else {
            None
        };

        let mut ctid_values: Vec<Option<String>> = Vec::new();
        let rows: Vec<Vec<Option<String>>> = stream
            .iter()
            .map(|row| {
                let n = row.len();
                let mut cells: Vec<Option<String>> = Vec::with_capacity(n);
                for i in 0..n {
                    if Some(i) == ctid_idx {
                        // Stash ctid; do NOT push to the user-visible row.
                        ctid_values.push(row.try_get::<_, Option<String>>(i).ok().flatten());
                    } else {
                        cells.push(format::cell_to_string(row, i));
                    }
                }
                cells
            })
            .collect();

        let exhausted = rows.len() < 1000;

        if exhausted {
            // Single-page close: nothing left to fetch; don't register the
            // open CursorState (the client returns to the pool). :
            // we DO need to keep `column_sources` + `ctid_values` so a later
            // dbl-click on a jsonb cell can resolve the row key without
            // re-running the query — stash them in the finished-cursor
            // side table, keyed by the real `cursor_id`. Crucially we
            // return the real id to the frontend (NOT the `<inline>`
            // sentinel that DML uses) so it has a stable handle for
            // jsonb_resolve_row_key. Fetch is gated by `exhausted`; close
            // is idempotent on a missing-from-open-registry id.
            self.cursors
                .insert_finished(                    &cursor_id,
                    crate::query::cursor::FinishedCursorMetadata {
                        conn_id: conn_id.to_string(),
                        columns: columns.clone(),
                        column_sources: column_sources.clone(),
                        ctid_values: ctid_values.clone(),
                        last_access: std::time::Instant::now(),
                    },
)
                .await;
            let _ = client
                .batch_execute(&format!("CLOSE \"{cursor_id}\"; COMMIT;"))
                .await;
            return Ok(OpenCursorResult {
                cursor_id: cursor_id.clone(),
                columns,
                first_page: FetchPage {
                    rows,
                    exhausted: true,
                },
                duration_ms: elapsed_ms(start),
                affected_rows: None,
                status_message: "SELECT".to_string(),
            });
        }

        let total_fetched = u64::try_from(rows.len()).unwrap_or(u64::MAX);
        let state_entry = CursorState {
            cursor_id: cursor_id.clone(),
            conn_id: conn_id.to_string(),
            client,
            cancel_token,
            columns: columns.clone(),
            total_fetched,
            last_fetch_at: std::time::Instant::now(),
            sql: sql.to_string(),
            started_at,
            column_sources,
            ctid_values,
        };
        self.cursors.insert(state_entry).await;

        Ok(OpenCursorResult {
            cursor_id,
            columns,
            first_page: FetchPage {
                rows,
                exhausted: false,
            },
            duration_ms: elapsed_ms(start),
            affected_rows: None,
            status_message: "SELECT".to_string(),
        })
    }

    /// Fetch the next page of `limit` rows from `cursor_id`.
    ///
    /// Returns `CursorNotFound` if the cursor is unknown (already closed,
    /// killed by lifecycle hook, or never existed). When the page returns
    /// fewer rows than requested, the cursor is auto-closed (CLOSE + COMMIT)
    /// and `exhausted=true` is returned — callers should treat the cursor
    /// id as dead from that point on.
    pub async fn query_fetch_page(        &self,
        cursor_id: &str,
        limit: u32,
) -> Result<FetchPage, QueryError> {
        // Touch first so an in-flight fetch counts as activity even if it
        // ends up failing.
        self.cursors.touch(cursor_id).await;

        // Take to mutate; re-insert if not exhausted, otherwise let the
        // entry drop (returning the client to the pool).
        let mut entry =
            self.cursors
                .take(cursor_id)
                .await
                .ok_or_else(|| QueryError::CursorNotFound {
                    cursor_id: cursor_id.to_string(),
                })?;

        let stream = entry
            .client
            .query(&format!("FETCH FORWARD {limit} FROM \"{cursor_id}\""), &[])
            .await
            .map_err(map_pg_error)?;

        // when ctid was injected on open, the cursor columns
        // include a synthetic `__ctid__` that we strip from the user-
        // visible rows and stash on the cursor state instead.
        let ctid_idx: Option<usize> = stream
            .first()
            .and_then(|r| r.columns().iter().position(|c| c.name() == "__ctid__"));

        let rows: Vec<Vec<Option<String>>> = stream
            .iter()
            .map(|row| {
                let n = row.len();
                let mut cells: Vec<Option<String>> = Vec::with_capacity(n);
                for i in 0..n {
                    if Some(i) == ctid_idx {
                        entry
                            .ctid_values
                            .push(row.try_get::<_, Option<String>>(i).ok().flatten());
                    } else {
                        cells.push(format::cell_to_string(row, i));
                    }
                }
                cells
            })
            .collect();

        let exhausted = u32::try_from(rows.len()).is_ok_and(|n| n < limit);
        entry.total_fetched = entry
            .total_fetched
            .saturating_add(u64::try_from(rows.len()).unwrap_or(u64::MAX));
        entry.last_fetch_at = std::time::Instant::now();

        if exhausted {
            // preserve column_sources + ctid_values for jsonb
            // editing AFTER the cursor closes — same logic as the
            // exhausted-on-open branch above. Without this stash, a
            // dbl-click on a jsonb cell after the page closed would land
            // on `CursorNotFound` and the modal would render the
            // ReadOnly{NoColumnMetadata} banner.
            self.cursors
                .insert_finished(                    cursor_id,
                    crate::query::cursor::FinishedCursorMetadata {
                        conn_id: entry.conn_id.clone(),
                        columns: entry.columns.clone(),
                        column_sources: entry.column_sources.clone(),
                        ctid_values: entry.ctid_values.clone(),
                        last_access: std::time::Instant::now(),
                    },
)
                .await;
            let _ = entry
                .client
                .batch_execute(&format!("CLOSE \"{cursor_id}\"; COMMIT;"))
                .await;
            return Ok(FetchPage {
                rows,
                exhausted: true,
            });
        }

        // Re-insert and return the page.
        self.cursors.insert(entry).await;
        Ok(FetchPage {
            rows,
            exhausted: false,
        })
    }

    /// Idempotent close. Absent `cursor_id` is a no-op.
    pub async fn query_close_cursor(&self, cursor_id: &str) -> Result<(), QueryError> {
        let Some(entry) = self.cursors.take(cursor_id).await else {
            return Ok(());
        };
        let _ = entry
            .client
            .batch_execute(&format!("CLOSE \"{cursor_id}\"; COMMIT;"))
            .await;
        Ok(())
    }

    /// Cancel an in-flight query and clean up the cursor.
    ///
    /// Uses `tokio_postgres::CancelToken` on a separate side channel — sends
    /// PG a 16-byte `CancelRequest` with the backend PID + secret key,
    /// triggering SIGINT on the server side and aborting the current
    /// statement with `SqlState::QUERY_CANCELED`. The waiting fetch on the
    /// other end of `query_fetch_page` will surface that as a PG error;
    /// callers above the Tauri layer can detect the `SqlState` and map to
    /// `QueryError::Cancelled` if they care to differentiate.
    ///
    /// Idempotent: cancelling an unknown cursor returns Ok. When the cursor
    /// IS known, snapshots `conn_id` / `sql` / `started_at` BEFORE running
    /// cancel SQL so the post-cancel `_record_history` call can write a
    /// faithful Cancelled row even after the entry has been dropped back
    /// to the pool.
    pub async fn query_cancel(&self, cursor_id: &str) -> Result<(), QueryError> {
        let Some(entry) = self.cursors.take(cursor_id).await else {
            return Ok(());
        };
        // Snapshot history-relevant fields before mutating / dropping the
        // entry. After the cancel SQL the `Object` returns to the pool and
        // `entry` is gone, but we still need conn_id+sql+started_at to
        // emit the History row.
        let captured_conn_id = entry.conn_id.clone();
        let captured_sql = entry.sql.clone();
        let captured_started_at = entry.started_at;

        // Reuse NoTls for the cancel side-channel — the cancel protocol is
        // a 16-byte message that doesn't benefit from TLS for our LAN/dev
        // case. A future sprint hardening for cloud PG with strict
        // TLS-only policy can switch to the matching MakeRustlsConnect.
        let _ = entry.cancel_token.cancel_query(tokio_postgres::NoTls).await;
        let _ = entry.client.batch_execute("ROLLBACK").await;

        let elapsed = u64::try_from(            chrono::Utc::now()
                .signed_duration_since(captured_started_at)
                .num_milliseconds(),
)
        .unwrap_or(0);
        self._record_history(            &captured_conn_id,
            &captured_sql,
            captured_started_at,
            elapsed,
            HistoryOutcome::Cancelled,
)
        .await;

        Ok(())
    }

    /// All persisted tabs, ordered by `created_at` ASC.
    pub async fn tabs_list(&self) -> Result<Vec<EditorTabRow>, QueryError> {
        let store = self.store.lock().await;
        tabs::list(store.conn()).map_err(map_storage_error)
    }

    /// UPSERT a tab by `id`. Idempotent.
    pub async fn tabs_save(&self, tab: EditorTabRow) -> Result<(), QueryError> {
        let store = self.store.lock().await;
        tabs::upsert(store.conn(), &tab).map_err(map_storage_error)
    }

    /// Idempotent delete by `id` — missing-row delete is a no-op.
    pub async fn tabs_delete(&self, id: &str) -> Result<(), QueryError> {
        let store = self.store.lock().await;
        tabs::delete(store.conn(), id).map_err(map_storage_error)
    }

    // -----------------------------------------------------------------------
    // — Query history
    // -----------------------------------------------------------------------

    pub async fn history_search(        &self,
        filter: &crate::query::types::HistorySearchFilter,
) -> Result<crate::query::types::HistorySearchResult, QueryError> {
        let store = self.store.lock().await;
        crate::query::history::search(store.conn(), filter).map_err(map_storage_error)
    }

    pub async fn history_set_pinned(&self, id: &str, pinned: bool) -> Result<(), QueryError> {
        let store = self.store.lock().await;
        crate::query::history::set_pinned(store.conn(), id, pinned).map_err(map_storage_error)
    }

    pub async fn history_set_tag(&self, id: &str, tag: Option<&str>) -> Result<(), QueryError> {
        let store = self.store.lock().await;
        crate::query::history::set_tag(store.conn(), id, tag).map_err(map_storage_error)
    }

    pub async fn history_set_comment(        &self,
        id: &str,
        comment: Option<&str>,
) -> Result<(), QueryError> {
        let store = self.store.lock().await;
        crate::query::history::set_comment(store.conn(), id, comment).map_err(map_storage_error)
    }

    pub async fn history_delete(&self, id: &str) -> Result<(), QueryError> {
        let store = self.store.lock().await;
        crate::query::history::delete(store.conn(), id).map_err(map_storage_error)
    }

    pub async fn history_clear_for_connection(        &self,
        connection_id: &str,
) -> Result<u64, QueryError> {
        let store = self.store.lock().await;
        crate::query::history::delete_all_for_connection(store.conn(), connection_id)
            .map_err(map_storage_error)
    }

    /// Stream the history rows matching `filter` to `path` as a JSON object
    /// with shape `{ version: 1, kind: "history", exportedAt, queries: [...] }`.
    ///
    /// Streaming on purpose — `export_iter` invokes the callback per row so
    /// the entire result set never has to land in memory at once. Acceptance
    /// criterion §6.2 of the spec is "1000 rows export <1s", which the
    /// integration test in `tests/query_history_export.rs` enforces.
    ///
    /// `significant_drop_tightening` is allowed because the Store mutex is
    /// held for the whole stream by design — we don't want concurrent
    /// writes to mutate FTS rows mid-export.
    #[allow(clippy::significant_drop_tightening)]
    pub async fn history_export(        &self,
        filter: &crate::query::types::HistorySearchFilter,
        path: &str,
) -> Result<crate::query::types::HistoryExportResult, QueryError> {
        use std::io::Write;

        let store = self.store.lock().await;
        let file = std::fs::File::create(path).map_err(map_io_error)?;
        let mut writer = std::io::BufWriter::new(file);
        writer
            .write_all(b"{\"version\":1,\"kind\":\"history\",\"exportedAt\":\"")
            .map_err(map_io_error)?;
        writer
            .write_all(chrono::Utc::now().to_rfc3339().as_bytes())
            .map_err(map_io_error)?;
        writer
            .write_all(b"\",\"queries\":[")
            .map_err(map_io_error)?;

        let mut first = true;
        let count = crate::query::history::export_iter(store.conn(), filter, |row| {
            if !first {
                writer.write_all(b",")?;
            }
            first = false;
            serde_json::to_writer(&mut writer, row).map_err(std::io::Error::other)?;
            Ok(())
        })
        .map_err(map_storage_error)?;

        writer.write_all(b"]}").map_err(map_io_error)?;
        writer.flush().map_err(map_io_error)?;
        drop(writer);

        let bytes = std::fs::metadata(path).map_err(map_io_error)?.len();
        Ok(crate::query::types::HistoryExportResult {
            path: path.to_string(),
            count,
            bytes,
        })
    }

    /// Persist a single History row for the given connection. Drops silently
    /// if the connection has been deleted mid-flight or `exclude_from_history`
    /// is set; `record` failures are logged via `tracing::warn` rather than
    /// surfaced to the caller — query results must not regress just because
    /// History persistence hiccupped.
    async fn _record_history(        &self,
        conn_id: &str,
        sql: &str,
        started_at: chrono::DateTime<chrono::Utc>,
        duration_ms: u64,
        outcome: HistoryOutcome<'_>,
) {
        let store = self.store.lock().await;
        let Ok(connection) = store.get_by_id(conn_id) else {
            // Connection vanished mid-flight (deleted between query start
            // and history-write); silently skip rather than fail the
            // user-facing query.
            return;
        };
        if connection.exclude_from_history {
            return;
        }
        let input = NewHistoryRecord {
            connection_id: connection.id,
            connection_name: connection.name,
            sql: sql.to_string(),
            executed_at: started_at.to_rfc3339(),
            duration_ms,
            status: outcome.status(),
            rows_affected: outcome.rows_affected(),
            rows_returned: outcome.rows_returned(),
            truncated: outcome.truncated(),
            error_message: outcome.error_message(),
        };
        if let Err(err) = crate::query::history::record(store.conn(), &input) {
            tracing::warn!(                ?err,
                conn_id,
                "history.record failed; query result unaffected"
);
        }
    }

    /// Inherent helper mirroring the `query_run_batch` Tauri command, so
    /// integration tests (and any future in-process callers) can drive the
    /// multi-statement runner without going through the Tauri runtime —
    /// same convention as `query_execute` / `query_open_cursor` above.
    /// Must NOT be `#[cfg(test)]`-gated because `tests/` is a separate
    /// crate that doesn't see test-only items in the lib.
    pub async fn query_run_batch(        &self,
        conn_id: &str,
        statements: Vec<String>,
        cursor_for_last: bool,
) -> Result<crate::query::types::BatchResult, crate::query::types::QueryError> {
        crate::query::batch::run_batch(            self,
            crate::query::types::BatchInput {
                conn_id: conn_id.to_string(),
                statements,
                cursor_for_last,
            },
)
        .await
    }
}

// ---------------------------------------------------------------------------
// History recording — outcome adapter
// ---------------------------------------------------------------------------

/// Discriminator for the four ways a query execution can complete from the
/// History pipeline's point of view: a successful inline result, a
/// successful cursor-open, an error from any path, or a user cancellation.
/// Borrows from the result so the recording fn can read it back without
/// cloning the (potentially large) row payload.
enum HistoryOutcome<'a> {
    Ok(&'a QueryResult),
    OpenCursorOk(&'a OpenCursorResult),
    Error(&'a QueryError),
    Cancelled,
}

impl HistoryOutcome<'_> {
    const fn status(&self) -> HistoryStatus {
        match self {
            Self::Ok(_) | Self::OpenCursorOk(_) => HistoryStatus::Ok,
            Self::Error(_) => HistoryStatus::Error,
            Self::Cancelled => HistoryStatus::Cancelled,
        }
    }

    const fn rows_affected(&self) -> Option<u64> {
        match self {
            Self::Ok(qr) => qr.affected_rows,
            Self::OpenCursorOk(ocr) => ocr.affected_rows,
            Self::Error(_) | Self::Cancelled => None,
        }
    }

    /// `rows_returned` = number of rows the user actually got back. The
    /// special case is a DML statement returning zero rows — `affected_rows`
    /// is `Some(N)` and `rows.is_empty()` — which we report as `None` to
    /// match how the UI distinguishes "INSERT 5" from "SELECT 0 rows".
    fn rows_returned(&self) -> Option<u64> {
        match self {
            Self::Ok(qr) => {
                if qr.affected_rows.is_some() && qr.rows.is_empty() {
                    None
                } else {
                    Some(u64::try_from(qr.rows.len()).unwrap_or(u64::MAX))
                }
            }
            Self::OpenCursorOk(ocr) => {
                if ocr.affected_rows.is_some() && ocr.first_page.rows.is_empty() {
                    None
                } else {
                    Some(u64::try_from(ocr.first_page.rows.len()).unwrap_or(u64::MAX))
                }
            }
            Self::Error(_) | Self::Cancelled => None,
        }
    }

    const fn truncated(&self) -> bool {
        match self {
            Self::Ok(qr) => qr.truncated,
            // Cursor-stream isn't bounded by MAX_ROWS at open time; the
            // truncation flag belongs to the inline-execute path only.
            Self::OpenCursorOk(_) | Self::Error(_) | Self::Cancelled => false,
        }
    }

    fn error_message(&self) -> Option<String> {
        match self {
            Self::Error(e) => Some(e.to_string()),
            Self::Cancelled => Some("Query cancelled by user".to_string()),
            Self::Ok(_) | Self::OpenCursorOk(_) => None,
        }
    }
}

// ---------------------------------------------------------------------------
// Error mapping
// ---------------------------------------------------------------------------

pub(crate) async fn require_pool(state: &AppState, conn_id: &str) -> Result<Pool, QueryError> {
    state
        .pools
        .get(conn_id)
        .await
        .ok_or_else(|| QueryError::NotConnected {
            conn_id: conn_id.to_string(),
        })
}

/// Translate a `tokio_postgres::Error` into our wire envelope, lifting the
/// 1-based char offset out of the wrapped `DbError` when the server provides
/// one (syntax / undefined-relation errors).
///
/// `Error::Display` only emits `"db error"` for server-originated failures —
/// the human-readable PG message lives one level down on the wrapped
/// `DbError`. We render the latter when present so callers don't have to walk
/// the source chain themselves.
pub(crate) fn map_pg_error(err: tokio_postgres::Error) -> QueryError {
    let position = err.as_db_error().and_then(|d| match d.position() {
        Some(ErrorPosition::Original(n) | ErrorPosition::Internal { position: n, .. }) => Some(*n),
        None => None,
    });
    let message = err
        .as_db_error()
        .map_or_else(|| err.to_string(), ToString::to_string);
    let sqlstate = err.as_db_error().map(|d| d.code().code().to_string());
    QueryError::PostgresError {
        message,
        position,
        sqlstate,
    }
}

fn map_storage_error(err: rusqlite::Error) -> QueryError {
    QueryError::StorageError {
        message: err.to_string(),
    }
}

fn map_io_error(err: std::io::Error) -> QueryError {
    QueryError::StorageError {
        message: err.to_string(),
    }
}

pub(crate) fn elapsed_ms(start: Instant) -> u64 {
    u64::try_from(start.elapsed().as_millis()).unwrap_or(u64::MAX)
}

/// Best-effort sniff of whether a SQL statement returns rows.
///
/// The empty-columns check upstream uses this to disambiguate
/// `SELECT FROM tbl` (valid PG, returns rows with zero columns) from real
/// DML/DDL — without it, mislabels SELECTs as "rows affected".
/// Skips leading whitespace and `--` / `/* … */` comments before checking
/// the first SQL keyword. Errs on the side of "row-returning" so a
/// misclassified SELECT renders as a row count rather than as DML.
pub(crate) fn is_row_returning_sql(sql: &str) -> bool {
    let stripped = strip_leading_sql_noise(sql);
    let first = stripped
        .split(|c: char| c.is_whitespace() || c == '(')
        .next()
        .unwrap_or("")
        .to_ascii_uppercase();
    matches!(        first.as_str(),
        "SELECT" | "WITH" | "VALUES" | "SHOW" | "EXPLAIN" | "TABLE" | "FETCH"
)
}

/// Trim whitespace, `--` line / `/* … */` block comments, and any leading
/// `(` from the front of a SQL string. Used by `is_row_returning_sql` so the
/// keyword sniff looks at the actual leading statement and not the user's
/// preamble — paren-wrapped subqueries (`(SELECT 1)`) count as row-returning.
fn strip_leading_sql_noise(sql: &str) -> &str {
    let mut s = sql.trim_start();
    loop {
        if let Some(rest) = s.strip_prefix("--") {
            s = match rest.find('\n') {
                Some(nl) => rest[nl + 1..].trim_start(),
                None => return "",
            };
        } else if let Some(rest) = s.strip_prefix("/*") {
            s = match rest.find("*/") {
                Some(end) => rest[end + 2..].trim_start(),
                None => return "",
            };
        } else if let Some(rest) = s.strip_prefix('(') {
            s = rest.trim_start();
        } else {
            return s;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{is_row_returning_sql, strip_leading_sql_noise};

    #[test]
    fn row_returning_recognizes_select_variants() {
        assert!(is_row_returning_sql("SELECT 1"));
        assert!(is_row_returning_sql("select 1"));
        assert!(is_row_returning_sql("SELECT FROM tbl;"));
        assert!(is_row_returning_sql("  \n  SELECT * FROM tbl"));
        assert!(is_row_returning_sql("WITH x AS (SELECT 1) SELECT * FROM x"));
        assert!(is_row_returning_sql("VALUES (1), (2)"));
        assert!(is_row_returning_sql("EXPLAIN SELECT 1"));
        assert!(is_row_returning_sql("TABLE tbl"));
        assert!(is_row_returning_sql("SHOW search_path"));
        assert!(is_row_returning_sql("(SELECT 1)"));
    }

    #[test]
    fn row_returning_rejects_dml_and_ddl() {
        assert!(!is_row_returning_sql("INSERT INTO tbl VALUES (1)"));
        assert!(!is_row_returning_sql("UPDATE tbl SET a = 1"));
        assert!(!is_row_returning_sql("DELETE FROM tbl"));
        assert!(!is_row_returning_sql("CREATE TABLE x (y int)"));
        assert!(!is_row_returning_sql("DROP TABLE x"));
        assert!(!is_row_returning_sql("ALTER TABLE x ADD COLUMN y int"));
        assert!(!is_row_returning_sql("BEGIN"));
        assert!(!is_row_returning_sql(""));
    }

    #[test]
    fn row_returning_skips_leading_comments() {
        assert!(is_row_returning_sql("-- a comment\nSELECT 1"));
        assert!(is_row_returning_sql("/* block */ SELECT 1"));
        assert!(is_row_returning_sql("-- one\n-- two\nSELECT 1"));
        assert!(!is_row_returning_sql("-- doc\nINSERT INTO t VALUES (1)"));
    }

    #[test]
    fn strip_leading_handles_unterminated_block_comment() {
        // Defensive: an unterminated /* … should not panic, just return "".
        assert_eq!(strip_leading_sql_noise("/* never ends"), "");
    }
}
