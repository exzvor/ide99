//! Two-stage JSONB sampler:
//! 1. Look up `pg_class.relkind` + `reltuples`.
//! 2. Pick strategy: naive (<10K rows or non-table relkind),
//! BERNOULLI (10K..=10M), SYSTEM (>10M).
//! 3. Wrap in `SET LOCAL statement_timeout = 5000` transaction.
//! 4. Under-sample fallback: <30 rows → naive retry.
//!
//! Identifiers are quoted via `super::super::write::quote_ident`. Inputs
//! come from the snapshot — never directly from user-typed text — but we
//! still defend against mis-encoded names.

use deadpool_postgres::Pool;
use serde_json::Value;
use tokio_postgres::Row;

use super::super::write::quote_ident;
use super::types::{FullyQualifiedColumn, InferenceError};

const TARGET_ROWS: u32 = 100;
const UNDER_SAMPLE_FLOOR: usize = 30;
const STATEMENT_TIMEOUT_MS: u32 = 5000;

/// Sample up to `TARGET_ROWS` non-NULL JSONB values from a column.
///
/// # Errors
///
/// Returns [`InferenceError::Timeout`] if the query exceeds 5 seconds, or
/// [`InferenceError::Postgres`] for any other database error.
pub async fn sample_jsonb_column(    pool: &Pool,
    fqn: &FullyQualifiedColumn,
) -> Result<Vec<Value>, InferenceError> {
    let mut client = pool.get().await.map_err(|e| InferenceError::Postgres {
        message: e.to_string(),
    })?;

    let txn = client.transaction().await.map_err(pg)?;
    txn.batch_execute(&format!(        "SET LOCAL statement_timeout = {STATEMENT_TIMEOUT_MS}"
))
    .await
    .map_err(pg)?;

    // Catalog lookup runs inside the timeout-protected transaction so that
    // pathological pg_class lock contention is also bounded by 5 seconds.
    let (relkind, approx_rows) = lookup_relkind_and_size(&txn, &fqn.schema, &fqn.table).await?;

    let strategy = pick_strategy(&relkind, approx_rows);
    let primary_sql = build_query(&strategy, fqn);

    let rows_result = txn.query(&primary_sql, &[]).await;

    let rows = match rows_result {
        Ok(r) => r,
        Err(e) => {
            if is_timeout(&e) {
                return Err(InferenceError::Timeout);
            }
            return Err(InferenceError::Postgres {
                message: e.to_string(),
            });
        }
    };

    let primary_values = parse_rows(&rows);

    if matches!(strategy, Strategy::Bernoulli(_) | Strategy::System(_))
        && primary_values.len() < UNDER_SAMPLE_FLOOR
    {
        let fallback_sql = build_query(&Strategy::Naive, fqn);
        let rows = txn.query(&fallback_sql, &[]).await.map_err(|e| {
            if is_timeout(&e) {
                InferenceError::Timeout
            } else {
                InferenceError::Postgres {
                    message: e.to_string(),
                }
            }
        })?;
        txn.commit().await.map_err(pg)?;
        return Ok(parse_rows(&rows));
    }

    txn.commit().await.map_err(pg)?;
    Ok(primary_values)
}

// ---------- internals ----------

#[derive(Debug)]
enum Strategy {
    Naive,
    Bernoulli(f64),
    System(f64),
}

fn pick_strategy(relkind: &str, approx_rows: i64) -> Strategy {
    match relkind {
        "r" | "p" if (10_000..=10_000_000).contains(&approx_rows) => {
            Strategy::Bernoulli(pct_for_target(approx_rows))
        }
        "r" | "p" if approx_rows > 10_000_000 => Strategy::System(pct_for_target(approx_rows)),
        // small heap, small partitioned, view, matview, foreign — naive
        _ => Strategy::Naive,
    }
}

#[allow(clippy::cast_precision_loss)]
fn pct_for_target(approx_rows: i64) -> f64 {
    // Target ~500 candidates pre-filter (gives buffer for NULL skip + LIMIT 100).
    let raw = 500.0 / (approx_rows.max(1) as f64) * 100.0;
    raw.clamp(0.1, 100.0)
}

fn build_query(strategy: &Strategy, fqn: &FullyQualifiedColumn) -> String {
    let s = quote_ident(&fqn.schema);
    let t = quote_ident(&fqn.table);
    let c = quote_ident(&fqn.column);
    match strategy {
        Strategy::Naive => format!(            "SELECT {c} FROM {s}.{t} WHERE {c} IS NOT NULL ORDER BY random() LIMIT {TARGET_ROWS}"
),
        Strategy::Bernoulli(pct) => format!(            "SELECT {c} FROM {s}.{t} TABLESAMPLE BERNOULLI ({pct:.4}) WHERE {c} IS NOT NULL LIMIT {TARGET_ROWS}"
),
        Strategy::System(pct) => format!(            "SELECT {c} FROM {s}.{t} TABLESAMPLE SYSTEM ({pct:.4}) WHERE {c} IS NOT NULL LIMIT {TARGET_ROWS}"
),
    }
}

