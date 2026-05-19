//! — slow-query cost probe (`explain_cost`).
//! — full EXPLAIN visualizer (`run_explain`, `cancel_explain`).
//!
//! `explain_cost` runs `EXPLAIN (FORMAT JSON)` (no ANALYZE) just to extract
//! `Plan.Total Cost`. `run_explain` returns the full plan JSON for pev2
//! visualization, optionally with ANALYZE / VERBOSE / WAL / TIMING. Both
//! parse the same FORMAT JSON envelope; we share the pool but keep the
//! callsites separate for a clearer API.
//!
//! Cancel model: `run_explain` captures `pg_backend_pid()` BEFORE issuing the
//! EXPLAIN (cheap query on the same client) and exposes it through the
//! `on_pid` callback so the caller can stash it for `cancel_explain`. The
//! cancel itself runs on a fresh pool client because the EXPLAIN client is
//! blocked.

#![allow(clippy::pedantic, clippy::nursery, clippy::missing_errors_doc)]

use std::time::Duration;

use deadpool_postgres::Pool;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::time::timeout;

use crate::connection::types::ConnectionError;

const EXPLAIN_TIMEOUT: Duration = Duration::from_secs(5);
/// EXPLAIN ANALYZE actually executes the query — give it more headroom than
/// plain EXPLAIN's planner-only 5s budget. 60s matches the pgAdmin / DataGrip
/// default; user can always Cancel sooner.
const ANALYZE_TIMEOUT: Duration = Duration::from_secs(60);

pub async fn explain_cost(pool: &Pool, sql: &str) -> Result<f64, ConnectionError> {
    let client = pool
        .get()
        .await
        .map_err(|e| ConnectionError::Postgres(e.to_string()))?;
    let stmt = format!("EXPLAIN (FORMAT JSON) {sql}");
    let row = timeout(EXPLAIN_TIMEOUT, client.query_one(&stmt, &[]))
        .await
        .map_err(|_| ConnectionError::Postgres("EXPLAIN timeout (>5s)".into()))?
        .map_err(pg_err_message)?;

    // EXPLAIN FORMAT JSON returns a single-row, single-column result whose value
    // is `Value::Array` containing one object: [{ "Plan": { "Node Type": "...",
    // "Total Cost": 12345.67, ... } }]
    // tokio-postgres maps `json` / `jsonb` to `serde_json::Value`.
    let value: Value = row.get(0);
    let total_cost = value
        .as_array()
        .and_then(|arr| arr.first())
        .and_then(|first| first.get("Plan"))
        .and_then(|plan| plan.get("Total Cost"))
        .and_then(serde_json::Value::as_f64)
        .ok_or_else(|| {
            ConnectionError::Postgres("EXPLAIN output missing Plan.Total Cost".into())
        })?;
    Ok(total_cost)
}

