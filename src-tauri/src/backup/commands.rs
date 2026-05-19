//! Tauri command surface for backup/restore wizards + schedule manager.
//!
//! IPC contract: shape DTO + command signatures. Subprocess plumbing
//! (tokio::process + stderr stream + Tauri-event emission) lives in
//! `runner.rs`.
//!
//! Pure builders (`dump::build_args`, `restore::build_args`,
//! `basebackup::build_args`) work and are unit-tested — the frontend
//! wizard can render the command preview via `backup_preview_command`
//! independently of the spawn side.

#![allow(clippy::missing_errors_doc, clippy::missing_panics_doc)]

use tauri::State;

use crate::backup::types::{
    BackupError, BackupOptions, BaseBackupOptions, ProgressEvent, RestoreOptions, ScheduleEntry,
};
use crate::backup::{basebackup, dump, installer, restore, runner, schedule, types};
use crate::AppState;

// ---------------------------------------------------------------------------
// Preview commands — pure, no subprocess.
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn backup_preview_command(
    state: State<'_, AppState>,
    opts: BackupOptions,
) -> Result<Vec<String>, BackupError> {
    state.backup_preview_command(opts).await
}

#[tauri::command]
pub async fn restore_preview_command(
    state: State<'_, AppState>,
    opts: RestoreOptions,
) -> Result<Vec<String>, BackupError> {
    state.restore_preview_command(opts).await
}

#[tauri::command]
pub async fn basebackup_preview_command(
    state: State<'_, AppState>,
    opts: BaseBackupOptions,
) -> Result<Vec<String>, BackupError> {
    state.basebackup_preview_command(opts).await
}

// ---------------------------------------------------------------------------
// Run commands — fills bodies. For now, return BinaryUnavailable so
// frontend wizard can wire up the call site without crashing.
// ---------------------------------------------------------------------------

#[tauri::command]
#[allow(unused_variables)]
pub async fn backup_run(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    job_id: String,
    opts: BackupOptions,
) -> Result<(), BackupError> {
    state.backup_run(app, &job_id, opts).await
}

#[tauri::command]
#[allow(unused_variables)]
pub async fn restore_run(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    job_id: String,
    opts: RestoreOptions,
) -> Result<(), BackupError> {
    state.restore_run(app, &job_id, opts).await
}

#[tauri::command]
#[allow(unused_variables)]
pub async fn basebackup_run(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    job_id: String,
    opts: BaseBackupOptions,
) -> Result<(), BackupError> {
    state.basebackup_run(app, &job_id, opts).await
}

#[tauri::command]
#[allow(unused_variables)]
pub async fn backup_cancel(state: State<'_, AppState>, job_id: String) -> Result<(), BackupError> {
    state.backup_cancel(&job_id).await
}

// ---------------------------------------------------------------------------
// Schedule commands — pure storage roundtrip + cron-line preview.
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn schedule_list(state: State<'_, AppState>) -> Result<Vec<ScheduleEntry>, BackupError> {
    state.schedule_list().await
}

#[tauri::command]
pub async fn schedule_upsert(
    state: State<'_, AppState>,
    id: String,
    label: String,
    cron: String,
    backup: BackupOptions,
) -> Result<ScheduleEntry, BackupError> {
    state.schedule_upsert(&id, &label, &cron, backup).await
}

#[tauri::command]
pub async fn schedule_remove(state: State<'_, AppState>, id: String) -> Result<(), BackupError> {
    state.schedule_remove(&id).await
}

#[tauri::command]
pub async fn schedule_preview_cron_line(
    id: String,
    cron: String,
    backup: BackupOptions,
) -> Result<String, BackupError> {
    schedule::validate_cron(&cron)?;
    Ok(schedule::cron_line(&id, &cron, &backup))
}

#[tauri::command]
pub async fn schedule_install(
    state: State<'_, AppState>,
    _app: tauri::AppHandle,
    id: String,
) -> Result<(), BackupError> {
    state.schedule_install(&id).await
}

#[tauri::command]
pub async fn schedule_uninstall(
    state: State<'_, AppState>,
    _app: tauri::AppHandle,
    id: String,
) -> Result<(), BackupError> {
    state.schedule_uninstall(&id).await
}

#[tauri::command]
pub async fn schedule_run_now(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    id: String,
) -> Result<(), BackupError> {
    state.schedule_run_now(app, &id).await
}

// ---------------------------------------------------------------------------
// AppState helpers — kept in commands.rs because the underlying
// state-touching pieces are tiny. Spawn-side helpers live in a separate
// `runner.rs` to keep this file focused on IPC shape.
// ---------------------------------------------------------------------------

