#![allow(    clippy::missing_errors_doc,
    clippy::missing_panics_doc,
    clippy::doc_markdown,
    clippy::too_many_lines,
    clippy::needless_pass_by_value,
    clippy::cast_precision_loss
)]

//! — Tauri command handlers for the Health Screen.
//!
//! Each handler:
//! 1. Looks up the live pool for `conn_id` in `state.pools` →
//! `CardError::NotConnected` if absent.
//! 2. Acquires a client from the pool (errors → `CardError::QueryFailed`).
//! 3. Runs the corresponding SQL from `super::queries`.
//! 4. Maps PG errors via `classify` so SQLSTATE 42501 / 42704 / 42883 land
//! on dedicated `Forbidden` / `Unavailable` variants the UI renders
//! differently.

use std::collections::BTreeMap;

use deadpool_postgres::Pool;
use tauri::State;

use crate::health::queries;
use crate::health::snapshots;
use crate::health::types::{
    ActiveConnectionsData, BloatRow, BloatTopData, CacheHitData, CardError, DbSizeData,
    HealthSnapshotRow, LongQueryRow, LongRunningData, MissingIndexRow, MissingIndexesData,
    ReplicationLagData, ReplicationSlotRow, ReplicationState, SlowQueriesData, SlowQueryRow,
    UnusedIndexRow, UnusedIndexesData, VacuumRow, VacuumStatusData, WalThroughputData,
};
use crate::AppState;

// ---------------------------------------------------------------------------
// Error classification + helpers
// ---------------------------------------------------------------------------

/// Translate a `tokio_postgres::Error` into a discriminated `CardError`.
///
/// SQLSTATE 42501 → `Forbidden { required_role: "pg_monitor" }`
/// SQLSTATE 42704 / 42883 → `Unavailable { extension, install_sql }` (extension
/// name extracted from the error message — see `extract_extension_name`).
/// `pg_stat_statements must be loaded via "shared_preload_libraries"` →
/// `Unavailable { extension: "pg_stat_statements", install_sql: ... }`.
/// This message has SQLSTATE 55000 (`object_not_in_prerequisite_state`)
/// and only fires when the extension exists in `pg_extension` but the C
/// library wasn't preloaded — exactly the half-installed state where
/// `CREATE EXTENSION` already succeeded so the user needs the postgres
/// conf line, not another `CREATE EXTENSION`. We surface the longer
/// guidance through `install_sql` so the existing Unavailable card
/// renders without a new state variant (/).
/// Everything else → `QueryFailed { message }`.
#[must_use]
pub fn classify(err: tokio_postgres::Error) -> CardError {
    err.as_db_error().map_or_else(        || CardError::QueryFailed {
            message: err.to_string(),
        },
        |db_err| {
            let code = db_err.code().code();
            let message = db_err.message();
            if message.contains("must be loaded via \"shared_preload_libraries\"") {
                let extension = extract_extension_name(message);
                return CardError::Unavailable {
                    install_sql: format!(                        "ALTER SYSTEM SET shared_preload_libraries = '{extension}';\n-- then restart PostgreSQL, then:\nCREATE EXTENSION IF NOT EXISTS {extension};"
),
                    extension,
                };
            }
            match code {
                "42501" => CardError::Forbidden {
                    required_role: "pg_monitor".into(),
                },
                "42704" | "42883" => {
                    let extension = extract_extension_name(message);
                    CardError::Unavailable {
                        install_sql: format!("CREATE EXTENSION {extension};"),
                        extension,
                    }
                }
                _ => CardError::QueryFailed {
                    message: message.to_string(),
                },
            }
        },
)
}

/// Heuristic extraction of an extension or function name from a PG error
/// message. Covers the common forms:
/// - `extension "pg_stat_statements" is not available`
/// - `function pg_stat_statements(...) does not exist`
/// - `relation "pg_stat_statements_info" does not exist`
///
/// Falls back to the first `pg_…` token. If nothing matches, returns
/// `"unknown"` so the install_sql template still renders something
/// recognizable rather than empty.
fn extract_extension_name(msg: &str) -> String {
    // Try double-quoted name first — most precise.
    if let Some(start) = msg.find('"') {
        if let Some(rest) = msg.get(start + 1..) {
            if let Some(end) = rest.find('"') {
                let name = &rest[..end];
                if !name.is_empty() {
                    return name.to_string();
                }
            }
        }
    }
    // Otherwise sniff for a token starting with "pg_".
    for tok in msg.split(|c: char| !c.is_ascii_alphanumeric() && c != '_') {
        if tok.starts_with("pg_") && tok.len() > 3 {
            return tok.to_string();
        }
    }
    "unknown".to_string()
}

