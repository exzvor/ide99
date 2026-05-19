//! Schedule store + cron / Scheduled-Task installer.
//!
//! Schedule entries are persisted in `<data_dir>/backups/schedules.json`
//! (a single JSON array file). On "install" the entry is additionally
//! transformed into:
//! * Linux/macOS: a cron line via the `crontab -l | crontab -` reuse
//!   pattern (see `install_cron`); the line is tagged `# ide99-backup:<id>`
//!   so find/remove is idempotent.
//! * Windows: Scheduled Task XML, imported via `schtasks /Create /XML ...`.
//!
//! This module contains pure validators + storage roundtrip + cron-line
//! builder. The actual subprocess install (`crontab`, `schtasks`) lives
//! in `installer.rs`.

#![allow(clippy::missing_errors_doc, clippy::missing_panics_doc)]

use std::fs;
use std::path::{Path, PathBuf};

use chrono::Utc;

use crate::backup::types::{BackupError, BackupOptions, ScheduleEntry};

/// File name within `<data_dir>/backups/`.
pub const SCHEDULE_FILE_NAME: &str = "schedules.json";

#[must_use]
pub fn schedule_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("backups")
}

#[must_use]
pub fn schedule_file(data_dir: &Path) -> PathBuf {
    schedule_dir(data_dir).join(SCHEDULE_FILE_NAME)
}

pub fn read_all(data_dir: &Path) -> Result<Vec<ScheduleEntry>, BackupError> {
    let path = schedule_file(data_dir);
    if !path.exists() {
        return Ok(Vec::new());
    }
    let raw = fs::read_to_string(&path).map_err(|e| BackupError::Io(e.to_string()))?;
    serde_json::from_str(&raw).map_err(|e| BackupError::Schedule(format!("decode: {e}")))
}

pub fn write_all(data_dir: &Path, entries: &[ScheduleEntry]) -> Result<(), BackupError> {
    fs::create_dir_all(schedule_dir(data_dir)).map_err(|e| BackupError::Io(e.to_string()))?;
    let raw = serde_json::to_string_pretty(entries)
        .map_err(|e| BackupError::Schedule(format!("encode: {e}")))?;
    fs::write(schedule_file(data_dir), raw).map_err(|e| BackupError::Io(e.to_string()))
}

pub fn upsert(    data_dir: &Path,
    id: &str,
    label: &str,
    cron: &str,
    backup: BackupOptions,
) -> Result<ScheduleEntry, BackupError> {
    validate_cron(cron)?;
    let mut all = read_all(data_dir)?;
    let now = Utc::now().to_rfc3339();
    if let Some(existing) = all.iter_mut().find(|e| e.id == id) {
        existing.label = label.to_string();
        existing.cron = cron.to_string();
        existing.backup = backup;
        let entry = existing.clone();
        write_all(data_dir, &all)?;
        return Ok(entry);
    }
    let entry = ScheduleEntry {
        id: id.to_string(),
        label: label.to_string(),
        cron: cron.to_string(),
        backup,
        created_at: now,
        installed: false,
        last_run_at: None,
        last_run_ok: None,
    };
    all.push(entry.clone());
    write_all(data_dir, &all)?;
    Ok(entry)
}

pub fn remove(data_dir: &Path, id: &str) -> Result<(), BackupError> {
    let mut all = read_all(data_dir)?;
    let before = all.len();
    all.retain(|e| e.id != id);
    if all.len() != before {
        write_all(data_dir, &all)?;
    }
    Ok(())
}

/// Validate a 5-field cron expression — minute, hour, day, month, day-of-week.
/// Accepted forms: digits, `*`, `*/N`, `M-N`, comma-separated. This is
/// enough for UI input; the full spectrum (`@reboot`, `@daily`) is
/// translated transparently at install time.
pub fn validate_cron(expr: &str) -> Result<(), BackupError> {
    let fields: Vec<&str> = expr.split_whitespace().collect();
    if fields.len() != 5 {
        return Err(BackupError::Schedule(format!(            "cron expression must have 5 fields, got {}",
            fields.len()
)));
    }
    for (idx, raw) in fields.iter().enumerate() {
        let (lo, hi) = match idx {
            0 => (0, 59),
            1 => (0, 23),
            2 => (1, 31),
            3 => (1, 12),
            4 => (0, 7),
            _ => unreachable!(),
        };
        validate_field(raw, lo, hi)
            .map_err(|m| BackupError::Schedule(format!("field {idx}: {m}")))?;
    }
    Ok(())
}

