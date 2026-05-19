//! — `HypoPG` wrapper for hypothetical EXPLAIN cost estimation.
//!
//! [`hypothetical_explain`] probes for the `hypopg` extension and PG ≥ 16,
//! then (if available) runs a `BEGIN … ROLLBACK` sequence that:
//! 1. Gets a baseline `EXPLAIN (GENERIC_PLAN, FORMAT JSON)` cost.
//! 2. Creates the hypothetical index with `hypopg_create_index`.
//! 3. Gets the post-index EXPLAIN cost.
//! 4. Calls `hypopg_reset()` explicitly and rolls back the transaction.
//!
//! A RAII guard ensures `hypopg_reset()` fires even on panic (defense-in-depth;
//! mirrors `RegistryGuard` from `health/actions.rs`).  The primary cleanup is
//! always done explicitly before `drop`.

#![allow(    clippy::missing_errors_doc,
    clippy::missing_panics_doc,
    clippy::missing_const_for_fn,
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss
)]

use std::sync::Arc;

use deadpool_postgres::Pool;

use crate::query::jsonb::suggester::types::{
    HypoPgEstimate, HypoPgUnavailableReason, SuggesterError,
};

// ─────────────────────────────────────────────────────────────────────────────
// RAII guard — defense-in-depth: calls hypopg_reset() on Drop
// ─────────────────────────────────────────────────────────────────────────────

/// Tracks whether `hypopg_reset()` still needs to be called.
///
/// When the normal path completes, the caller calls [`HypoPgGuard::disarm`]
/// before dropping so the `Drop` impl is a no-op.  If we panic or return early
/// without disarming, `Drop` fires a best-effort reset via a fresh pool
/// connection.
///
/// Mirrors `RegistryGuard` in `health/actions.rs`.
struct HypoPgGuard {
    pool: Arc<Pool>,
    armed: bool,
}

impl HypoPgGuard {
    fn new(pool: Arc<Pool>) -> Self {
        Self { pool, armed: true }
    }

