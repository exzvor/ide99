//! Backup/Restore subprocess runner.
//!
//! Thin wrapper around `tokio::process::Command` for three utilities:
//! `pg_dump`, `pg_restore`, `pg_basebackup`. Streams stderr line by line,
//! parses it via [`progress::parse_line`], and emits [`ProgressEvent`]
//! on the Tauri event bus (`backup:progress`). Cancellation is supported
//! via the `oneshot` channel in [`AppState::backup_jobs`].
//!
//! ## Security
//!
//! * Password is passed only through the child process `PGPASSWORD` env
//!   var (never argv, never logs).
//! * We use `Command::new(binary).args(...)` — no `sh -c`, no shell
//!   interpretation of argv. Metacharacter injection is impossible.
//! * Stderr tail is capped at 4 KB — even if pg_dump dumps a megabyte of
//!   errors, only the last lines end up in `Done.stderr_tail`.

#![allow(
    clippy::missing_errors_doc,
    clippy::missing_panics_doc,
    clippy::doc_markdown,
    clippy::must_use_candidate,
    clippy::too_long_first_doc_paragraph,
    clippy::significant_drop_tightening
)]

use std::collections::VecDeque;
use std::process::Stdio;

use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufRead, AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::oneshot;

use crate::backup::progress::{parse_line, ProgressCounter};
use crate::backup::types::{
    BackupError, BackupOptions, BaseBackupOptions, ProgressEvent, RestoreOptions,
};
use crate::backup::{basebackup, dump, restore};
use crate::connection::types::Connection;
use crate::AppState;

/// Ring-buffer size for the stderr tail in the final `Done` event.
const STDERR_TAIL_LIMIT: usize = 4096;

/// Tauri channel that receives [`ProgressEvent`].
pub const PROGRESS_CHANNEL: &str = "backup:progress";

/// Emit sink: the real `AppHandle` in prod, a stub in unit tests.
pub trait EventSink: Send + Sync {
    fn emit(&self, event: &ProgressEvent);
}

/// Production sink: pushes ProgressEvent onto the Tauri event bus.
pub struct AppHandleSink<'a> {
    pub app: &'a AppHandle,
}

impl EventSink for AppHandleSink<'_> {
    fn emit(&self, event: &ProgressEvent) {
        let _ = self.app.emit(PROGRESS_CHANNEL, event);
    }
}

/// Which utility we run. Drives binary lookup and the missing-binary
/// error message.
#[derive(Debug, Clone, Copy)]
pub enum Tool {
    PgDump,
    PgRestore,
    PgBasebackup,
}

impl Tool {
    pub const fn binary(self) -> &'static str {
        match self {
            Self::PgDump => "pg_dump",
            Self::PgRestore => "pg_restore",
            Self::PgBasebackup => "pg_basebackup",
        }
    }
}

/// Look up the utility path via `which`. Returns
/// [`BackupError::BinaryUnavailable`] if not found.
pub fn locate_binary(tool: Tool) -> Result<std::path::PathBuf, BackupError> {
    which::which(tool.binary()).map_err(|e| {
        BackupError::BinaryUnavailable(format!(
            "{}: {} (install Postgres client tools and add to PATH)",
            tool.binary(),
            e
        ))
    })
}

/// Purely functional stream processor: reads stderr line by line, emits
/// phase / percent events through the sink, and accumulates a tail buffer.
///
/// Returns the final tail string. Never panics — any parse failure is
/// ignored (parse_line returns a Some(log) fallback).
pub async fn process_stderr_stream<R, S>(
    reader: R,
    job_id: &str,
    sink: &S,
) -> std::io::Result<String>
where
    R: AsyncBufRead + Unpin,
    S: EventSink + ?Sized,
{
    let mut lines = reader.lines();
    let mut counter = ProgressCounter::default();
    let mut tail = TailBuffer::with_capacity(STDERR_TAIL_LIMIT);

    while let Some(line) = lines.next_line().await? {
        tail.push_line(&line);
        if let Some(parsed) = parse_line(&line) {
            sink.emit(&ProgressEvent::Phase {
                job_id: job_id.to_string(),
                phase: parsed.phase.clone(),
                detail: parsed.detail.clone(),
            });
            if let Some(pct) = counter.observe(&parsed) {
                sink.emit(&ProgressEvent::Percent {
                    job_id: job_id.to_string(),
                    value: pct,
                });
            }
        }
    }
    Ok(tail.into_string())
}