async fn require_pool(state: &AppState, conn_id: &str) -> Result<Pool, CardError> {
    state
        .pools
        .get(conn_id)
        .await
        .ok_or(CardError::NotConnected)
}

async fn pool_client(pool: &Pool) -> Result<deadpool_postgres::Client, CardError> {
    pool.get().await.map_err(|e| CardError::QueryFailed {
        message: e.to_string(),
    })
}

/// Replication lag escalates the card to `Lagging` when any slot exceeds
/// 100 MiB of WAL backlog OR is stalled >60 s without a reply. Both
/// thresholds are conservative — small replication clusters routinely
/// catch a few MB or a few seconds during checkpoints.
const LAG_BYTES_THRESHOLD: i64 = 100 * 1024 * 1024;
const LAG_SECONDS_THRESHOLD: f64 = 60.0;

// ---------------------------------------------------------------------------
// 10 card handlers — each is a thin Tauri wrapper around an inherent helper
// on AppState so integration tests can drive them without the Tauri runtime.
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn health_db_size(    state: State<'_, AppState>,
    conn_id: String,
) -> Result<DbSizeData, CardError> {
    state.health_db_size(&conn_id).await
}

#[tauri::command]
pub async fn health_bloat(    state: State<'_, AppState>,
    conn_id: String,
) -> Result<BloatTopData, CardError> {
    state.health_bloat(&conn_id).await
}

#[tauri::command]
pub async fn health_slow_queries(    state: State<'_, AppState>,
    conn_id: String,
) -> Result<SlowQueriesData, CardError> {
    state.health_slow_queries(&conn_id).await
}

#[tauri::command]
pub async fn health_missing_indexes(    state: State<'_, AppState>,
    conn_id: String,
) -> Result<MissingIndexesData, CardError> {
    state.health_missing_indexes(&conn_id).await
}

#[tauri::command]
pub async fn health_unused_indexes(    state: State<'_, AppState>,
    conn_id: String,
) -> Result<UnusedIndexesData, CardError> {
    state.health_unused_indexes(&conn_id).await
}

#[tauri::command]
pub async fn health_cache_hit(    state: State<'_, AppState>,
    conn_id: String,
) -> Result<CacheHitData, CardError> {
    state.health_cache_hit(&conn_id).await
}

#[tauri::command]
pub async fn health_active_connections(    state: State<'_, AppState>,
    conn_id: String,
) -> Result<ActiveConnectionsData, CardError> {
    state.health_active_connections(&conn_id).await
}

#[tauri::command]
pub async fn health_long_running(    state: State<'_, AppState>,
    conn_id: String,
) -> Result<LongRunningData, CardError> {
    state.health_long_running(&conn_id).await
}

#[tauri::command]
pub async fn health_vacuum_status(    state: State<'_, AppState>,
    conn_id: String,
) -> Result<VacuumStatusData, CardError> {
    state.health_vacuum_status(&conn_id).await
}

#[tauri::command]
pub async fn health_replication_lag(    state: State<'_, AppState>,
    conn_id: String,
) -> Result<ReplicationLagData, CardError> {
    state.health_replication_lag(&conn_id).await
}

#[tauri::command]
pub async fn health_wal_throughput(    state: State<'_, AppState>,
    conn_id: String,
) -> Result<WalThroughputData, CardError> {
    state.health_wal_throughput(&conn_id).await
}

#[tauri::command]
pub async fn health_snapshots_save(    state: State<'_, AppState>,
    conn_id: String,
    db_size_bytes: i64,
) -> Result<(), CardError> {
    state.health_snapshots_save(&conn_id, db_size_bytes).await
}

#[tauri::command]
pub async fn health_snapshots_recent(    state: State<'_, AppState>,
    conn_id: String,
    days: i64,
) -> Result<Vec<HealthSnapshotRow>, CardError> {
    state.health_snapshots_recent(&conn_id, days).await
}

// ---------------------------------------------------------------------------
// Inherent helpers on AppState (testable without Tauri runtime).
// ---------------------------------------------------------------------------

