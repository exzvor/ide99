//! Backup / Restore DTOs + error type.
//!
//! Fields are grouped into three categories: source (what we back up),
//! shape (format), options (pg_dump/pg_restore flags). The frontend
//! wizard fills in all three.

#![allow(clippy::struct_excessive_bools)]

use serde::{Deserialize, Serialize};

/// pg_dump format flag: -Fc / -Fp / -Fd / -Ft.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DumpFormat {
    /// `-Fc` — recommended (selective restore, parallel jobs supported).
    Custom,
    /// `-Fp` — plain SQL (largest, but human-readable).
    Plain,
    /// `-Fd` — directory (parallel `--jobs` dump).
    Directory,
    /// `-Ft` — tar (legacy).
    Tar,
}

impl DumpFormat {
    #[must_use]
    pub const fn as_flag(self) -> &'static str {
        match self {
            Self::Custom => "-Fc",
            Self::Plain => "-Fp",
            Self::Directory => "-Fd",
            Self::Tar => "-Ft",
        }
    }
}

/// Include data, schema, or both. pg_dump flags: --data-only, --schema-only.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum DumpScope {
    #[default]
    Both,
    DataOnly,
    SchemaOnly,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BackupOptions {
    pub connection_id: String,
    pub format: DumpFormat,
    pub scope: DumpScope,
    /// Schema-list filter; empty = «all schemas».
    #[serde(default)]
    pub include_schemas: Vec<String>,
    /// Table-list filter (qualified `schema.name`); empty = «all tables».
    #[serde(default)]
    pub include_tables: Vec<String>,
    /// Tables whose DATA must be excluded (`--exclude-table-data`).
    #[serde(default)]
    pub exclude_table_data: Vec<String>,
    /// Compression level (0-9 for -Fc, ignored for -Fp).
    pub compress_level: u8,
    /// `--jobs N` for -Fd / pg_restore. None → 1 (sequential).
    pub parallel_jobs: Option<u8>,
    pub output_path: String,
    /// Include CREATE DATABASE statement (`--create`).
    #[serde(default)]
    pub include_create_db: bool,
    /// `--no-owner` — skip ownership commands on restore.
    #[serde(default)]
    pub no_owner: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreOptions {
    pub connection_id: String,
    pub source_path: String,
    /// `--clean` — drop objects before recreate (DESTRUCTIVE — UI must
    /// type-confirm).
    #[serde(default)]
    pub clean_before_restore: bool,
    /// `--create` — create the target database (peers against existing DB).
    #[serde(default)]
    pub create_database: bool,
    /// `--no-owner`.
    #[serde(default)]
    pub no_owner: bool,
    /// Optional jobs count for parallel restore (only -Fc / -Fd dumps).
    pub parallel_jobs: Option<u8>,
    /// Selective restore: `pg_restore -L list` file that we pre-generate
    /// from the list below. Empty = restore everything.
    #[serde(default)]
    pub selected_objects: Vec<String>,
}

/// pg_basebackup --incremental (PG 17+).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BaseBackupOptions {
    pub connection_id: String,
    pub output_dir: String,
    /// Path to the parent backup_manifest, required for --incremental.
    /// None = full backup.
    pub incremental_from_manifest: Option<String>,
    /// Compression: `none`, `gzip`, `lz4`, `zstd`. Ignored for plain mode.
    pub compression: BaseBackupCompression,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum BaseBackupCompression {
    #[default]
    None,
    Gzip,
    Lz4,
    Zstd,
}

/// Streaming progress event emitted via Tauri event bus during long-running
/// dump/restore subprocess. Frontend listens to `backup:progress` channel.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ProgressEvent {
    /// pg_dump --verbose stderr line — already-parsed phase + optional
    /// per-table message ("dumping contents of table public.users").
    Phase {
        job_id: String,
        phase: String,
        detail: Option<String>,
    },
    /// Best-effort percentage (0..=100). Computed from N completed objects /
    /// total objects when both numbers are known; otherwise omitted.
    Percent { job_id: String, value: f32 },
    /// Final terminator. `success=false` carries `stderr_tail` for UI.
    Done {
        job_id: String,
        success: bool,
        exit_code: Option<i32>,
        stderr_tail: String,
    },
}

/// Schedule entry — pure data, persisted in `<data_dir>/backups/schedules.json`.
/// Installing the actual cron / Scheduled Task is a separate step
/// (`schedule::install`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleEntry {
    pub id: String,
    pub label: String,
    /// Cron expression (5 fields, classic syntax). Validated on save.
    pub cron: String,
    /// Frozen options snapshot — backup runs offline without ide99.
    pub backup: BackupOptions,
    pub created_at: String,
    /// The entry is opaque metadata; the concrete cron / Scheduled Task
    /// install is reflected via `installed=true` once the OS scheduler
    /// accepted it.
    #[serde(default)]
    pub installed: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_run_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_run_ok: Option<bool>,
}

#[derive(Debug, thiserror::Error)]
pub enum BackupError {
    #[error("connection not found: {0}")]
    ConnectionNotFound(String),
    #[error("pg_dump unavailable: {0}")]
    BinaryUnavailable(String),
    #[error("invalid input: {0}")]
    InvalidInput(String),
    #[error("io error: {0}")]
    Io(String),
    #[error("subprocess failed: {0}")]
    Subprocess(String),
    #[error("schedule error: {0}")]
    Schedule(String),
}

impl serde::Serialize for BackupError {
    fn serialize<S: serde::Serializer>(&self, ser: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let (code, message) = match self {
            Self::ConnectionNotFound(id) => {
                ("connection_not_found", format!("connection {id} not found"))
            }
            Self::BinaryUnavailable(m) => ("binary_unavailable", m.clone()),
            Self::InvalidInput(m) => ("invalid_input", m.clone()),
            Self::Io(m) => ("io_error", m.clone()),
            Self::Subprocess(m) => ("subprocess_failed", m.clone()),
            Self::Schedule(m) => ("schedule_error", m.clone()),
        };
        let mut s = ser.serialize_struct("BackupError", 2)?;
        s.serialize_field("code", code)?;
        s.serialize_field("message", &message)?;
        s.end()
    }
}