async fn lookup_relkind_and_size<C>(    client: &C,
    schema: &str,
    table: &str,
) -> Result<(String, i64), InferenceError>
where
    C: deadpool_postgres::GenericClient,
{
    let row = client
        .query_one(            "SELECT c.relkind::text, c.reltuples::bigint \
             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace \
             WHERE n.nspname = $1 AND c.relname = $2",
            &[&schema, &table],
)
        .await
        .map_err(pg)?;
    Ok((row.get::<_, String>(0), row.get::<_, i64>(1)))
}

fn parse_rows(rows: &[Row]) -> Vec<Value> {
    rows.iter()
        .filter_map(|r| r.get::<_, Option<Value>>(0))
        .collect()
}

fn pg(e: impl std::fmt::Display) -> InferenceError {
    InferenceError::Postgres {
        message: e.to_string(),
    }
}

/// Core check: requires BOTH the `query_canceled` SQLSTATE (57014) AND
/// "statement timeout" in the message.
///
/// SQLSTATE 57014 alone is also emitted by `pg_cancel_backend()` (operator
/// intervention), which we must not misreport as our 5-second guard firing.
///
/// Note: on PG 17 with `lc_messages=C` (the default our pool uses) the
/// message is always English. If PG were ever configured with a localised
/// `lc_messages`, the string match would fail and a real timeout would
/// fall through to `InferenceError::Postgres` — acceptable vs. the
/// alternative of misclassifying operator cancels.
fn is_timeout_classifier(sqlstate: Option<&str>, message: &str) -> bool {
    let is_query_canceled = sqlstate == Some("57014");
    let mentions_statement_timeout = message.to_lowercase().contains("statement timeout");
    // Only treat as Timeout when both signals agree.
    is_query_canceled && mentions_statement_timeout
}

fn is_timeout(e: &tokio_postgres::Error) -> bool {
    // tokio_postgres::Error::to_string() for a DbError produces only "db error",
    // not the PG message text. Use as_db_error() to reach the real message and code.
    e.as_db_error().map_or_else(        // Non-DbError (IO, closed, etc.) — check the top-level string as fallback.
        || {
            is_timeout_classifier(                e.code().map(tokio_postgres::error::SqlState::code),
                &e.to_string(),
)
        },
        |db| is_timeout_classifier(Some(db.code().code()), db.message()),
)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pct_for_1m_rows_clamped_to_minimum() {
        let p = pct_for_target(1_000_000);
        assert!((0.1..=100.0).contains(&p));
    }

    #[test]
    fn pct_clamped_when_table_smaller_than_target() {
        let p = pct_for_target(100); // would be 500% raw
        assert!((p - 100.0).abs() < 0.001);
    }

    #[test]
    fn small_heap_uses_naive() {
        assert!(matches!(pick_strategy("r", 5_000), Strategy::Naive));
    }

    #[test]
    fn large_heap_uses_bernoulli() {
        assert!(matches!(            pick_strategy("r", 100_000),
            Strategy::Bernoulli(_)
));
    }

    #[test]
    fn huge_heap_uses_system() {
        assert!(matches!(            pick_strategy("r", 50_000_000),
            Strategy::System(_)
));
    }

    #[test]
    fn view_falls_back_to_naive() {
        assert!(matches!(pick_strategy("v", 10_000_000), Strategy::Naive));
    }

    #[test]
    fn matview_falls_back_to_naive() {
        assert!(matches!(pick_strategy("m", 10_000_000), Strategy::Naive));
    }

    #[test]
    fn foreign_falls_back_to_naive() {
        assert!(matches!(pick_strategy("f", 10_000_000), Strategy::Naive));
    }

    #[test]
    fn is_timeout_classifier_requires_both_signals() {
        // Both SQLSTATE 57014 and "statement timeout" message → Timeout.
        assert!(is_timeout_classifier(            Some("57014"),
            "ERROR: canceling statement due to statement timeout"
));
        // SQLSTATE alone (e.g. pg_cancel_backend with non-timeout message) → not Timeout.
        assert!(!is_timeout_classifier(            Some("57014"),
            "ERROR: canceling statement due to user request"
));
        // Message alone (some other error type with "statement timeout" in body) → not Timeout.
        assert!(!is_timeout_classifier(            Some("42P01"),
            "did not match statement timeout window"
));
        // Neither → not Timeout.
        assert!(!is_timeout_classifier(None, "connection closed"));
    }
}