impl AppState {
    pub async fn health_db_size(&self, conn_id: &str) -> Result<DbSizeData, CardError> {
        let pool = require_pool(self, conn_id).await?;
        let client = pool_client(&pool).await?;
        let row = client
            .query_one(queries::DB_SIZE, &[])
            .await
            .map_err(classify)?;
        let bytes: i64 = row.get("bytes");
        let pretty: String = row.get("pretty");

        // Read snapshot history for the sparkline. SQLite errors are surfaced
        // as QueryFailed — the card UI still renders "value+pretty" when
        // sparkline data is unavailable, but a hard error is more honest than
        // silently dropping the trend.
        let snapshots_rows = {
            let store = self.store.lock().await;
            snapshots::recent(store.conn(), conn_id, 7).map_err(|e| CardError::QueryFailed {
                message: e.to_string(),
            })?
        };

        let mut sparkline_points: Vec<i64> =
            snapshots_rows.iter().map(|r| r.db_size_bytes).collect();

        // Append "current" reading at the end so the sparkline renders the
        // freshest known datapoint even before a save lands. (Frontend writes
        // the snapshot in a separate call after this returns.)
        sparkline_points.push(bytes);

        let (growth_7d_bytes, growth_7d_pct) =
            snapshots_rows.first().map_or((None, None), |oldest| {
                let delta = bytes - oldest.db_size_bytes;
                let pct = if oldest.db_size_bytes == 0 {
                    None
                } else {
                    #[allow(clippy::cast_precision_loss)]
                    Some((delta as f64 / oldest.db_size_bytes as f64) * 100.0)
                };
                (Some(delta), pct)
            });

        Ok(DbSizeData {
            bytes,
            pretty,
            growth_7d_bytes,
            growth_7d_pct,
            sparkline_points,
        })
    }

    pub async fn health_bloat(&self, conn_id: &str) -> Result<BloatTopData, CardError> {
        let pool = require_pool(self, conn_id).await?;
        let client = pool_client(&pool).await?;
        let rows = client
            .query(queries::BLOAT_TOP, &[])
            .await
            .map_err(classify)?;
        let out: Vec<BloatRow> = rows
            .iter()
            .map(|r| BloatRow {
                schema: r.get("schema"),
                table: r.get("table"),
                bloat_pct: r.get::<_, f64>("bloat_pct"),
                bloat_bytes: r.get::<_, i64>("bloat_bytes"),
            })
            .collect();
        Ok(BloatTopData { rows: out })
    }

    pub async fn health_slow_queries(&self, conn_id: &str) -> Result<SlowQueriesData, CardError> {
        let pool = require_pool(self, conn_id).await?;
        let client = pool_client(&pool).await?;

        // Probe pg_stat_statements first so missing-extension surfaces as
        // Unavailable with the right install SQL, not as a generic
        // "relation does not exist" QueryFailed.
        let probe = client
            .query(queries::PG_STAT_STATEMENTS_PROBE, &[])
            .await
            .map_err(classify)?;
        if probe.is_empty() {
            return Err(CardError::Unavailable {
                extension: "pg_stat_statements".into(),
                install_sql: "CREATE EXTENSION pg_stat_statements;".into(),
            });
        }

        let rows = client
            .query(queries::SLOW_QUERIES, &[])
            .await
            .map_err(classify)?;
        let out: Vec<SlowQueryRow> = rows
            .iter()
            .map(|r| SlowQueryRow {
                query: r.get("query"),
                mean_time_ms: r.get::<_, f64>("mean_time_ms"),
                total_time_ms: r.get::<_, f64>("total_time_ms"),
                calls: r.get::<_, i64>("calls"),
            })
            .collect();
        Ok(SlowQueriesData { rows: out })
    }

    pub async fn health_missing_indexes(        &self,
        conn_id: &str,
) -> Result<MissingIndexesData, CardError> {
        let pool = require_pool(self, conn_id).await?;
        let client = pool_client(&pool).await?;
        let rows = client
            .query(queries::MISSING_INDEXES, &[])
            .await
            .map_err(classify)?;
        let out: Vec<MissingIndexRow> = rows
            .iter()
            .map(|r| MissingIndexRow {
                schema: r.get("schema"),
                table: r.get("table"),
                seq_scan: r.get::<_, i64>("seq_scan"),
                seq_tup_read: r.get::<_, i64>("seq_tup_read"),
                index_scan: r.get::<_, i64>("index_scan"),
            })
            .collect();
        Ok(MissingIndexesData { rows: out })
    }

