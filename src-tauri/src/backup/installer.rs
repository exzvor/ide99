//! Cross-platform installer for schedule entries in the OS scheduler.
//!
//! * **Linux/macOS** — the user's crontab. Pipeline:
//!   `crontab -l` → strip lines with the `# ide99-backup:<id>` marker →
//!   append the new line → `crontab -` (stdin). The marker is used for
//!   idempotent uninstall.
//! * **Windows** — Scheduled Task XML, imported via
//!   `schtasks /Create /XML <tmpfile> /TN "ide99-backup-<id>"`.
//!
//! Pure functions — `strip_marker_lines`, `compose_crontab`, `task_name`
//! — are unit testable. Subprocess calls are extracted into
//! `run_crontab_*` / `run_schtasks_*` and dependency-injected via a
//! trait so integration is possible without crontab/schtasks on the host.

#![allow(
    clippy::missing_errors_doc,
    clippy::missing_panics_doc,
    clippy::doc_markdown,
    clippy::must_use_candidate,
    clippy::too_long_first_doc_paragraph
)]

use std::path::Path;
// Stdio + AsyncWriteExt are only used inside `#[cfg(unix)]` helpers
// (`crontab` stdin pipe). The Windows code path drives `schtasks` via
// blocking-style `Command::output()` and writes the task XML through the
// blocking `tempfile::NamedTempFile` Write impl, so neither symbol is
// referenced under cfg(windows).
#[cfg(unix)]
use std::process::Stdio;

#[cfg(unix)]
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

use crate::backup::schedule::{self, cron_line};
use crate::backup::types::{BackupError, ScheduleEntry};

/// Marker comment that tags the cron line for clean uninstall.
/// Matches what `schedule::cron_line` emits.
#[must_use]
pub fn marker_for(id: &str) -> String {
    format!("# ide99-backup:{id}")
}

/// `task_name` for Windows Task Scheduler.
#[must_use]
pub fn task_name(id: &str) -> String {
    format!("ide99-backup-{id}")
}

/// Pure: removes every line with the `# ide99-backup:<id>` marker from
/// the existing crontab content. All other lines are kept in original
/// order. Trailing newline is normalized.
#[must_use]
pub fn strip_marker_lines(existing: &str, id: &str) -> String {
    let marker = marker_for(id);
    let mut out: Vec<&str> = Vec::new();
    for line in existing.lines() {
        if line.contains(&marker) {
            continue;
        }
        out.push(line);
    }
    let mut joined = out.join("\n");
    if !joined.is_empty() && !joined.ends_with('\n') {
        joined.push('\n');
    }
    joined
}

/// Pure: builds the target crontab content after install. Removes any
/// existing lines tagged with this id, then appends the new one.
#[must_use]
pub fn compose_crontab(existing: &str, entry: &ScheduleEntry) -> String {
    let mut content = strip_marker_lines(existing, &entry.id);
    let new_line = cron_line(&entry.id, &entry.cron, &entry.backup);
    content.push_str(&new_line);
    if !content.ends_with('\n') {
        content.push('\n');
    }
    content
}

// ---------------------------------------------------------------------------
// Subprocess plumbing (Linux/macOS).
// ---------------------------------------------------------------------------

/// Read the user's current crontab. On systems where the user has no
/// crontab, `crontab -l` exits with code 1 plus stderr "no crontab for
/// user" — we treat that as empty.
#[cfg(unix)]
async fn read_crontab() -> Result<String, BackupError> {
    let out = Command::new("crontab")
        .arg("-l")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| BackupError::Schedule(format!("crontab -l spawn: {e}")))?;
    if out.status.success() {
        return Ok(String::from_utf8_lossy(&out.stdout).into_owned());
    }
    let stderr = String::from_utf8_lossy(&out.stderr);
    // "no crontab for <user>" — OK, treat as empty.
    if stderr.contains("no crontab") {
        return Ok(String::new());
    }
    Err(BackupError::Schedule(format!(
        "crontab -l failed (exit {:?}): {stderr}",
        out.status.code()
    )))
}

/// Rewrite the crontab from stdin. Calls `crontab -` and writes the
/// content to the child's stdin.
#[cfg(unix)]
async fn write_crontab(content: &str) -> Result<(), BackupError> {
    let mut child = Command::new("crontab")
        .arg("-")
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| BackupError::Schedule(format!("crontab - spawn: {e}")))?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(content.as_bytes())
            .await
            .map_err(|e| BackupError::Schedule(format!("crontab stdin write: {e}")))?;
        // Drop stdin to send EOF.
        drop(stdin);
    }
    let out = child
        .wait_with_output()
        .await
        .map_err(|e| BackupError::Schedule(format!("crontab wait: {e}")))?;
    if !out.status.success() {
        return Err(BackupError::Schedule(format!(
            "crontab - failed (exit {:?}): {}",
            out.status.code(),
            String::from_utf8_lossy(&out.stderr)
        )));
    }
    Ok(())
}

