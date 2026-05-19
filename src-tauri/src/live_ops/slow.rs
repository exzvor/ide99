//! — Slow Queries tab fetcher.

use chrono::Utc;
use deadpool_postgres::Pool;

use crate::live_ops::map_err;
use crate::live_ops::types::{LiveOpsError, SlowQuery, SlowSnapshot, SlowSortBy};

const SLOW_LIMIT: i64 = 50;

const fn order_clause(sort_by: SlowSortBy) -> &'static str {
    // Whitelisted column names — never user-input interpolation.
    match sort_by {
        SlowSortBy::MeanExecTime => "mean_exec_time",
        SlowSortBy::TotalExecTime => "total_exec_time",
        SlowSortBy::Calls => "calls",
        SlowSortBy::MeanRows => "(rows::float / NULLIF(calls, 0))",
    }
}

#[allow(clippy::missing_errors_doc)]
pub async fn fetch_slow(pool: &Pool, sort_by: SlowSortBy) -> Result<SlowSnapshot, LiveOpsError> {
    let client = pool.get().await.map_err(|_| LiveOpsError::NotConnected)?;

    // Pre-check: pg_stat_statements installed?
    let extn_row = client
        .query_opt(
            "SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements'",
            &[],
        )
        .await
        .map_err(map_err)?;
    if extn_row.is_none() {
        return Err(LiveOpsError::Unavailable {
            extension: "pg_stat_statements".into(),
            install_sql: "CREATE EXTENSION pg_stat_statements;".into(),
        });
    }

    let sql = format!(
        "SELECT query,
                mean_exec_time AS mean_exec_time_ms,
                total_exec_time AS total_exec_time_ms,
                calls,
                (rows::float / NULLIF(calls, 0)) AS mean_rows,
                (SELECT rolname FROM pg_authid WHERE oid = userid) AS rolname
           FROM pg_stat_statements
          ORDER BY {} DESC NULLS LAST
          LIMIT $1::bigint",
        order_clause(sort_by)
    );
    let rows = client.query(&sql, &[&SLOW_LIMIT]).await.map_err(map_err)?;

    let result: Vec<SlowQuery> = rows
        .iter()
        .map(|r| SlowQuery {
            query: r.get::<_, Option<String>>(0).unwrap_or_default(),
            mean_exec_time_ms: r.get::<_, Option<f64>>(1).unwrap_or(0.0),
            total_exec_time_ms: r.get::<_, Option<f64>>(2).unwrap_or(0.0),
            calls: r.get::<_, Option<i64>>(3).unwrap_or(0),
            mean_rows: r.get::<_, Option<f64>>(4).unwrap_or(0.0),
            rolname: r.get::<_, Option<String>>(5),
        })
        .collect();

    Ok(SlowSnapshot {
        rows: result,
        sort_by,
        fetched_at: Utc::now().to_rfc3339(),
    })
}
