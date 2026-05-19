//! Multi-statement batch execution (post-S14).
//!
//! Acquires ONE pool connection and runs statements sequentially on it so
//! user-written `BEGIN/COMMIT` is honoured. The last rowset optionally opens
//! a cursor (paginates via `query_fetch_page` exactly like single-statement
//! runs); intermediate rowsets are inline-fetched up to 500 rows with a
//! `truncated` flag.

use std::time::Instant;

use deadpool_postgres::Client;

use crate::query::commands::{elapsed_ms, is_row_returning_sql, map_pg_error};
use crate::query::format;
use crate::query::types::{BatchInput, BatchResult, ColumnMeta, QueryError, StatementResult};
use crate::AppState;

pub(crate) const INTERMEDIATE_ROWSET_CAP: usize = 500;

/// Run a single statement on an already-acquired client. Used by both
/// `query_open_cursor` (single-statement, cursor for last) and
/// `query_run_batch` (multi-statement loop).
///
/// `index` and `sql.to_string()` are passed through into the returned
/// `StatementResult` so the caller doesn't have to reassemble them.
///
/// Note: the cursor branch is intentionally NOT handled here — the batch
/// runner dispatches `want_cursor=true` to `state.query_open_cursor` so the
/// cursor registration happens through the existing path that owns
/// `AppState.cursors`. Calling this with `want_cursor=true` therefore returns
/// a `StorageError` that callers must avoid by branching beforehand.
#[allow(clippy::missing_errors_doc)]
pub async fn run_one_on_conn(    client: &mut Client,
    sql: &str,
    index: u32,
    want_cursor: bool,
) -> Result<StatementResult, QueryError> {
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

    // Path 1: DML / DDL (no rowset). Mirrors the disambiguation in
    // `_query_open_cursor_inner`: a `SELECT FROM tbl` also has zero columns
    // but must NOT be routed here.
    if columns.is_empty() && !is_row_returning_sql(sql) {
        let affected = client.execute(&stmt, &[]).await.map_err(map_pg_error)?;
        return Ok(StatementResult::Dml {
            index,
            sql: sql.to_string(),
            affected_rows: Some(affected),
            duration_ms: elapsed_ms(start),
            status_message: format!("OK ({affected} rows affected)"),
        });
    }

    // Path 2: rowset.
    if want_cursor {
        // The batch runner dispatches the cursor path directly to
        // `state.query_open_cursor` (which owns `AppState.cursors`). This
        // helper deliberately doesn't open cursors so it stays
        // state-agnostic.
        return Err(QueryError::StorageError {
            message: "cursor path is dispatched by the batch runner directly".into(),
        });
    }

    // Path 2a: intermediate rowset — inline-fetch capped at INTERMEDIATE_ROWSET_CAP.
    // tokio_postgres' Statement-based query materialises in memory; we read
    // the full rowset and cap during conversion. We peek at `len() > CAP` to
    // set `truncated` without an extra round-trip.
    let stream = client.query(&stmt, &[]).await.map_err(map_pg_error)?;
    let truncated = stream.len() > INTERMEDIATE_ROWSET_CAP;
    let rows: Vec<Vec<Option<String>>> = stream
        .iter()
        .take(INTERMEDIATE_ROWSET_CAP)
        .map(|row| {
            (0..row.len())
                .map(|i| format::cell_to_string(row, i))
                .collect()
        })
        .collect();
    let row_count = rows.len();

    Ok(StatementResult::Rowset {
        index,
        sql: sql.to_string(),
        columns,
        rows,
        truncated,
        cursor_id: None,
        // Intermediate rowsets in a batch are inline-fetched (capped at
        // 500 rows). Whether the underlying query had more is irrelevant
        // for jsonb editing — there's no cursor to address row keys
        // against. Mark exhausted=true so the frontend doesn't try to
        // fetch more.
        exhausted: true,
        duration_ms: elapsed_ms(start),
        status_message: if truncated {
            format!("SELECT {row_count}+ rows (truncated)")
        } else {
            format!("SELECT {row_count} rows")
        },
    })
}

/// Execute a batch of statements on ONE pooled connection.
///
/// Loop:
/// for each stmt:
/// - last with `cursor_for_last=true` → defer to existing
/// `state.query_open_cursor`, which acquires its own client +
/// registers the cursor; the batch's `client` is released before
/// that call so the user's explicit `COMMIT` (if any) has already
/// finished.
/// - everything else → `run_one_on_conn` on the batch's client
/// (intermediate rowset capped 500, DML returns affected_rows).
/// on error: append `Error` variant, `ROLLBACK`, return with
/// `failed_at = i`.
///
/// User-written `BEGIN/COMMIT` is honoured because the same `client` is
/// reused for every statement up to (but not including) the cursor-bearing
/// last statement.
#[allow(clippy::missing_errors_doc)]
pub async fn run_batch(state: &AppState, input: BatchInput) -> Result<BatchResult, QueryError> {
    let pool = crate::query::commands::require_pool(state, &input.conn_id).await?;
    let mut client = pool.get().await.map_err(|e| QueryError::PoolError {
        message: e.to_string(),
    })?;
    let mut results = Vec::with_capacity(input.statements.len());
    let started = Instant::now();

    for (i, sql) in input.statements.iter().enumerate() {
        let is_last = i + 1 == input.statements.len();
        let want_cursor = input.cursor_for_last && is_last;

        let outcome = if want_cursor {
            // Defer to the existing cursor path which owns AppState.cursors.
            // It acquires its own pool client; the batch's `client` will be
            // dropped at the end of this iteration and returned to the pool.
            state
                .query_open_cursor(&input.conn_id, sql)
                .await
                .map(|ocr| StatementResult::Rowset {
                    index: i as u32,
                    sql: sql.clone(),
                    columns: ocr.columns,
                    rows: ocr.first_page.rows,
                    truncated: false,
                    cursor_id: if ocr.cursor_id == "<inline>" {
                        None
                    } else {
                        Some(ocr.cursor_id)
                    },
                    exhausted: ocr.first_page.exhausted,
                    duration_ms: ocr.duration_ms,
                    status_message: ocr.status_message,
                })
        } else {
            run_one_on_conn(&mut client, sql, i as u32, false).await
        };

        match outcome {
            Ok(r) => results.push(r),
            Err(qe) => {
                results.push(StatementResult::Error {
                    index: i as u32,
                    sql: sql.clone(),
                    error: qe,
                });
                let _ = client.batch_execute("ROLLBACK").await;
                return Ok(BatchResult {
                    statements: results,
                    total_duration_ms: elapsed_ms(started),
                    failed_at: Some(i as u32),
                });
            }
        }
    }

    Ok(BatchResult {
        statements: results,
        total_duration_ms: elapsed_ms(started),
        failed_at: None,
    })
}
