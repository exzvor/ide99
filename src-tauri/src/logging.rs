//! Tracing initialization + the `log_error` Tauri command that frontend code
//! invokes when it catches an error.
//!
//! Two sinks are wired up:
//! - **stdout** — human-readable in debug, one JSON object per line in release.
//! - **`<data_dir>/logs/ide99.log`** — a daily-rolling JSON file (issue #14).
//!   In a closed/air-gapped network the file log is the ONLY diagnostic channel
//!   (telemetry POSTs go nowhere), so a crash must leave evidence on disk.
//!
//! A panic hook (also #14) catches native Rust panics. Release builds run with
//! `panic = "abort"`, so the hook is the single chance to persist a crash
//! before the process dies — it writes a synchronous line to a dedicated
//! `ide99-panic.log` (the non-blocking file layer can lose its last buffered
//! lines on abort) and then chains to the previous hook.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use tracing_appender::non_blocking::WorkerGuard;
use tracing_subscriber::prelude::*;
use tracing_subscriber::EnvFilter;

/// Holds the non-blocking writer's worker guard for the whole process
/// lifetime. If this is dropped, the background flushing thread stops and file
/// logs silently go missing — so it lives in a static and is never dropped.
static LOG_GUARD: OnceLock<WorkerGuard> = OnceLock::new();

/// The resolved `<data_dir>/logs` directory, captured for the panic hook's
/// synchronous crash-file write.
static LOG_DIR: OnceLock<PathBuf> = OnceLock::new();

/// Initialize the global tracing subscriber.
///
/// `IDE99_LOG` sets the `tracing` directives string (falls back to `info`).
/// Always logs to stdout; additionally logs to a daily-rolling JSON file under
/// `<data_dir>/logs/` when that directory can be created.
pub fn init_tracing(data_dir: &Path) {
    let filter = EnvFilter::try_from_env("IDE99_LOG").unwrap_or_else(|_| EnvFilter::new("info"));

    // File layer — best-effort. A failure here (read-only FS, permissions)
    // must NOT prevent the app from starting; we just lose the file sink.
    let logs_dir = data_dir.join("logs");
    let file_layer = match std::fs::create_dir_all(&logs_dir) {
        Ok(()) => {
            let _ = LOG_DIR.set(logs_dir.clone());
            let appender = tracing_appender::rolling::daily(&logs_dir, "ide99.log");
            let (writer, guard) = tracing_appender::non_blocking(appender);
            // Keep the guard alive for the process lifetime.
            let _ = LOG_GUARD.set(guard);
            Some(
                tracing_subscriber::fmt::layer()
                    .with_ansi(false)
                    .with_target(false)
                    .json()
                    .with_writer(writer)
                    .boxed(),
            )
        }
        Err(e) => {
            eprintln!("ide99: could not create log directory {logs_dir:?}: {e}");
            None
        }
    };

    // stdout layer — pretty in debug, JSON in release (unchanged behavior).
    let stdout_layer = if cfg!(debug_assertions) {
        tracing_subscriber::fmt::layer().with_target(false).boxed()
    } else {
        tracing_subscriber::fmt::layer()
            .with_target(false)
            .json()
            .boxed()
    };

    tracing_subscriber::registry()
        .with(filter)
        .with(stdout_layer)
        .with(file_layer)
        .init();
}

/// Install a panic hook that records native Rust panics to the log before the
/// process aborts. Chains to the previously-installed hook so platform default
/// behavior (and Tao/Tauri's hook, if any) is preserved.
pub fn install_panic_hook() {
    let prev = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let location = info
            .location()
            .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
            .unwrap_or_else(|| "<unknown>".to_string());
        let payload = panic_payload(info.payload());
        let backtrace = std::backtrace::Backtrace::force_capture();
        let msg = redact_secrets(&payload);
        let bt = redact_secrets(&format!("{backtrace}"));

        // Structured line through tracing (goes to the non-blocking file layer
        // + stdout). Under panic=abort the buffered line CAN be lost, so we
        // also write synchronously below.
        tracing::error!(location = %location, backtrace = %bt, "PANIC: {msg}");

        // Belt-and-braces: a synchronous, unbuffered append to a dedicated
        // crash file. This is the line that is guaranteed to survive abort.
        if let Some(dir) = LOG_DIR.get() {
            write_panic_file(dir, &location, &msg, &bt);
        }

        prev(info);
    }));
}

/// Extract a readable string from a panic payload (`&str` or `String`).
fn panic_payload(payload: &(dyn std::any::Any + Send)) -> String {
    if let Some(s) = payload.downcast_ref::<&str>() {
        (*s).to_string()
    } else if let Some(s) = payload.downcast_ref::<String>() {
        s.clone()
    } else {
        "<non-string panic payload>".to_string()
    }
}

/// Synchronous, append-only crash record. Never panics (a panic inside the
/// panic hook would abort immediately); all errors are swallowed.
fn write_panic_file(logs_dir: &Path, location: &str, message: &str, backtrace: &str) {
    use std::io::Write as _;
    let path = logs_dir.join("ide99-panic.log");
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(
            f,
            "---\nversion: {}\nlocation: {}\nmessage: {}\nbacktrace:\n{}",
            env!("CARGO_PKG_VERSION"),
            location,
            message,
            backtrace
        );
        let _ = f.flush();
    }
}

/// Scrub connection secrets from a string before it lands in a log that a user
/// may attach to a public issue. Covers `password=...` and URI-form
/// `://user:pass@host`.
fn redact_secrets(s: &str) -> String {
    static KV: OnceLock<regex::Regex> = OnceLock::new();
    static URI: OnceLock<regex::Regex> = OnceLock::new();
    let kv = KV.get_or_init(|| regex::Regex::new(r"(?i)password=[^ &]*").unwrap());
    let uri = URI.get_or_init(|| regex::Regex::new(r"://([^:/@\s]+):([^@\s]+)@").unwrap());
    let after_uri = uri.replace_all(s, "://$1:***@").into_owned();
    kv.replace_all(&after_uri, "password=***").into_owned()
}

/// Frontend bridge: write a frontend-side error into the Rust tracing pipeline.
/// Invoked from `src/lib/logger.ts` via `invoke("log_error", { message, detail })`.
#[tauri::command]
pub async fn log_error(message: String, detail: String) {
    tracing::error!(detail = %redact_secrets(&detail), "frontend error: {}", redact_secrets(&message));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redact_secrets_masks_kv_password() {
        assert_eq!(
            redact_secrets("host=db user=app password=s3cret dbname=main"),
            "host=db user=app password=*** dbname=main"
        );
    }

    #[test]
    fn redact_secrets_masks_uri_password() {
        assert_eq!(
            redact_secrets("postgres://app:s3cret@db.example.com:5432/main"),
            "postgres://app:***@db.example.com:5432/main"
        );
    }

    #[test]
    fn redact_secrets_leaves_clean_text_untouched() {
        assert_eq!(
            redact_secrets("connection probe failed: timeout"),
            "connection probe failed: timeout"
        );
    }
}
