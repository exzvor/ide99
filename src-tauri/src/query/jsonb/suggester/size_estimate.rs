//! — `pg_class`-based GIN index size heuristic.
//!
//! [`estimate`] approximates the on-disk size a GIN index would occupy,
//! using two read-only queries bounded by a 2-second `statement_timeout`.
//! Returns `None` on timeout or any other error so callers degrade gracefully.

#![allow(    clippy::missing_errors_doc,
    clippy::missing_panics_doc,
    clippy::cast_sign_loss,
    clippy::cast_possible_truncation
)]

use crate::health::actions::quote_qualified;

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/// Empirical GIN overhead factor (~30 % of raw column data).
///
/// Source: `PostgreSQL` documentation §70.4 and community benchmarks on
/// JSONB GIN indexes (e.g. Cybertec blog "GIN vs. `GiST`", 2022).
pub const GIN_OVERHEAD_FACTOR: f64 = 0.3;

// ─────────────────────────────────────────────────────────────────────────────
// Public entry point
// ─────────────────────────────────────────────────────────────────────────────

/// Estimate the byte size a GIN index on `schema.table(column)` would occupy.
///
/// Returns `None` on any error (timeout, connection problem, missing relation,
/// etc.) so callers can hide the estimate section gracefully.
pub async fn estimate(    client: &impl deadpool_postgres::GenericClient,
    schema: &str,
    table: &str,
    column: &str,
) -> Option<u64> {
    client
        .batch_execute("SET LOCAL statement_timeout = '2s'")
        .await
        .ok()?;

    let fqt = quote_qualified(schema, table).ok()?;

    // 1. Average per-row JSONB column size (bytes), sampled from up to 1 000
    // rows.  We cast via ::float8 so the result is f64 even on an empty table.
    let avg_sql = format!("SELECT AVG(pg_column_size({column}))::float8 FROM {fqt} LIMIT 1000");
    let avg_row = client.query_opt(&avg_sql, &[]).await.ok()??;
    let avg_size: f64 = avg_row.try_get::<_, Option<f64>>(0).ok()??.max(0.0);

    // 2. Approximate row count from `pg_class.reltuples`.
    let count_sql = format!("SELECT reltuples FROM pg_class WHERE oid = '{fqt}'::regclass");
    let count_row = client.query_one(&count_sql, &[]).await.ok()?;
    // reltuples is float4 in pg_class.
    let reltuples: f64 = f64::from(count_row.try_get::<_, f32>(0).ok()?);

    let bytes = compute_estimate(avg_size, reltuples);
    Some(bytes)
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure computation (unit-testable without DB)
// ─────────────────────────────────────────────────────────────────────────────

/// Apply the GIN overhead formula: `avg_size_bytes × reltuples × GIN_OVERHEAD_FACTOR`.
///
/// Returns 0 if inputs are non-positive.
#[must_use]
pub fn compute_estimate(avg_size_bytes: f64, reltuples: f64) -> u64 {
    if avg_size_bytes <= 0.0 || reltuples <= 0.0 {
        return 0;
    }
    let raw = avg_size_bytes * reltuples * GIN_OVERHEAD_FACTOR;
    raw.round() as u64
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn estimate_basic_math() {
        // 1 000 rows × 200 bytes avg × 0.3 = 60 000 bytes
        let result = compute_estimate(200.0, 1_000.0);
        assert_eq!(result, 60_000);
    }

    #[test]
    fn estimate_zero_rows() {
        assert_eq!(compute_estimate(200.0, 0.0), 0);
    }

    #[test]
    fn estimate_zero_avg_size() {
        assert_eq!(compute_estimate(0.0, 1_000.0), 0);
    }

    #[test]
    fn estimate_negative_inputs() {
        assert_eq!(compute_estimate(-1.0, 1_000.0), 0);
        assert_eq!(compute_estimate(200.0, -5.0), 0);
    }

    #[test]
    fn estimate_large_table() {
        // 10M rows × 512 bytes × 0.3 ≈ 1.5 GB
        let result = compute_estimate(512.0, 10_000_000.0);
        // 512 × 10_000_000 × 0.3 = 1_536_000_000
        assert_eq!(result, 1_536_000_000);
    }

    #[test]
    fn gin_overhead_factor_is_constant() {
        assert!((GIN_OVERHEAD_FACTOR - 0.3).abs() < 1e-10);
    }
}