    pub async fn health_unused_indexes(        &self,
        conn_id: &str,
) -> Result<UnusedIndexesData, CardError> {
        let pool = require_pool(self, conn_id).await?;
        let client = pool_client(&pool).await?;
        let rows = client
            .query(queries::UNUSED_INDEXES, &[])
            .await
            .map_err(classify)?;
        let out: Vec<UnusedIndexRow> = rows
            .iter()
            .map(|r| UnusedIndexRow {
                schema: r.get("schema"),
                index: r.get("index"),
                on_table: r.get("on_table"),
                size_bytes: r.get::<_, i64>("size_bytes"),
            })
            .collect();
        Ok(UnusedIndexesData { rows: out })
    }

    pub async fn health_cache_hit(&self, conn_id: &str) -> Result<CacheHitData, CardError> {
        let pool = require_pool(self, conn_id).await?;
        let client = pool_client(&pool).await?;
        let row = client
            .query_one(queries::CACHE_HIT, &[])
            .await
            .map_err(classify)?;
        // SQL pre-casts to float8 so tokio-postgres can read it directly.
        let ratio_pct: f64 = row.get::<_, f64>("ratio_pct");
        Ok(CacheHitData { ratio_pct })
    }

    pub async fn health_active_connections(        &self,
        conn_id: &str,
) -> Result<ActiveConnectionsData, CardError> {
        let pool = require_pool(self, conn_id).await?;
        let client = pool_client(&pool).await?;

        let rows = client
            .query(queries::ACTIVE_CONNECTIONS_BY_STATE, &[])
            .await
            .map_err(classify)?;
        let mut by_state: BTreeMap<String, i64> = BTreeMap::new();
        let mut current = 0_i64;
        for r in &rows {
            let state: String = r.get("state");
            let cnt: i64 = r.get("cnt");
            current += cnt;
            by_state.insert(state, cnt);
        }

        let max_row = client
            .query_one(queries::SHOW_MAX_CONNECTIONS, &[])
            .await
            .map_err(classify)?;
        let max_str: String = max_row.get(0);
        let max: i64 = max_str.parse().unwrap_or(0);

        Ok(ActiveConnectionsData {
            current,
            max,
            by_state,
        })
    }

    pub async fn health_long_running(&self, conn_id: &str) -> Result<LongRunningData, CardError> {
        let pool = require_pool(self, conn_id).await?;
        let client = pool_client(&pool).await?;
        let rows = client
            .query(queries::LONG_RUNNING, &[])
            .await
            .map_err(classify)?;
        let out: Vec<LongQueryRow> = rows
            .iter()
            .map(|r| LongQueryRow {
                pid: r.get::<_, i32>("pid"),
                duration_seconds: r.get::<_, f64>("duration_seconds"),
                query: r.get("query"),
                state: r.get("state"),
                username: r.get("username"),
            })
            .collect();
        Ok(LongRunningData { rows: out })
    }

    pub async fn health_vacuum_status(&self, conn_id: &str) -> Result<VacuumStatusData, CardError> {
        let pool = require_pool(self, conn_id).await?;
        let client = pool_client(&pool).await?;
        let rows = client
            .query(queries::VACUUM_STATUS, &[])
            .await
            .map_err(classify)?;
        let out: Vec<VacuumRow> = rows
            .iter()
            .map(|r| VacuumRow {
                schema: r.get("schema"),
                table: r.get("table"),
                last_vacuum: r.get::<_, Option<String>>("last_vacuum"),
                last_autovacuum: r.get::<_, Option<String>>("last_autovacuum"),
                days_since: r.get::<_, Option<i64>>("days_since"),
            })
            .collect();
        Ok(VacuumStatusData { rows: out })
    }

