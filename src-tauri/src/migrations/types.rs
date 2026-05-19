//! DTOs shared across migration submodules + serialized to the frontend.

#![allow(clippy::struct_excessive_bools)]
#![allow(clippy::missing_errors_doc, clippy::missing_panics_doc)]

use std::collections::HashMap;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum MigrationStatus {
    Pending,
    Applied,
    Dirty,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Migration {
    pub version: String,
    pub name: String,
    pub up_path: String,
    pub down_path: Option<String>,
    pub status: MigrationStatus,
    pub applied_at: Option<String>,
    pub applied_by: Option<String>,
    pub duration_ms: Option<i64>,
    pub disk_checksum: String,
    pub applied_checksum: Option<String>,
    pub has_snapshot: bool,
    pub parse_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ApplyMode {
    Single { version: String },
    Range { from: String, to: String },
    AllPending,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppliedEntry {
    pub version: String,
    pub duration_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyResult {
    pub applied: Vec<AppliedEntry>,
    pub failed: Option<ApplyFailure>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyFailure {
    pub version: String,
    pub error: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RollbackResult {
    pub rolled_back: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListResult {
    pub migrations: Vec<Migration>,
    pub tracking_table_missing: bool,
    /// persisted migrations directory for the
    /// connection so the frontend can hydrate its store on first mount
    /// (after app restart). `None` when the user hasn't picked one yet.
    pub migrations_dir: Option<String>,
    /// persisted toggles so the panel checkboxes
    /// reflect the actual SQLite state instead of the zustand defaults.
    pub tracking_enabled: bool,
    pub snapshots_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffResult {
    pub unified_diff: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SqlPreview {
    pub sql: String,
}

#[derive(Debug, Clone, thiserror::Error, Serialize)]
#[serde(tag = "kind", content = "message", rename_all = "camelCase")]
pub enum MigrationsError {
    #[error("connection not found: {0}")]
    ConnectionNotFound(String),
    #[error("connection not active: {0}")]
    NotConnected(String),
    #[error("migrations directory not set for connection")]
    DirNotSet,
    #[error("io error: {0}")]
    Io(String),
    #[error("invalid filename: {0}")]
    InvalidFilename(String),
    #[error("duplicate version: {0}")]
    DuplicateVersion(String),
    #[error("migration not found: {0}")]
    NotFound(String),
    #[error("migration already applied: {0}")]
    AlreadyApplied(String),
    #[error("migration not applied: {0}")]
    NotApplied(String),
    #[error("rollback file missing for: {0}")]
    RollbackFileMissing(String),
    #[error("snapshot missing for version: {0}")]
    SnapshotMissing(String),
    #[error("snapshots disabled for connection — cannot diff")]
    SnapshotsDisabled,
    #[error("postgres error: {0}")]
    Postgres(String),
    #[error("storage error: {0}")]
    Storage(String),
    #[error("range non-contiguous: {from}..{to}")]
    RangeNonContiguous { from: String, to: String },
    #[error("watcher error: {0}")]
    Watcher(String),
    /// — discovery flagged this row (`duplicate version` /
    /// `orphan rollback file` / `file missing`); apply must refuse it
    /// instead of silently picking an arbitrary `up_path`.
    #[error("migration {version} has parse error: {error}")]
    HasParseError { version: String, error: String },
}

/// Watcher handle held in `AppState`. Dropping ends the notify task.
pub struct WatcherHandle {
    pub stop: tokio::sync::oneshot::Sender<()>,
}

pub type WatcherMap = Arc<RwLock<HashMap<String, WatcherHandle>>>;
