//! — JSONB schema inference subsystem.
//!
//! Public orchestration API: `request_schema` returns immediately with one of
//! { Ready | Stale | Pending }, optionally spawning a background refresh task.
//! `invalidate` clears cache + spawns a fresh task. The frontend listens for
//! `jsonb-inference-updated` / `-failed` Tauri events to learn when a Pending
//! / Stale request has produced a fresh schema.

pub mod analyzer;
pub mod background;
pub mod cache;
pub mod sampler;
pub mod stats_delta;
pub mod types;

pub use background::InferenceState;

use std::sync::Arc;

use deadpool_postgres::Pool;
use serde::Serialize;
use tauri::AppHandle;
use tokio::sync::Mutex;

use crate::connection::Store;
use background::ensure_running;
use types::{FullyQualifiedColumn, InferenceError, InferredSchema};

/// TTL for cached schemas whose stats baseline is `None` (views/matviews/foreign).
const TTL_MS_FOR_STATLESS: i64 = 24 * 60 * 60 * 1000;

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum InferenceResponse {
    Ready { schema: InferredSchema },
    Stale { schema: InferredSchema },
    Pending,
}

/// Three-way response. Always returns immediately. If status != Ready,
/// caller should listen for `jsonb-inference-updated` event.
///
/// # Errors
///
/// Returns `InferenceError::Sqlite` on cache read failure.
pub async fn request_schema(
    state: Arc<InferenceState>,
    app: AppHandle,
    pool: Pool,
    store: Arc<Mutex<Store>>,
    conn_id: String,
    fqn: FullyQualifiedColumn,
) -> Result<InferenceResponse, InferenceError> {
    let cached = {
        let s = store.lock().await;
        cache::read(s.conn(), &conn_id, &fqn)?
    };

    // Best-effort stats fetch; failures are non-fatal — fall through to TTL classifier.
    let curr_stats = stats_delta::fetch_table_stats(&pool, &fqn.schema, &fqn.table)
        .await
        .ok()
        .flatten();

    if let Some(entry) = cached {
        let needs_refresh = match (&entry.stats, &curr_stats) {
            (Some(prev), Some(curr)) => {
                stats_delta::delta_exceeds_threshold(prev, curr, background::STATS_DELTA_PCT)
            }
            (None, _) | (_, None) => is_ttl_stale(entry.inferred_at),
        };
        if !needs_refresh {
            return Ok(InferenceResponse::Ready {
                schema: entry.schema,
            });
        }
        ensure_running(state, app, pool, store, conn_id, fqn, entry.stats).await;
        return Ok(InferenceResponse::Stale {
            schema: entry.schema,
        });
    }

    ensure_running(state, app, pool, store, conn_id, fqn, None).await;
    Ok(InferenceResponse::Pending)
}

/// Manual "Re-infer": clears cache row + spawns fresh background task.
///
/// # Errors
///
/// Returns `InferenceError::Sqlite` on cache delete failure.
pub async fn invalidate(
    state: Arc<InferenceState>,
    app: AppHandle,
    pool: Pool,
    store: Arc<Mutex<Store>>,
    conn_id: String,
    fqn: FullyQualifiedColumn,
) -> Result<(), InferenceError> {
    {
        let s = store.lock().await;
        cache::invalidate(s.conn(), &conn_id, &fqn)?;
    }
    ensure_running(state, app, pool, store, conn_id, fqn, None).await;
    Ok(())
}

fn is_ttl_stale(inferred_at: i64) -> bool {
    chrono::Utc::now().timestamp_millis() - inferred_at > TTL_MS_FOR_STATLESS
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ttl_classifier_zero_inferred_at_is_stale() {
        // 0 timestamp is the unix epoch; current time is way past 24h after epoch.
        assert!(is_ttl_stale(0));
    }

    #[test]
    fn ttl_classifier_recent_is_fresh() {
        let now = chrono::Utc::now().timestamp_millis();
        assert!(!is_ttl_stale(now));
    }

    #[test]
    fn ttl_classifier_just_under_24h_is_fresh() {
        let just_under_24h_ago = chrono::Utc::now().timestamp_millis() - (23 * 60 * 60 * 1000);
        assert!(!is_ttl_stale(just_under_24h_ago));
    }

    #[test]
    fn ttl_classifier_just_over_24h_is_stale() {
        let just_over_24h_ago = chrono::Utc::now().timestamp_millis() - (25 * 60 * 60 * 1000);
        assert!(is_ttl_stale(just_over_24h_ago));
    }
}