    pub async fn health_replication_lag(        &self,
        conn_id: &str,
) -> Result<ReplicationLagData, CardError> {
        let pool = require_pool(self, conn_id).await?;
        let client = pool_client(&pool).await?;
        let rows = client
            .query(queries::REPLICATION_LAG, &[])
            .await
            .map_err(classify)?;
        if rows.is_empty() {
            return Ok(ReplicationLagData {
                state: ReplicationState::NoReplicas,
                slots: Vec::new(),
            });
        }

        let mut slots: Vec<ReplicationSlotRow> = Vec::with_capacity(rows.len());
        let mut any_streaming = false;
        let mut any_lagging = false;
        for r in &rows {
            let lag_bytes: Option<i64> = r.try_get::<_, i64>("lag_bytes").ok();
            let lag_seconds: Option<f64> = r.try_get::<_, f64>("lag_seconds").ok();
            let state: String = r.get("state");

            if state == "streaming" {
                any_streaming = true;
            }
            // Lag thresholds: >100 MB OR >60 s on any slot promotes to Lagging.
            // Chosen to match spec §4.4 wording — streaming + small lag is OK,
            // big lag (or any time-based stall) flips the card to red.
            if lag_bytes.is_some_and(|b| b > LAG_BYTES_THRESHOLD)
                || lag_seconds.is_some_and(|s| s > LAG_SECONDS_THRESHOLD)
            {
                any_lagging = true;
            }

            slots.push(ReplicationSlotRow {
                slot: r.get("slot"),
                lag_bytes,
                lag_seconds,
                state,
            });
        }

        let state = if any_lagging {
            ReplicationState::Lagging
        } else if any_streaming {
            ReplicationState::Streaming
        } else {
            // Slots exist but none streaming and none lagging → treat as
            // "configured but inactive": still render slots, label as
            // NoReplicas so the UI's positive-empty branch fires.
            ReplicationState::NoReplicas
        };

        Ok(ReplicationLagData { state, slots })
    }

    pub async fn health_wal_throughput(        &self,
        conn_id: &str,
) -> Result<WalThroughputData, CardError> {
        let pool = require_pool(self, conn_id).await?;
        let client = pool_client(&pool).await?;

        // pg_stat_wal landed in PG 14. Probe via to_regclass so older
        // servers surface as Unavailable instead of a relation-error.
        let probe = client
            .query(queries::PG_STAT_WAL_PROBE, &[])
            .await
            .map_err(classify)?;
        let exists = probe.first().and_then(|r| r.try_get::<_, bool>(0).ok()) == Some(true);
        if !exists {
            return Err(CardError::Unavailable {
                extension: "pg_stat_wal (PostgreSQL 14+)".into(),
                install_sql: "-- WAL throughput requires PostgreSQL 14 or newer".into(),
            });
        }

        let row = client
            .query_opt(queries::WAL_THROUGHPUT, &[])
            .await
            .map_err(classify)?;
        let Some(row) = row else {
            // pg_stat_wal exists but the row is empty (shouldn't happen
            // in practice — the view is a singleton). Treat as no data.
            return Ok(WalThroughputData {
                bytes_per_sec: 0.0,
                total_bytes: 0,
                seconds_since_reset: 0.0,
            });
        };
        let total_bytes: i64 = row.get("total_bytes");
        let seconds_since_reset: f64 = row.get("seconds_since_reset");
        let bytes_per_sec = if seconds_since_reset > 0.0 {
            total_bytes as f64 / seconds_since_reset
        } else {
            0.0
        };
        Ok(WalThroughputData {
            bytes_per_sec,
            total_bytes,
            seconds_since_reset,
        })
    }

    pub async fn health_snapshots_save(        &self,
        conn_id: &str,
        db_size_bytes: i64,
) -> Result<(), CardError> {
        let now = chrono::Utc::now().to_rfc3339();
        let mut store = self.store.lock().await;
        snapshots::save(store.conn_mut(), conn_id, &now, db_size_bytes).map_err(|e| {
            CardError::QueryFailed {
                message: e.to_string(),
            }
        })
    }

    pub async fn health_snapshots_recent(        &self,
        conn_id: &str,
        days: i64,
) -> Result<Vec<HealthSnapshotRow>, CardError> {
        let store = self.store.lock().await;
        snapshots::recent(store.conn(), conn_id, days).map_err(|e| CardError::QueryFailed {
            message: e.to_string(),
        })
    }
}

// ─────────────────────────────────────────────────────────────────────────
// — Health action commands.
// ─────────────────────────────────────────────────────────────────────────

use crate::health::actions;
use crate::health::types::{ActionError, ActionResult, ProgressSnapshot};