    /// Disarm the guard: subsequent `Drop` is a no-op.
    fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for HypoPgGuard {
    fn drop(&mut self) {
        if !self.armed {
            return;
        }
        // Best-effort: acquire a fresh client and call hypopg_reset().
        // This runs inside a sync Drop so we use `block_on` if a Tokio
        // runtime is available.
        if let Ok(handle) = tokio::runtime::Handle::try_current() {
            let pool = Arc::clone(&self.pool);
            handle.block_on(async move {
                if let Ok(client) = pool.get().await {
                    drop(client.batch_execute("SELECT hypopg_reset()").await);
                }
            });
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public entry point
// ─────────────────────────────────────────────────────────────────────────────

/// Run a hypothetical EXPLAIN cost comparison using `HypoPG`.
///
/// Returns a [`HypoPgEstimate`] — either `Computed` with cost data or
/// `Unavailable` with an explanatory reason (extension missing, PG < 16,
/// planner error, etc.).
pub async fn hypothetical_explain(    pool: &Pool,
    recommended_sql: &str,
    representative_query: &str,
) -> Result<HypoPgEstimate, SuggesterError> {
    // ── 1. Get a dedicated client ─────────────────────────────────────────
    let client = pool.get().await.map_err(|_| SuggesterError::NotConnected)?;

    // ── 2. Probe: hypopg extension present? ──────────────────────────────
    let ext_row = client
        .query_opt("SELECT 1 FROM pg_extension WHERE extname = 'hypopg'", &[])
        .await
        .map_err(|e| SuggesterError::Postgres {
            message: e.to_string(),
        })?;

    if ext_row.is_none() {
        return Ok(HypoPgEstimate::Unavailable {
            reason: HypoPgUnavailableReason::ExtensionMissing,
        });
    }

    // ── 3. Probe: PG ≥ 16? ───────────────────────────────────────────────
    let ver_row = client
        .query_one("SHOW server_version_num", &[])
        .await
        .map_err(|e| SuggesterError::Postgres {
            message: e.to_string(),
        })?;
    let ver_str: String = ver_row.try_get(0).unwrap_or_default();
    let ver_num: i64 = ver_str.trim().parse().unwrap_or(0);

    if ver_num < 160_000 {
        return Ok(HypoPgEstimate::Unavailable {
            reason: HypoPgUnavailableReason::PgVersionTooOld {
                actual: ver_str,
                required: "16".to_string(),
            },
        });
    }

    // ── 4. Run the BEGIN … ROLLBACK sequence ─────────────────────────────
    // All steps share the same client so HypoPG session-local indexes are visible.
    //
    // deadpool-postgres's `transaction()` returns a `Transaction<'_>` that
    // borrows `client`.  We begin the transaction via `batch_execute` so we
    // can hold both `client` and run helpers on it without lifetime fights.
    client
        .batch_execute("BEGIN")
        .await
        .map_err(|e| SuggesterError::Postgres {
            message: e.to_string(),
        })?;

    // Arm the RAII guard with a clone of the pool (for defense-in-depth reset).
    // We use an Arc wrapper because Pool is cheaply cloneable (internally Arc).
    let pool_arc = Arc::new(pool.clone());
    let mut guard = HypoPgGuard::new(Arc::clone(&pool_arc));

    // Baseline EXPLAIN cost (before hypothetical index).
    let baseline_cost = match explain_generic_plan_cost(&client, representative_query).await {
        Ok(c) => c,
        Err(msg) => {
            let _ = client.batch_execute("ROLLBACK").await;
            guard.disarm();
            return Ok(HypoPgEstimate::Unavailable {
                reason: HypoPgUnavailableReason::PlannerError { message: msg },
            });
        }
    };

    // Create the hypothetical index.
    if let Err(e) = client
        .query_one("SELECT hypopg_create_index($1)", &[&recommended_sql])
        .await
    {
        let _ = client.batch_execute("ROLLBACK").await;
        guard.disarm();
        return Ok(HypoPgEstimate::Unavailable {
            reason: HypoPgUnavailableReason::PlannerError {
                message: e.to_string(),
            },
        });
    }

    // Post-index EXPLAIN cost.
    let hypo_cost = match explain_generic_plan_cost(&client, representative_query).await {
        Ok(c) => c,
        Err(msg) => {
            // Explicit reset before ROLLBACK.
            let _ = client.batch_execute("SELECT hypopg_reset()").await;
            let _ = client.batch_execute("ROLLBACK").await;
            guard.disarm();
            return Ok(HypoPgEstimate::Unavailable {
                reason: HypoPgUnavailableReason::PlannerError { message: msg },
            });
        }
    };

    // Explicit reset + rollback (the guard's Drop is now redundant but harmless).
    let _ = client
        .batch_execute("SELECT hypopg_reset(); ROLLBACK")
        .await;
    guard.disarm();

    // ── 5. Compute reduction ─────────────────────────────────────────────
    let reduction_pct = if baseline_cost > 0.0 {
        ((baseline_cost - hypo_cost) / baseline_cost * 100.0).max(0.0) as f32
    } else {
        0.0
    };

    Ok(HypoPgEstimate::Computed {
        baseline_cost,
        hypothetical_cost: hypo_cost,
        reduction_pct,
    })
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/// Run `EXPLAIN (GENERIC_PLAN, FORMAT JSON) <query>` and extract
/// `Plan."Total Cost"` from the JSON output.
async fn explain_generic_plan_cost(    client: &deadpool_postgres::Client,
    query: &str,
) -> Result<f64, String> {
    let explain_sql = format!("EXPLAIN (GENERIC_PLAN, FORMAT JSON) {query}");
    let row = client
        .query_one(&explain_sql, &[])
        .await
        .map_err(|e| e.to_string())?;

    let json_val: serde_json::Value = row
        .try_get::<_, serde_json::Value>(0)
        .map_err(|e| e.to_string())?;

    extract_total_cost(&json_val)
        .ok_or_else(|| format!("could not find Plan.Total Cost in EXPLAIN output: {json_val}"))
}

/// Extract `Plan → "Total Cost"` from an `EXPLAIN FORMAT JSON` result.
///
/// The JSON structure is `[{"Plan": {"Total Cost": …, …}, …}]`.
pub(crate) fn extract_total_cost(json: &serde_json::Value) -> Option<f64> {
    json.as_array()?
        .first()?
        .get("Plan")?
        .get("Total Cost")?
        .as_f64()
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── extract_total_cost (pure JSON parsing) ────────────────────────────────

    #[test]
    fn extract_cost_from_valid_json() {
        let json = serde_json::json!([{
            "Plan": {
                "Node Type": "Seq Scan",
                "Total Cost": 12450.75
            }
        }]);
        let cost = extract_total_cost(&json);
        assert_eq!(cost, Some(12450.75));
    }

    #[test]
    fn extract_cost_from_nested_plan() {
        let json = serde_json::json!([{
            "Plan": {
                "Node Type": "Index Scan",
                "Total Cost": 380.0,
                "Plans": [{"Node Type": "Seq Scan", "Total Cost": 100.0}]
            }
        }]);
        // Always take the top-level Plan.Total Cost.
        assert_eq!(extract_total_cost(&json), Some(380.0));
    }

    #[test]
    fn extract_cost_missing_plan_key_returns_none() {
        let json = serde_json::json!([{"NotPlan": {}}]);
        assert!(extract_total_cost(&json).is_none());
    }

    #[test]
    fn extract_cost_empty_array_returns_none() {
        let json = serde_json::json!([]);
        assert!(extract_total_cost(&json).is_none());
    }

    #[test]
    fn extract_cost_non_array_returns_none() {
        let json = serde_json::json!({"Plan": {"Total Cost": 1.0}});
        assert!(extract_total_cost(&json).is_none());
    }

    // ── reduction_pct math ────────────────────────────────────────────────────

    #[test]
    fn reduction_pct_typical() {
        let baseline = 12450.0_f64;
        let hypo = 380.0_f64;
        let pct = ((baseline - hypo) / baseline * 100.0).max(0.0) as f32;
        assert!((pct - 96.95).abs() < 0.1, "pct: {pct}");
    }

    #[test]
    fn reduction_pct_no_improvement_clamps_to_zero() {
        let baseline = 100.0_f64;
        let hypo = 200.0_f64; // hypothetical is worse
        let pct = ((baseline - hypo) / baseline * 100.0).max(0.0) as f32;
        assert!(pct.abs() < f32::EPSILON, "expected 0.0, got {pct}");
    }

    #[test]
    fn reduction_pct_zero_baseline_gives_zero() {
        let baseline = 0.0_f64;
        let pct = if baseline > 0.0 {
            ((baseline - 10.0) / baseline * 100.0).max(0.0) as f32
        } else {
            0.0_f32
        };
        assert!(pct.abs() < f32::EPSILON, "expected 0.0, got {pct}");
    }
}