/// Ring buffer for the last N bytes of stderr. Holds a valid UTF-8
/// string (we only push complete lines + '\n').
struct TailBuffer {
    cap: usize,
    buf: VecDeque<u8>,
}

impl TailBuffer {
    fn with_capacity(cap: usize) -> Self {
        Self {
            cap,
            buf: VecDeque::with_capacity(cap),
        }
    }
    fn push_line(&mut self, line: &str) {
        for &b in line.as_bytes() {
            if self.buf.len() == self.cap {
                self.buf.pop_front();
            }
            self.buf.push_back(b);
        }
        if self.buf.len() == self.cap {
            self.buf.pop_front();
        }
        self.buf.push_back(b'\n');
        // Trim from the front to a UTF-8 char boundary so `into_string`
        // never produces invalid UTF-8 (the pop_front calls above may
        // have sliced a multi-byte char).
        while !self.buf.is_empty() && self.buf.front().is_some_and(|b| (*b & 0xC0) == 0x80) {
            self.buf.pop_front();
        }
    }
    fn into_string(self) -> String {
        let bytes: Vec<u8> = self.buf.into_iter().collect();
        String::from_utf8_lossy(&bytes).into_owned()
    }
}

// ---------------------------------------------------------------------------
// Spawn-side: build Command, set PGPASSWORD only if keychain has one,
// stream stderr, emit Done.
// ---------------------------------------------------------------------------

/// Spawn pg_dump / pg_restore / pg_basebackup. Returns
/// `Result<(), BackupError>` where `Ok(())` means success. All
/// ProgressEvents (including the final Done) are emitted inside.
async fn run_command<S: EventSink + ?Sized>(
    tool: Tool,
    args: Vec<String>,
    password: Option<String>,
    job_id: &str,
    sink: &S,
    state: &AppState,
) -> Result<(), BackupError> {
    let bin = locate_binary(tool)?;

    let mut cmd = Command::new(&bin);
    cmd.args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    if let Some(pw) = password {
        cmd.env("PGPASSWORD", pw);
    }

    let mut child: Child = cmd
        .spawn()
        .map_err(|e| BackupError::Subprocess(format!("spawn {}: {}", tool.binary(), e)))?;

    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| BackupError::Subprocess("stderr handle missing".into()))?;
    let reader = BufReader::new(stderr);

    // Register the cancel channel.
    let (cancel_tx, mut cancel_rx) = oneshot::channel::<()>();
    {
        let mut jobs = state.backup_jobs.write().await;
        if let Some(prev) = jobs.insert(job_id.to_string(), cancel_tx) {
            // Stale registration — release it so Drop does not panic.
            let _ = prev.send(());
        }
    }

    // Race: stream-loop vs cancel-signal vs child-exit.
    let stream_fut = process_stderr_stream(reader, job_id, sink);

    let (stderr_tail, exit_code, killed) = tokio::select! {
        biased;
        _ = &mut cancel_rx => {
            let _ = child.kill().await;
            // Even after kill, wait for the process so we drain pipes & avoid zombies.
            let _ = child.wait().await;
            (String::new(), None, true)
        }
        tail_result = stream_fut => {
            let tail = tail_result.unwrap_or_default();
            let status = child.wait().await
                .map_err(|e| BackupError::Subprocess(format!("wait: {e}")))?;
            (tail, status.code(), false)
        }
    };

    // Unregister the cancel channel regardless of outcome.
    {
        let mut jobs = state.backup_jobs.write().await;
        jobs.remove(job_id);
    }

    let success = !killed && exit_code == Some(0);
    sink.emit(&ProgressEvent::Done {
        job_id: job_id.to_string(),
        success,
        exit_code,
        stderr_tail: stderr_tail.clone(),
    });

    if killed {
        return Err(BackupError::Subprocess("cancelled".into()));
    }
    if !success {
        return Err(BackupError::Subprocess(format!(
            "{} exited with {:?}: {}",
            tool.binary(),
            exit_code,
            stderr_tail.lines().last().unwrap_or("(no stderr)")
        )));
    }
    Ok(())
}

