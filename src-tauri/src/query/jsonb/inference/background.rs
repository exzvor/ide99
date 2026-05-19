//! Background-task driver for JSONB schema inference.
//!
//! Owns:
//! - the in-flight dedup map: at most one running task per
//! (`conn_id`, fqn) tuple.
//! - the lifecycle: fetch stats → sample → analyze → cache.write
//! → emit Tauri event.
//!
//! Failures emit `jsonb-inference-failed` with a string reason and
//! still clean up `in_flight` on drop.

use std::collections::HashSet;
use std::sync::Arc;

use deadpool_postgres::Pool;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;

use super::analyzer::analyze;
use super::cache;
use super::sampler::sample_jsonb_column;
use super::stats_delta::{delta_exceeds_threshold, fetch_table_stats};
use super::types::{FullyQualifiedColumn, InferredSchema, TableStats};
use crate::connection::Store;

pub const EVENT_UPDATED: &str = "jsonb-inference-updated";
pub const EVENT_FAILED: &str = "jsonb-inference-failed";
pub const STATS_DELTA_PCT: f32 = 5.0;

#[derive(Debug, Clone, Hash, Eq, PartialEq)]
pub struct CacheKey {
    pub conn_id: String,
    pub fqn: FullyQualifiedColumn,
}

pub struct InferenceState {
    in_flight: Arc<Mutex<HashSet<CacheKey>>>,
}

impl InferenceState {
    #[must_use]
    pub fn new() -> Self {
        Self {
            in_flight: Arc::new(Mutex::new(HashSet::new())),
        }
    }
}

impl Default for InferenceState {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdatedPayload {
    pub conn_id: String,
    pub fqn: FullyQualifiedColumn,
    pub schema: InferredSchema,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FailedPayload {
    pub conn_id: String,
    pub fqn: FullyQualifiedColumn,
    pub message: String,
}

/// Spawn a background task to (re)compute the schema for `(conn_id, fqn)`.
/// No-op if a task for the same key is already running.
pub async fn ensure_running(
    state: Arc<InferenceState>,
    app: AppHandle,
    pool: Pool,
    store: Arc<Mutex<Store>>,
    conn_id: String,
    fqn: FullyQualifiedColumn,
    previous_stats: Option<TableStats>,
) {
    let key = CacheKey {
        conn_id: conn_id.clone(),
        fqn: fqn.clone(),
    };
    {
        let mut guard = state.in_flight.lock().await;
        if guard.contains(&key) {
            return;
        }
        guard.insert(key.clone());
    }

    let in_flight = state.in_flight.clone();
    let key_for_cleanup = key;
    tokio::spawn(async move {
        let result = run_once(&pool, store.clone(), &conn_id, &fqn, previous_stats).await;
        match result {
            Ok(schema) => {
                let _ = app.emit(
                    EVENT_UPDATED,
                    UpdatedPayload {
                        conn_id: conn_id.clone(),
                        fqn: fqn.clone(),
                        schema,
                    },
                );
            }
            Err(e) => {
                tracing::warn!(                    conn_id = %conn_id,
                                    schema = %fqn.schema,
                                    table = %fqn.table,
                                    column = %fqn.column,
                                    error = %e,
                                    "jsonb inference task failed"
                );
                let _ = app.emit(
                    EVENT_FAILED,
                    FailedPayload {
                        conn_id,
                        fqn,
                        message: e.to_string(),
                    },
                );
            }
        }
        {
            let mut guard = in_flight.lock().await;
            guard.remove(&key_for_cleanup);
        }
    });
}

async fn run_once(
    pool: &Pool,
    store: Arc<Mutex<Store>>,
    conn_id: &str,
    fqn: &FullyQualifiedColumn,
    previous_stats: Option<TableStats>,
) -> Result<InferredSchema, super::types::InferenceError> {
    let curr_stats = fetch_table_stats(pool, &fqn.schema, &fqn.table)
        .await
        .ok()
        .flatten();

    // Stats-only refresh: cache exists, both stats available, delta below threshold.
    // Skip resampling, just bump the stats baseline so future calls return ready.
    if let (Some(prev), Some(curr)) = (previous_stats.as_ref(), curr_stats.as_ref()) {
        if !delta_exceeds_threshold(prev, curr, STATS_DELTA_PCT) {
            let cached_schema = {
                let s = store.lock().await;
                if let Some(entry) = cache::read(s.conn(), conn_id, fqn)? {
                    cache::write(s.conn(), conn_id, fqn, &entry.schema, Some(curr))?;
                    drop(s);
                    Some(entry.schema)
                } else {
                    None
                }
            };
            if let Some(schema) = cached_schema {
                return Ok(schema);
            }
        }
    }

    let samples = sample_jsonb_column(pool, fqn).await?;
    let schema = analyze(&samples);
    {
        let s = store.lock().await;
        cache::write(s.conn(), conn_id, fqn, &schema, curr_stats.as_ref())?;
    }
    Ok(schema)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn in_flight_dedup_prevents_double_insert() {
        let state = Arc::new(InferenceState::new());
        let key = CacheKey {
            conn_id: "c1".into(),
            fqn: FullyQualifiedColumn {
                schema: "s".into(),
                table: "t".into(),
                column: "c".into(),
            },
        };
        let mut g = state.in_flight.lock().await;
        assert!(g.insert(key.clone()));
        // Inserting the same key again returns false — already in-flight.
        assert!(!g.insert(key));
        drop(g);
    }

    #[test]
    fn cache_key_eq_uses_all_fields() {
        let a = CacheKey {
            conn_id: "x".into(),
            fqn: FullyQualifiedColumn {
                schema: "s".into(),
                table: "t".into(),
                column: "c".into(),
            },
        };
        let b = a.clone();
        assert_eq!(a, b);
        let mut diff = a.clone();
        diff.fqn.column = "d".into();
        assert_ne!(a, diff);
    }
}
