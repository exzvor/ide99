//! Fetches `pg_stat_user_tables` row counts for a table and computes
//! whether the (ins+upd+del) delta from a previously cached snapshot
//! exceeds a percentage threshold of `n_live_tup`.
//!
//! `fetch_table_stats` returns Ok(None) for views/matviews/foreign tables
//! and for connections lacking access — caller falls back to TTL 24h.

use deadpool_postgres::Pool;

use super::types::{InferenceError, TableStats};

/// Fetches live table stats from `pg_stat_user_tables` for a given schema and table.
///
/// Returns `Ok(None)` if the table does not exist or is not a real table (e.g., a view,
/// materialized view, or foreign table).
///
/// # Errors
///
/// Returns `Err(InferenceError::Postgres { .. })` if the database query fails.
pub async fn fetch_table_stats(
    pool: &Pool,
    schema: &str,
    table: &str,
) -> Result<Option<TableStats>, InferenceError> {
    let client = pool.get().await.map_err(|e| InferenceError::Postgres {
        message: e.to_string(),
    })?;
    let row_opt = client
        .query_opt(
            "SELECT n_tup_ins, n_tup_upd, n_tup_del, n_live_tup \
             FROM pg_stat_user_tables WHERE schemaname = $1 AND relname = $2",
            &[&schema, &table],
        )
        .await
        .map_err(|e| InferenceError::Postgres {
            message: e.to_string(),
        })?;
    Ok(row_opt.map(|r| TableStats {
        n_tup_ins: r.get(0),
        n_tup_upd: r.get(1),
        n_tup_del: r.get(2),
        n_live_tup: r.get(3),
    }))
}

/// `pct` expressed as percent (e.g. 5.0 means 5%).
#[allow(clippy::cast_precision_loss)]
#[must_use]
pub fn delta_exceeds_threshold(prev: &TableStats, curr: &TableStats, pct: f32) -> bool {
    let delta = (curr.n_tup_ins - prev.n_tup_ins).abs()
        + (curr.n_tup_upd - prev.n_tup_upd).abs()
        + (curr.n_tup_del - prev.n_tup_del).abs();
    let baseline = prev.n_live_tup.max(1);
    (delta as f64 / baseline as f64) > (f64::from(pct) / 100.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(ins: i64, upd: i64, del: i64, live: i64) -> TableStats {
        TableStats {
            n_tup_ins: ins,
            n_tup_upd: upd,
            n_tup_del: del,
            n_live_tup: live,
        }
    }

    #[test]
    fn under_threshold_returns_false() {
        let prev = s(0, 0, 0, 10_000);
        let curr = s(100, 100, 0, 10_200); // 200/10_000 = 2%
        assert!(!delta_exceeds_threshold(&prev, &curr, 5.0));
    }

    #[test]
    fn over_threshold_returns_true() {
        let prev = s(0, 0, 0, 10_000);
        let curr = s(700, 0, 0, 10_700); // 7%
        assert!(delta_exceeds_threshold(&prev, &curr, 5.0));
    }

    #[test]
    fn negative_delta_after_pg_stat_reset_triggers() {
        let prev = s(1_000_000, 0, 0, 5_000_000);
        let curr = s(0, 0, 0, 5_000_000); // counters reset
        assert!(delta_exceeds_threshold(&prev, &curr, 5.0));
    }

    #[test]
    fn zero_baseline_does_not_divide_by_zero() {
        let prev = s(0, 0, 0, 0);
        let curr = s(1, 0, 0, 0);
        // .max(1) prevents div-by-zero; delta=1 / baseline=1 = 100% → exceeds 5%
        assert!(delta_exceeds_threshold(&prev, &curr, 5.0));
    }
}