/// Read PGPASSWORD if the keychain has a stored secret for this
/// connection. The contents are never logged.
fn read_password(state: &AppState, conn: &Connection) -> Option<String> {
    if !conn.has_password {
        return None;
    }
    state.keychain.get(&conn.id).ok().flatten()
}

/// No-op sink: used when AppHandle is unavailable (integration tests
/// or background tasks without UI).
pub struct NoopSink;

impl EventSink for NoopSink {
    fn emit(&self, _event: &ProgressEvent) {}
}

/// Run pg_dump with an explicit sink. Public so integration tests can
/// call it directly (a Tauri AppHandle cannot be constructed without
/// the `test` feature).
pub async fn run_backup_with_sink<S: EventSink + ?Sized>(
    sink: &S,
    state: &AppState,
    job_id: &str,
    opts: BackupOptions,
) -> Result<(), BackupError> {
    dump::validate(&opts).map_err(BackupError::InvalidInput)?;
    let conn = state.lookup_connection(&opts.connection_id).await?;
    let args = dump::build_args(&conn, &opts);
    let password = read_password(state, &conn);
    run_command(Tool::PgDump, args, password, job_id, sink, state).await
}

/// Run pg_restore with an explicit sink.
pub async fn run_restore_with_sink<S: EventSink + ?Sized>(
    sink: &S,
    state: &AppState,
    job_id: &str,
    opts: RestoreOptions,
) -> Result<(), BackupError> {
    restore::validate(&opts).map_err(BackupError::InvalidInput)?;
    let conn = state.lookup_connection(&opts.connection_id).await?;
    let args = restore::build_args(&conn, &opts);
    let password = read_password(state, &conn);
    run_command(Tool::PgRestore, args, password, job_id, sink, state).await
}

/// Run pg_basebackup with an explicit sink.
pub async fn run_basebackup_with_sink<S: EventSink + ?Sized>(
    sink: &S,
    state: &AppState,
    job_id: &str,
    opts: BaseBackupOptions,
) -> Result<(), BackupError> {
    basebackup::validate(&opts).map_err(BackupError::InvalidInput)?;
    let conn = state.lookup_connection(&opts.connection_id).await?;
    let args = basebackup::build_args(&conn, &opts);
    let password = read_password(state, &conn);
    run_command(Tool::PgBasebackup, args, password, job_id, sink, state).await
}

/// Run pg_dump (production wrapper — emits to the Tauri event bus).
pub async fn run_backup(
    app: &AppHandle,
    state: &AppState,
    job_id: &str,
    opts: BackupOptions,
) -> Result<(), BackupError> {
    let sink = AppHandleSink { app };
    run_backup_with_sink(&sink, state, job_id, opts).await
}

/// Run pg_restore (production wrapper).
pub async fn run_restore(
    app: &AppHandle,
    state: &AppState,
    job_id: &str,
    opts: RestoreOptions,
) -> Result<(), BackupError> {
    let sink = AppHandleSink { app };
    run_restore_with_sink(&sink, state, job_id, opts).await
}

/// Run pg_basebackup (production wrapper).
pub async fn run_basebackup(
    app: &AppHandle,
    state: &AppState,
    job_id: &str,
    opts: BaseBackupOptions,
) -> Result<(), BackupError> {
    let sink = AppHandleSink { app };
    run_basebackup_with_sink(&sink, state, job_id, opts).await
}