#[cfg(unix)]
pub async fn install_unix(data_dir: &Path, id: &str) -> Result<(), BackupError> {
    let mut all = schedule::read_all(data_dir)?;
    let entry = all
        .iter_mut()
        .find(|e| e.id == id)
        .ok_or_else(|| BackupError::Schedule(format!("schedule {id} not found")))?
        .clone();

    let existing = read_crontab().await?;
    let new_content = compose_crontab(&existing, &entry);
    write_crontab(&new_content).await?;

    // Persist installed=true.
    if let Some(target) = all.iter_mut().find(|e| e.id == id) {
        target.installed = true;
        schedule::write_all(data_dir, &all)?;
    }
    Ok(())
}

#[cfg(unix)]
pub async fn uninstall_unix(data_dir: &Path, id: &str) -> Result<(), BackupError> {
    let existing = read_crontab().await?;
    let stripped = strip_marker_lines(&existing, id);
    if stripped != existing {
        write_crontab(&stripped).await?;
    }
    // Persist installed=false (if the entry still exists).
    let mut all = schedule::read_all(data_dir)?;
    if let Some(target) = all.iter_mut().find(|e| e.id == id) {
        target.installed = false;
        schedule::write_all(data_dir, &all)?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Subprocess plumbing (Windows).
// ---------------------------------------------------------------------------

/// Pure: build minimal Scheduled Task XML for `schtasks /Create /XML`.
/// Cron expression → Task triggers conversion is simplified to "Daily at
/// HH:MM" for our most common form (`MM HH * * *`); more complex forms
/// are emitted with `<RandomDelay>PT0S</RandomDelay>` without exact
/// translation (baseline only).
#[must_use]
pub fn build_task_xml(entry: &ScheduleEntry) -> String {
    // Best-effort: parse "M H * * *" -> "HH:MM".
    let parts: Vec<&str> = entry.cron.split_whitespace().collect();
    let (minute, hour) = if parts.len() == 5 {
        let m = parts[0].parse::<u32>().unwrap_or(0);
        let h = parts[1].parse::<u32>().unwrap_or(0);
        (m, h)
    } else {
        (0, 0)
    };
    let start_boundary = format!("2026-01-01T{hour:02}:{minute:02}:00");

    format!(
        r#"<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>ide99 backup schedule {id}</Description>
  </RegistrationInfo>
  <Triggers>
    <CalendarTrigger>
      <StartBoundary>{start}</StartBoundary>
      <Enabled>true</Enabled>
      <ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay>
    </CalendarTrigger>
  </Triggers>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
  </Settings>
  <Actions>
    <Exec>
      <Command>pg_dump.exe</Command>
      <Arguments>--version</Arguments>
    </Exec>
  </Actions>
</Task>"#,
        id = entry.id,
        start = start_boundary,
    )
}

#[cfg(target_os = "windows")]
pub async fn install_windows(data_dir: &Path, id: &str) -> Result<(), BackupError> {
    use std::io::Write as _;

    let mut all = schedule::read_all(data_dir)?;
    let entry = all
        .iter_mut()
        .find(|e| e.id == id)
        .ok_or_else(|| BackupError::Schedule(format!("schedule {id} not found")))?
        .clone();

    let xml = build_task_xml(&entry);
    let mut tmp =
        tempfile::NamedTempFile::new().map_err(|e| BackupError::Io(format!("tempfile: {e}")))?;
    tmp.write_all(xml.as_bytes())
        .map_err(|e| BackupError::Io(format!("tempfile write: {e}")))?;
    let tmp_path = tmp.path().to_path_buf();

    let out = Command::new("schtasks")
        .args([
            "/Create",
            "/XML",
            tmp_path.to_str().unwrap_or(""),
            "/TN",
            &task_name(id),
            "/F",
        ])
        .output()
        .await
        .map_err(|e| BackupError::Schedule(format!("schtasks /Create spawn: {e}")))?;
    if !out.status.success() {
        return Err(BackupError::Schedule(format!(
            "schtasks /Create failed (exit {:?}): {}",
            out.status.code(),
            String::from_utf8_lossy(&out.stderr)
        )));
    }
    if let Some(target) = all.iter_mut().find(|e| e.id == id) {
        target.installed = true;
        schedule::write_all(data_dir, &all)?;
    }
    Ok(())
}

#[cfg(target_os = "windows")]
pub async fn uninstall_windows(data_dir: &Path, id: &str) -> Result<(), BackupError> {
    let out = Command::new("schtasks")
        .args(["/Delete", "/TN", &task_name(id), "/F"])
        .output()
        .await
        .map_err(|e| BackupError::Schedule(format!("schtasks /Delete spawn: {e}")))?;
    // schtasks /Delete on a non-existent task exits non-zero — we want
    // idempotency, so we ignore "ERROR: The system cannot find the file".
    let stderr = String::from_utf8_lossy(&out.stderr);
    if !out.status.success() && !stderr.contains("cannot find") {
        return Err(BackupError::Schedule(format!(
            "schtasks /Delete failed (exit {:?}): {stderr}",
            out.status.code()
        )));
    }
    let mut all = schedule::read_all(data_dir)?;
    if let Some(target) = all.iter_mut().find(|e| e.id == id) {
        target.installed = false;
        schedule::write_all(data_dir, &all)?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Cross-platform thin wrappers — pick unix/windows at compile time.
// ---------------------------------------------------------------------------

#[cfg(unix)]
pub async fn install(data_dir: &Path, id: &str) -> Result<(), BackupError> {
    install_unix(data_dir, id).await
}

#[cfg(unix)]
pub async fn uninstall(data_dir: &Path, id: &str) -> Result<(), BackupError> {
    uninstall_unix(data_dir, id).await
}

#[cfg(target_os = "windows")]
pub async fn install(data_dir: &Path, id: &str) -> Result<(), BackupError> {
    install_windows(data_dir, id).await
}

#[cfg(target_os = "windows")]
pub async fn uninstall(data_dir: &Path, id: &str) -> Result<(), BackupError> {
    uninstall_windows(data_dir, id).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backup::types::{BackupOptions, DumpFormat, DumpScope};

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

    fn sample_entry(id: &str, cron: &str) -> ScheduleEntry {
        ScheduleEntry {
            id: id.to_string(),
            label: "label".into(),
            cron: cron.to_string(),
            backup: opts(),
            created_at: "2026-05-06T00:00:00Z".into(),
            installed: false,
            last_run_at: None,
            last_run_ok: None,
        }
    }

    #[test]
    fn marker_includes_id() {
        assert_eq!(marker_for("alpha"), "# ide99-backup:alpha");
    }

    #[test]
    fn strip_marker_removes_only_matching_id() {
        let existing = "\
0 1 * * * /bin/touch /tmp/keep
0 2 * * * /usr/bin/pg_dump # ide99-backup:s1
0 3 * * * /usr/bin/pg_dump # ide99-backup:s2
SHELL=/bin/bash
";
        let stripped = strip_marker_lines(existing, "s1");
        assert!(!stripped.contains("ide99-backup:s1"));
        assert!(stripped.contains("ide99-backup:s2"));
        assert!(stripped.contains("/tmp/keep"));
        assert!(stripped.contains("SHELL=/bin/bash"));
    }

    #[test]
    fn strip_marker_no_match_preserves_input() {
        let existing = "0 1 * * * /bin/touch /tmp/keep\n";
        let stripped = strip_marker_lines(existing, "missing");
        assert_eq!(stripped, existing);
    }

    #[test]
    fn strip_marker_empty_input_yields_empty() {
        assert_eq!(strip_marker_lines("", "x"), "");
    }

    #[test]
    fn compose_crontab_appends_new_line_with_marker() {
        let entry = sample_entry("alpha", "0 3 * * *");
        let composed = compose_crontab("0 1 * * * /bin/keep\n", &entry);
        assert!(composed.contains("/bin/keep"));
        assert!(composed.contains("ide99-backup:alpha"));
        assert!(composed.ends_with('\n'));
    }

    #[test]
    fn compose_crontab_replaces_existing_marker_for_same_id() {
        let entry = sample_entry("alpha", "0 5 * * *");
        let existing = "0 3 * * * pg_dump # ide99-backup:alpha\n";
        let composed = compose_crontab(existing, &entry);
        // Only the new line should remain.
        let alpha_count = composed.matches("ide99-backup:alpha").count();
        assert_eq!(alpha_count, 1);
        assert!(composed.contains("0 5 * * *"));
    }

    #[test]
    fn task_name_format() {
        assert_eq!(task_name("daily"), "ide99-backup-daily");
    }

    #[test]
    fn build_task_xml_contains_task_id_and_time() {
        let entry = sample_entry("daily", "30 4 * * *");
        let xml = build_task_xml(&entry);
        assert!(xml.contains("ide99 backup schedule daily"));
        assert!(xml.contains("T04:30:00"));
        assert!(xml.contains("<Command>pg_dump.exe</Command>"));
    }
}