#[tauri::command]
pub async fn health_action_reindex_table(    conn_id: String,
    schema: String,
    table: String,
    state: tauri::State<'_, crate::AppState>,
    app: tauri::AppHandle,
) -> Result<ActionResult, ActionError> {
    let pool = state
        .pools
        .get(&conn_id)
        .await
        .ok_or(ActionError::NotConnected)?;
    actions::do_reindex_table(&pool, &state.action_registry, &app, &schema, &table).await
}

#[tauri::command]
pub async fn health_action_vacuum(    conn_id: String,
    schema: String,
    table: String,
    state: tauri::State<'_, crate::AppState>,
    app: tauri::AppHandle,
) -> Result<ActionResult, ActionError> {
    let pool = state
        .pools
        .get(&conn_id)
        .await
        .ok_or(ActionError::NotConnected)?;
    actions::do_vacuum(&pool, &state.action_registry, &app, &schema, &table).await
}

#[tauri::command]
pub async fn health_action_analyze(    conn_id: String,
    schema: String,
    table: String,
    state: tauri::State<'_, crate::AppState>,
) -> Result<ActionResult, ActionError> {
    let pool = state
        .pools
        .get(&conn_id)
        .await
        .ok_or(ActionError::NotConnected)?;
    actions::do_analyze(&pool, &schema, &table).await
}

#[tauri::command]
pub async fn health_action_drop_index(    conn_id: String,
    schema: String,
    index: String,
    state: tauri::State<'_, crate::AppState>,
) -> Result<ActionResult, ActionError> {
    let pool = state
        .pools
        .get(&conn_id)
        .await
        .ok_or(ActionError::NotConnected)?;
    actions::do_drop_index(&pool, &schema, &index).await
}

#[tauri::command]
pub async fn health_action_kill_pid(    conn_id: String,
    pid: i32,
    terminate: bool,
    state: tauri::State<'_, crate::AppState>,
) -> Result<ActionResult, ActionError> {
    let pool = state
        .pools
        .get(&conn_id)
        .await
        .ok_or(ActionError::NotConnected)?;
    actions::do_kill_pid(&pool, pid, terminate).await
}

#[tauri::command]
pub async fn health_action_check_pid(    conn_id: String,
    pid: i32,
    state: tauri::State<'_, crate::AppState>,
) -> Result<bool, ActionError> {
    let pool = state
        .pools
        .get(&conn_id)
        .await
        .ok_or(ActionError::NotConnected)?;
    actions::check_pid(&pool, pid).await
}

#[tauri::command]
pub async fn health_action_progress(    conn_id: String,
    action_id: String,
    state: tauri::State<'_, crate::AppState>,
) -> Result<ProgressSnapshot, ActionError> {
    let entry = state.action_registry.get(&action_id);
    let Some(entry) = entry else {
        return Ok(ProgressSnapshot {
            action_id,
            phase: String::new(),
            percent: None,
            blocks_scanned: None,
            blocks_total: None,
            finished: true,
        });
    };
    let pool = state
        .pools
        .get(&conn_id)
        .await
        .ok_or(ActionError::NotConnected)?;
    let (phase, scanned, total) = actions::read_progress(&pool, entry).await?;
    let percent = match (scanned, total) {
        (Some(s), Some(t)) if t > 0 => Some((s as f64 / t as f64) * 100.0),
        _ => None,
    };
    Ok(ProgressSnapshot {
        action_id,
        phase,
        percent,
        blocks_scanned: scanned,
        blocks_total: total,
        finished: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // -----------------------------------------------------------------------
    // extract_extension_name — forms commonly seen in PG error messages.
    // -----------------------------------------------------------------------

    #[test]
    fn extract_quoted_extension_name() {
        let name =
            extract_extension_name("extension \"pg_stat_statements\" is not available, run...");
        assert_eq!(name, "pg_stat_statements");
    }

    #[test]
    fn extract_unquoted_pg_token() {
        let name = extract_extension_name("function pg_stat_statements(boolean) does not exist");
        assert_eq!(name, "pg_stat_statements");
    }

    #[test]
    fn extract_falls_back_to_unknown() {
        let name = extract_extension_name("totally unrelated message");
        assert_eq!(name, "unknown");
    }

    // -----------------------------------------------------------------------
    // classify — direct mapping is hard to unit-test without a real
    // tokio_postgres::Error, so we exercise it end-to-end in the integration
    // test (against testcontainers) and rely on the helper test above for
    // the embedded extraction logic.
    // -----------------------------------------------------------------------
}