/// Cancel handler: pulls the oneshot from state and sends a unit. If
/// the job already finished — silent no-op (idempotent).
pub async fn cancel(state: &AppState, job_id: &str) -> Result<(), BackupError> {
    let mut jobs = state.backup_jobs.write().await;
    if let Some(tx) = jobs.remove(job_id) {
        let _ = tx.send(());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    /// Test sink: records all emitted events into a Vec.
    #[derive(Default)]
    struct VecSink {
        events: Mutex<Vec<ProgressEvent>>,
    }

    impl VecSink {
        fn snapshot(&self) -> Vec<ProgressEvent> {
            self.events.lock().unwrap().clone()
        }
    }

    impl EventSink for VecSink {
        fn emit(&self, event: &ProgressEvent) {
            self.events.lock().unwrap().push(event.clone());
        }
    }

    #[tokio::test]
    async fn stream_emits_phase_events_for_pg_dump_lines() {
        let stderr = b"\
pg_dump: last built-in OID is 16383
pg_dump: reading extensions
pg_dump: dumping contents of table public.users
pg_dump: finished item 1 of 5
";
        let reader = BufReader::new(&stderr[..]);
        let sink = VecSink::default();
        let tail = process_stderr_stream(reader, "job-x", &sink).await.unwrap();
        let events = sink.snapshot();

        // Expect at least one Phase event per non-empty line.
        let phase_count = events
            .iter()
            .filter(|e| matches!(e, ProgressEvent::Phase { .. }))
            .count();
        assert!(phase_count >= 4, "events: {events:?}");

        // Tail should contain the last line.
        assert!(tail.contains("finished item"));
    }

    #[tokio::test]
    async fn stream_emits_no_percent_without_total() {
        // ProgressCounter requires a known total; without it no Percent event.
        let stderr = b"pg_dump: finished item 1 of N\n";
        let reader = BufReader::new(&stderr[..]);
        let sink = VecSink::default();
        let _ = process_stderr_stream(reader, "j", &sink).await.unwrap();
        let pct = sink
            .snapshot()
            .iter()
            .filter(|e| matches!(e, ProgressEvent::Percent { .. }))
            .count();
        assert_eq!(pct, 0);
    }

    #[tokio::test]
    async fn tail_buffer_caps_size() {
        let mut tb = TailBuffer::with_capacity(64);
        for i in 0..200 {
            tb.push_line(&format!("line-{i:04}"));
        }
        let s = tb.into_string();
        assert!(s.len() <= 64, "tail length = {}", s.len());
        // The last line must be in the tail.
        assert!(s.contains("line-0199"));
    }

    #[tokio::test]
    async fn stream_handles_empty_input() {
        let stderr: &[u8] = b"";
        let reader = BufReader::new(stderr);
        let sink = VecSink::default();
        let tail = process_stderr_stream(reader, "j", &sink).await.unwrap();
        assert!(tail.is_empty());
        assert!(sink.snapshot().is_empty());
    }

    #[tokio::test]
    async fn stream_ignores_unparseable_blank_lines() {
        let stderr = b"\n\n   \npg_dump: dumping contents of table x\n";
        let reader = BufReader::new(&stderr[..]);
        let sink = VecSink::default();
        process_stderr_stream(reader, "j", &sink).await.unwrap();
        let events = sink.snapshot();
        // Only the non-blank line should emit a Phase event.
        let phase_count = events
            .iter()
            .filter(|e| matches!(e, ProgressEvent::Phase { .. }))
            .count();
        assert_eq!(phase_count, 1);
    }

    #[test]
    fn locate_binary_unknown_tool_returns_binary_unavailable() {
        // pg_does_not_exist — guaranteed not on PATH.
        let err = which::which("pg_does_not_exist").err();
        assert!(err.is_some());
        // Locate uses the same lookup; if pg_dump itself is missing on the
        // test host, this assertion still verifies error-path mapping.
        if which::which("pg_dump").is_err() {
            let res = locate_binary(Tool::PgDump);
            assert!(matches!(res, Err(BackupError::BinaryUnavailable(_))));
        }
    }
}