impl AppState {
    pub async fn lookup_connection(
        &self,
        connection_id: &str,
    ) -> Result<crate::connection::types::Connection, BackupError> {
        let store = self.store.lock().await;
        store.get_by_id(connection_id).map_err(|e| {
            if matches!(e, crate::connection::types::ConnectionError::NotFound(_)) {
                BackupError::ConnectionNotFound(connection_id.to_string())
            } else {
                BackupError::Io(e.to_string())
            }
        })
    }

    pub async fn backup_preview_command(
        &self,
        opts: BackupOptions,
    ) -> Result<Vec<String>, BackupError> {
        dump::validate(&opts).map_err(BackupError::InvalidInput)?;
        let conn = self.lookup_connection(&opts.connection_id).await?;
        Ok(dump::build_args(&conn, &opts))
    }

    pub async fn restore_preview_command(
        &self,
        opts: RestoreOptions,
    ) -> Result<Vec<String>, BackupError> {
        restore::validate(&opts).map_err(BackupError::InvalidInput)?;
        let conn = self.lookup_connection(&opts.connection_id).await?;
        Ok(restore::build_args(&conn, &opts))
    }

    pub async fn basebackup_preview_command(
        &self,
        opts: BaseBackupOptions,
    ) -> Result<Vec<String>, BackupError> {
        basebackup::validate(&opts).map_err(BackupError::InvalidInput)?;
        let conn = self.lookup_connection(&opts.connection_id).await?;
        Ok(basebackup::build_args(&conn, &opts))
    }

    /// Real pg_dump spawn via `runner::run_backup`.
    /// Pre-validates options and connection lookup before spawning.
    pub async fn backup_run(
        &self,
        app: tauri::AppHandle,
        job_id: &str,
        opts: BackupOptions,
    ) -> Result<(), BackupError> {
        runner::run_backup(&app, self, job_id, opts).await
    }

    pub async fn restore_run(
        &self,
        app: tauri::AppHandle,
        job_id: &str,
        opts: RestoreOptions,
    ) -> Result<(), BackupError> {
        runner::run_restore(&app, self, job_id, opts).await
    }

    pub async fn basebackup_run(
        &self,
        app: tauri::AppHandle,
        job_id: &str,
        opts: BaseBackupOptions,
    ) -> Result<(), BackupError> {
        runner::run_basebackup(&app, self, job_id, opts).await
    }

    pub async fn backup_cancel(&self, job_id: &str) -> Result<(), BackupError> {
        runner::cancel(self, job_id).await
    }

    pub async fn schedule_list(&self) -> Result<Vec<ScheduleEntry>, BackupError> {
        schedule::read_all(&self.data_dir)
    }

    pub async fn schedule_upsert(
        &self,
        id: &str,
        label: &str,
        cron: &str,
        backup: BackupOptions,
    ) -> Result<ScheduleEntry, BackupError> {
        schedule::upsert(&self.data_dir, id, label, cron, backup)
    }

    pub async fn schedule_remove(&self, id: &str) -> Result<(), BackupError> {
        schedule::remove(&self.data_dir, id)
    }

    /// Install the schedule into the system scheduler.
    /// Linux/macOS — crontab, Windows — schtasks.
    pub async fn schedule_install(&self, id: &str) -> Result<(), BackupError> {
        installer::install(&self.data_dir, id).await
    }

    /// Remove the schedule from the system scheduler.
    pub async fn schedule_uninstall(&self, id: &str) -> Result<(), BackupError> {
        installer::uninstall(&self.data_dir, id).await
    }

    /// Run the scheduled backup immediately (for UI verification — the
    /// user does not have to wait for a real cron tick). Uses a
    /// synthetic `job_id = schedule-<id>-<timestamp_ms>`.
    pub async fn schedule_run_now(
        &self,
        app: tauri::AppHandle,
        id: &str,
    ) -> Result<(), BackupError> {
        let entries = schedule::read_all(&self.data_dir)?;
        let entry = entries
            .into_iter()
            .find(|e| e.id == id)
            .ok_or_else(|| BackupError::Schedule(format!("schedule {id} not found")))?;
        let job_id = format!(
            "schedule-{}-{}",
            entry.id,
            chrono::Utc::now().timestamp_millis()
        );
        runner::run_backup(&app, self, &job_id, entry.backup).await
    }
}

// `ProgressEvent` lives in `types::` and is the bus payload for `backup:progress`.
// Frontend uses the same struct shape via Tauri's auto-generated bindings.
#[allow(dead_code)]
fn _types_keepalive(_e: ProgressEvent, _f: types::DumpFormat) {}