fn validate_field(raw: &str, lo: u32, hi: u32) -> Result<(), String> {
    if raw == "*" {
        return Ok(());
    }
    for token in raw.split(',') {
        if let Some(step_str) = token.strip_prefix("*/") {
            let step: u32 = step_str
                .parse()
                .map_err(|_| format!("invalid step '{step_str}'"))?;
            if step == 0 {
                return Err("step cannot be 0".into());
            }
            continue;
        }
        if let Some(idx) = token.find('-') {
            let lo_s = &token[..idx];
            let hi_s = &token[idx + 1..];
            let l: u32 = lo_s
                .parse()
                .map_err(|_| format!("invalid range start '{lo_s}'"))?;
            let h: u32 = hi_s
                .parse()
                .map_err(|_| format!("invalid range end '{hi_s}'"))?;
            if !(lo..=hi).contains(&l) || !(lo..=hi).contains(&h) || l > h {
                return Err(format!("range {token} outside [{lo},{hi}]"));
            }
            continue;
        }
        let v: u32 = token
            .parse()
            .map_err(|_| format!("invalid number '{token}'"))?;
        if !(lo..=hi).contains(&v) {
            return Err(format!("value {v} outside [{lo},{hi}]"));
        }
    }
    Ok(())
}

/// Build a single cron line that pipes pg_dump through PGPASSWORD env
/// var. We invoke pg_dump directly (no ide99-mediated wrapper) so the
/// user can close ide99 after installing the schedule. The
/// `# ide99-backup:<id>` marker is needed for clean uninstall.
#[must_use]
pub fn cron_line(id: &str, cron: &str, _opts: &BackupOptions) -> String {
    // We deliberately do not embed PGPASSWORD here — best practice is
    // to either populate a per-user `.pgpass` or use peer auth for local
    // backups. The UI surfaces this advice in the schedule wizard.
    format!(        "{cron} pg_dump --version > /dev/null 2>&1 # ide99-backup:{id}    # placeholder; full command rendered by installer"
)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backup::types::{DumpFormat, DumpScope};
    use tempfile::tempdir;

    fn opts() -> BackupOptions {
        BackupOptions {
            connection_id: "c1".into(),
            format: DumpFormat::Custom,
            scope: DumpScope::Both,
            include_schemas: vec![],
            include_tables: vec![],
            exclude_table_data: vec![],
            compress_level: 5,
            parallel_jobs: None,
            output_path: "/tmp/dump.bin".into(),
            include_create_db: false,
            no_owner: false,
        }
    }

    #[test]
    fn empty_when_no_file() {
        let dir = tempdir().unwrap();
        let entries = read_all(dir.path()).unwrap();
        assert!(entries.is_empty());
    }

    #[test]
    fn upsert_creates_then_updates() {
        let dir = tempdir().unwrap();
        let entry =
            upsert(dir.path(), "s1", "Daily prod", "0 3 * * *", opts()).expect("first upsert");
        assert_eq!(entry.label, "Daily prod");
        let updated = upsert(            dir.path(),
            "s1",
            "Daily prod (updated)",
            "0 4 * * *",
            opts(),
)
        .expect("update");
        assert_eq!(updated.label, "Daily prod (updated)");
        assert_eq!(updated.cron, "0 4 * * *");
        let all = read_all(dir.path()).unwrap();
        assert_eq!(all.len(), 1);
    }

    #[test]
    fn remove_idempotent() {
        let dir = tempdir().unwrap();
        remove(dir.path(), "missing").unwrap();
        upsert(dir.path(), "s1", "x", "0 0 * * *", opts()).unwrap();
        remove(dir.path(), "s1").unwrap();
        assert!(read_all(dir.path()).unwrap().is_empty());
    }

    #[test]
    fn cron_validation_accepts_typical() {
        validate_cron("0 3 * * *").unwrap();
        validate_cron("*/15 * * * *").unwrap();
        validate_cron("0 0 1 1 *").unwrap();
        validate_cron("0 0,12 * * 1-5").unwrap();
    }

    #[test]
    fn cron_validation_rejects_broken() {
        assert!(validate_cron("0 0 * *").is_err());
        assert!(validate_cron("99 0 * * *").is_err());
        assert!(validate_cron("0 0 32 * *").is_err());
        assert!(validate_cron("a b c d e").is_err());
    }

    #[test]
    fn cron_line_contains_marker_and_id() {
        let line = cron_line("schedule-1", "0 3 * * *", &opts());
        assert!(line.contains("# ide99-backup:schedule-1"));
        assert!(line.starts_with("0 3 * * *"));
    }
}