// ---------------------------------------------------------------------------
// — full EXPLAIN visualizer surface.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ExplainMode {
    Explain,
    Analyze,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplainOptions {
    pub mode: ExplainMode,
    pub verbose: bool,
    pub wal: bool,
    pub timing: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplainResult {
    pub plan_json: Value,
    pub duration_ms: u64,
    pub status_message: String,
}

/// Build the EXPLAIN SQL for the given user SQL + options.
///
/// `(FORMAT JSON, BUFFERS, SETTINGS)` is always included. ANALYZE / WAL /
/// TIMING / VERBOSE are appended per options. WAL & TIMING are silently
/// dropped for non-analyze mode (Postgres errors otherwise). Trailing
/// semicolons are stripped — Postgres rejects `EXPLAIN ... ;` syntactically.
pub fn build_explain_sql(user_sql: &str, options: &ExplainOptions) -> String {
    let mut opts: Vec<&str> = vec!["FORMAT JSON", "BUFFERS", "SETTINGS"];
    if matches!(options.mode, ExplainMode::Analyze) {
        opts.push("ANALYZE");
        if options.wal {
            opts.push("WAL");
        }
        if options.timing {
            opts.push("TIMING");
        }
    }
    if options.verbose {
        opts.push("VERBOSE");
    }
    let stripped = user_sql.trim().trim_end_matches(';').trim_end();
    format!("EXPLAIN ({}) {}", opts.join(", "), stripped)
}

/// Run an EXPLAIN [ANALYZE] for the given SQL and return the parsed plan
/// JSON plus measured wall-clock duration.
///
/// Captures `pg_backend_pid()` BEFORE issuing the EXPLAIN — this MUST happen
/// on the SAME pool client as the EXPLAIN itself so `cancel_explain(pid)`
/// (which runs on a separate client) targets the right session. The pid is
/// surfaced via `on_pid` so the caller can stash it in the AppState
/// `explain_in_flight` map for cancel routing.
///
/// Timeout split:
/// - `EXPLAIN_TIMEOUT` (5s) for plain EXPLAIN — planner-only, should be fast.
/// - `ANALYZE_TIMEOUT` (60s) for ANALYZE — actually executes the query.
pub async fn run_explain(    pool: &Pool,
    user_sql: &str,
    options: &ExplainOptions,
    on_pid: impl FnOnce(i32) + Send,
) -> Result<ExplainResult, ConnectionError> {
    let client = pool
        .get()
        .await
        .map_err(|e| ConnectionError::Postgres(e.to_string()))?;

    // Capture the backend pid on the SAME client BEFORE the EXPLAIN runs,
    // then hand it to the caller so cancel can target this exact session.
    let pid_row = client
        .query_one("SELECT pg_backend_pid()", &[])
        .await
        .map_err(pg_err_message)?;
    let pid: i32 = pid_row.get(0);
    on_pid(pid);

    let stmt = build_explain_sql(user_sql, options);
    let timeout_dur = if matches!(options.mode, ExplainMode::Analyze) {
        ANALYZE_TIMEOUT
    } else {
        EXPLAIN_TIMEOUT
    };

    let start = std::time::Instant::now();
    let row = timeout(timeout_dur, client.query_one(&stmt, &[]))
        .await
        .map_err(|_| {
            let secs = timeout_dur.as_secs();
            ConnectionError::Postgres(format!("EXPLAIN timeout (>{secs}s)"))
        })?
        .map_err(pg_err_message)?;
    let duration_ms = u64::try_from(start.elapsed().as_millis()).unwrap_or(u64::MAX);

    // EXPLAIN FORMAT JSON returns a single row, single column. tokio-postgres
    // maps PG's `json` / `jsonb` to `serde_json::Value`.
    let plan_json: Value = row.get(0);

    let label = if matches!(options.mode, ExplainMode::Analyze) {
        "EXPLAIN ANALYZE"
    } else {
        "EXPLAIN"
    };
    let status_message = format!("{label} · {duration_ms}ms");

    Ok(ExplainResult {
        plan_json,
        duration_ms,
        status_message,
    })
}

/// Cancel an in-flight EXPLAIN by PID via `pg_cancel_backend`.
///
/// Uses a fresh pool client because the EXPLAIN client is blocked on the
/// in-flight statement and cannot accept new commands until it returns.
pub async fn cancel_explain(pool: &Pool, pid: i32) -> Result<(), ConnectionError> {
    let client = pool
        .get()
        .await
        .map_err(|e| ConnectionError::Postgres(e.to_string()))?;
    client
        .query_one("SELECT pg_cancel_backend($1)", &[&pid])
        .await
        .map_err(pg_err_message)?;
    Ok(())
}

/// `tokio_postgres::Error::Display` only emits `"db error"` for server-side
/// failures — the human-readable PG message lives one level down on the
/// wrapped `DbError`. Mirrors `query::commands::map_pg_error`. Without this
/// wrapper, EXPLAIN errors surface in the UI as just "Postgres: db error".
fn pg_err_message(err: tokio_postgres::Error) -> ConnectionError {
    let message = err
        .as_db_error()
        .map_or_else(|| err.to_string(), ToString::to_string);
    ConnectionError::Postgres(message)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{build_explain_sql, ExplainMode, ExplainOptions};

    /// Pure parsing test of the EXPLAIN JSON shape.
    #[test]
    fn parses_total_cost_from_explain_format_json() {
        let v = json!([
            { "Plan": { "Node Type": "Seq Scan", "Total Cost": 12345.67, "Plan Rows": 1000 } }
        ]);
        let total = v
            .as_array()
            .unwrap()
            .first()
            .unwrap()
            .get("Plan")
            .unwrap()
            .get("Total Cost")
            .unwrap()
            .as_f64()
            .unwrap();
        assert!((total - 12345.67).abs() < f64::EPSILON);
    }

    #[test]
    fn build_explain_plain_minimal() {
        // Plain EXPLAIN with all toggles off — only the always-on triplet
        // (FORMAT JSON, BUFFERS, SETTINGS) should appear, no ANALYZE/WAL/
        // TIMING/VERBOSE.
        let opts = ExplainOptions {
            mode: ExplainMode::Explain,
            verbose: false,
            wal: false,
            timing: false,
        };
        let sql = build_explain_sql("SELECT 1", &opts);
        assert_eq!(sql, "EXPLAIN (FORMAT JSON, BUFFERS, SETTINGS) SELECT 1");
    }

    #[test]
    fn build_explain_analyze_all_toggles() {
        // ANALYZE with every flag on. Order matters for spec compliance:
        // FORMAT JSON, BUFFERS, SETTINGS, ANALYZE, WAL, TIMING, VERBOSE.
        let opts = ExplainOptions {
            mode: ExplainMode::Analyze,
            verbose: true,
            wal: true,
            timing: true,
        };
        let sql = build_explain_sql("SELECT 1", &opts);
        assert_eq!(            sql,
            "EXPLAIN (FORMAT JSON, BUFFERS, SETTINGS, ANALYZE, WAL, TIMING, VERBOSE) SELECT 1"
);
    }

    #[test]
    fn build_explain_drops_wal_timing_when_not_analyze() {
        // WAL & TIMING are analyze-only in PG; even when the caller asks
        // for them with mode=Explain, build_explain_sql must drop them.
        // VERBOSE is allowed in plain mode, so it should remain.
        let opts = ExplainOptions {
            mode: ExplainMode::Explain,
            verbose: true,
            wal: true,
            timing: true,
        };
        let sql = build_explain_sql("SELECT 1", &opts);
        assert_eq!(            sql,
            "EXPLAIN (FORMAT JSON, BUFFERS, SETTINGS, VERBOSE) SELECT 1"
);
    }

    #[test]
    fn build_explain_strips_trailing_semicolon() {
        // PG rejects `EXPLAIN (...) SELECT 1;` as a syntax error; strip the
        // trailing `;` plus any trailing whitespace before splicing.
        let opts = ExplainOptions {
            mode: ExplainMode::Explain,
            verbose: false,
            wal: false,
            timing: false,
        };
        let sql = build_explain_sql("SELECT 1;\n", &opts);
        assert_eq!(sql, "EXPLAIN (FORMAT JSON, BUFFERS, SETTINGS) SELECT 1");
    }
}
