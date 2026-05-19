#![allow(clippy::missing_errors_doc, clippy::doc_markdown)]

//! — wire-format types for the Health Screen.
//!
//! Every card has a dedicated *Data struct so the frontend zod schema
//! mirrors the Rust shape one-to-one (camelCase via serde rename_all).
//! Errors are routed through one discriminated `CardError` enum.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// WAL throughput averaged from `pg_stat_wal` (PG ≥ 14): bytes written
/// since `stats_reset`, divided by elapsed seconds. The card shows the
/// rate in MB/s plus a sparkline of the last few snapshots taken between
/// refreshes (kept short by the frontend, no backend persistence).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WalThroughputData {
    pub bytes_per_sec: f64,
    /// Cumulative bytes since `stats_reset`. Useful for the frontend if
    /// it wants to compute an instantaneous rate between samples.
    pub total_bytes: i64,
    pub seconds_since_reset: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, thiserror::Error)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CardError {
    /// Required PG extension not installed (e.g. pg_stat_statements).
    #[error("extension {extension} not installed")]
    #[serde(rename_all = "camelCase")]
    Unavailable {
        extension: String,
        install_sql: String,
    },

    /// SQLSTATE 42501 — typical for pg_stat_replication / pg_stat_activity
    /// without pg_monitor role.
    #[error("insufficient privileges: requires {required_role}")]
    #[serde(rename_all = "camelCase")]
    Forbidden { required_role: String },

    /// Query timed out / connection broke / unexpected PG error.
    #[error("query failed: {message}")]
    QueryFailed { message: String },

    /// Pool / connection lifecycle error before query.
    #[error("not connected")]
    NotConnected,
}

// ---------- per-card data ----------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbSizeData {
    pub bytes: i64,
    pub pretty: String,
    pub growth_7d_bytes: Option<i64>,
    pub growth_7d_pct: Option<f64>,
    pub sparkline_points: Vec<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BloatTopData {
    pub rows: Vec<BloatRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BloatRow {
    pub schema: String,
    pub table: String,
    pub bloat_pct: f64,
    pub bloat_bytes: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlowQueriesData {
    pub rows: Vec<SlowQueryRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlowQueryRow {
    pub query: String,
    pub mean_time_ms: f64,
    pub total_time_ms: f64,
    pub calls: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MissingIndexesData {
    pub rows: Vec<MissingIndexRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MissingIndexRow {
    pub schema: String,
    pub table: String,
    pub seq_scan: i64,
    pub seq_tup_read: i64,
    pub index_scan: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnusedIndexesData {
    pub rows: Vec<UnusedIndexRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnusedIndexRow {
    pub schema: String,
    pub index: String,
    pub on_table: String,
    pub size_bytes: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheHitData {
    pub ratio_pct: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveConnectionsData {
    pub current: i64,
    pub max: i64,
    pub by_state: BTreeMap<String, i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LongRunningData {
    pub rows: Vec<LongQueryRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LongQueryRow {
    pub pid: i32,
    pub duration_seconds: f64,
    pub query: String,
    pub state: String,
    pub username: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VacuumStatusData {
    pub rows: Vec<VacuumRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VacuumRow {
    pub schema: String,
    pub table: String,
    pub last_vacuum: Option<String>,
    pub last_autovacuum: Option<String>,
    pub days_since: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReplicationState {
    NoReplicas,
    Streaming,
    Lagging,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReplicationLagData {
    pub state: ReplicationState,
    pub slots: Vec<ReplicationSlotRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplicationSlotRow {
    pub slot: String,
    pub lag_bytes: Option<i64>,
    pub lag_seconds: Option<f64>,
    pub state: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthSnapshotRow {
    pub taken_at: String,
    pub db_size_bytes: i64,
}

// ─────────────────────────────────────────────────────────────────────────
// — action types (one-click fixes from Health Screen).
// ─────────────────────────────────────────────────────────────────────────

/// Discriminator for the registry — also serialized to the frontend so
/// `health_action_progress` knows which `pg_stat_progress_*` view to query.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ActionKind {
    ReindexTable,
    Vacuum,
    Analyze,
    DropIndex,
    KillPid,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionResult {
    pub action_id: String,
    pub duration_ms: u64,
    pub status: ActionStatus,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ActionStatus {
    /// Default — the SQL completed normally.
    Completed,
    /// `pg_cancel_backend` returned `false` (PID already gone).
    NotFound,
    /// `pg_terminate_backend` was used (after fallback or direct).
    Terminated,
}

#[derive(Debug, Clone, Serialize, Deserialize, thiserror::Error)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ActionError {
    #[error("not connected")]
    NotConnected,
    #[error("forbidden: requires {required}")]
    Forbidden { required: String },
    #[error("active transaction")]
    ActiveTransaction,
    #[error("object not found: {target}")]
    ObjectNotFound { target: String },
    #[error("query failed [{sqlstate}]: {message}")]
    QueryFailed { sqlstate: String, message: String },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressSnapshot {
    pub action_id: String,
    pub phase: String,
    pub percent: Option<f64>,
    pub blocks_scanned: Option<i64>,
    pub blocks_total: Option<i64>,
    pub finished: bool,
}

/// Payload for the `health-action-started` Tauri event. Emitted by every
/// long action right after `pg_backend_pid()` is known and registry insert
/// succeeded — frontend uses it to start polling.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionStartedPayload {
    pub action_id: String,
    pub pid: i32,
}
