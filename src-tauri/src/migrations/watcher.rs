//! Filesystem watcher for migration directories.
//!
//! Wraps `notify::recommended_watcher` with a 200ms debounce so a "Save All"
//! that touches multiple `.up.sql` files in quick succession fires the
//! application callback at most once per burst. Non-`.sql` paths (`README.md`,
//! `.gitignore`, editor backup files) are filtered out before they can
//! trigger the callback.
//!
//! ## Channel choice
//!
//! `notify` requires a `std::sync::mpsc::Sender` for its event sink. We use a
//! `std::sync::mpsc::channel` for raw events and bridge them into Tokio with
//! `tokio::task::spawn_blocking`, since blocking on `recv_timeout` outside the
//! Tokio runtime is required to avoid starving the executor. This keeps the
//! debounce loop straightforward (no async-aware bridges or extra crates) and
//! matches the simplest pattern documented in `notify`'s README.

#![allow(clippy::missing_errors_doc, clippy::missing_panics_doc)]

use std::path::{Path, PathBuf};
use std::sync::mpsc as std_mpsc;
use std::time::Duration;

use notify::{recommended_watcher, Event, RecursiveMode, Watcher};
use tokio::sync::oneshot;

use crate::migrations::types::{MigrationsError, WatcherHandle};

/// Burst-collapse window. Tuned for an editor "Save All" that may rewrite
/// every `.up.sql` in the directory in <50ms.
const DEBOUNCE_MS: u64 = 200;

/// Callback invoked from a Tokio task once per debounced burst.
///
/// The watcher doesn't hand the event payload to the caller — the only
/// contract is "something changed under the watched directory; please
/// re-discover".
pub type WatcherCallback = Box<dyn Fn() + Send + Sync + 'static>;

/// True when the path's extension is `.sql` (case-insensitive).
fn is_sql_path(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("sql"))
}

/// True when at least one of the event's paths ends with `.sql`. Notify
/// `Event` may carry multiple paths (e.g. rename) so we treat the event as
/// SQL-relevant if any path qualifies.
fn event_touches_sql(event: &Event) -> bool {
    event.paths.iter().any(|p| is_sql_path(p))
}

/// Spawn a notify-based filesystem watcher on `path` (non-recursive).
///
/// On any `.sql` create/modify/remove, fire `on_event` once per debounced
/// burst (`DEBOUNCE_MS`). Dropping the returned `WatcherHandle` (or sending
/// on its `stop` oneshot) ends the background task gracefully.
///
/// Async signature (despite no `.await` inside) so callers can compose with
/// other async setup work in `migrations_set_dir` without blocking the
/// runtime; the actual blocking happens on the `spawn_blocking` thread.
#[allow(clippy::unused_async)]
pub async fn spawn_watcher(    path: PathBuf,
    on_event: WatcherCallback,
) -> Result<WatcherHandle, MigrationsError> {
    // notify uses a sync channel; we'll bridge it into Tokio via spawn_blocking.
    let (raw_tx, raw_rx) = std_mpsc::channel::<notify::Result<Event>>();

    // Build the watcher and start it watching *path*. The watcher itself owns
    // a thread that pumps events into raw_tx; dropping the watcher stops it.
    let mut watcher = recommended_watcher(move |res: notify::Result<Event>| {
        // If the receiver is gone (task ended), the send fails silently —
        // that's fine, the watcher will be dropped soon after.
        let _ = raw_tx.send(res);
    })
    .map_err(|e| MigrationsError::Watcher(e.to_string()))?;

    watcher
        .watch(&path, RecursiveMode::NonRecursive)
        .map_err(|e| MigrationsError::Watcher(e.to_string()))?;

    let (stop_tx, mut stop_rx) = oneshot::channel::<()>();

    // Drive the debounce loop on a blocking task — std mpsc's recv_timeout is
    // sync and we don't want to spin the Tokio runtime. Inside the loop we
    // periodically `try_recv` the stop oneshot for graceful shutdown.
    tokio::task::spawn_blocking(move || {
        // Keep `watcher` alive for the life of the task — dropping it ends
        // the underlying notify thread.
        let _watcher = watcher;
        loop {
            // Block waiting for the first SQL-relevant event in this cycle.
            let first = match raw_rx.recv_timeout(Duration::from_millis(100)) {
                Ok(Ok(ev)) => {
                    if event_touches_sql(&ev) {
                        Some(ev)
                    } else {
                        // Non-SQL event — ignore and keep waiting.
                        None
                    }
                }
                // Notify error or no event in this poll window — ignore and continue.
                Ok(Err(_)) | Err(std_mpsc::RecvTimeoutError::Timeout) => None,
                Err(std_mpsc::RecvTimeoutError::Disconnected) => break,
            };

            // Check the stop signal between polls so dropping the handle ends
            // us within ~100ms even when the watched dir is quiet.
            if matches!(                stop_rx.try_recv(),
                Ok(()) | Err(oneshot::error::TryRecvError::Closed)
) {
                break;
            }

            if first.is_none() {
                continue;
            }

            // Burst window: drain every event that arrives within DEBOUNCE_MS,
            // then call on_event once.
            let deadline = std::time::Instant::now() + Duration::from_millis(DEBOUNCE_MS);
            loop {
                let remaining = deadline.saturating_duration_since(std::time::Instant::now());
                if remaining.is_zero() {
                    break;
                }
                match raw_rx.recv_timeout(remaining) {
                    Ok(_) => {
                        // Event of any kind during the burst — keep draining
                        // until the deadline. We don't care about its type;
                        // the callback fires once at the end regardless.
                    }
                    Err(std_mpsc::RecvTimeoutError::Timeout) => break,
                    Err(std_mpsc::RecvTimeoutError::Disconnected) => return,
                }
            }

            // Fire once for the entire burst.
            (on_event)();
        }
    });

    Ok(WatcherHandle { stop: stop_tx })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use tempfile::TempDir;

    /// Helper: spawn a watcher whose callback bumps a shared counter.
    async fn spawn_counted(path: PathBuf) -> (WatcherHandle, Arc<AtomicUsize>) {
        let counter = Arc::new(AtomicUsize::new(0));
        let counter_for_cb = counter.clone();
        let cb: WatcherCallback = Box::new(move || {
            counter_for_cb.fetch_add(1, Ordering::SeqCst);
        });
        let handle = spawn_watcher(path, cb).await.expect("spawn watcher");
        (handle, counter)
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn debounces_burst_writes() {
        let dir = TempDir::new().expect("tempdir");
        let (_handle, counter) = spawn_counted(dir.path().to_path_buf()).await;

        // Give the watcher a moment to start its blocking thread.
        tokio::time::sleep(Duration::from_millis(50)).await;

        // Burst: 5 writes within ~50ms.
        for i in 0..5 {
            std::fs::write(dir.path().join(format!("000{i}_x.up.sql")), "select 1;")
                .expect("write file");
            tokio::time::sleep(Duration::from_millis(5)).await;
        }

        // Wait well past the 200ms debounce window — generous on macOS where
        // FSEvents has its own coalescing latency.
        tokio::time::sleep(Duration::from_millis(600)).await;

        let count = counter.load(Ordering::SeqCst);
        // Debounce should collapse the 5 writes into 1 burst (occasionally 2
        // if the OS's notify backend splits the burst across the deadline).
        assert!(            (1..=2).contains(&count),
            "expected 1 or 2 callback invocations from burst, got {count}",
);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn ignores_non_sql_files() {
        let dir = TempDir::new().expect("tempdir");
        let (_handle, counter) = spawn_counted(dir.path().to_path_buf()).await;

        // Give the watcher a moment to start.
        tokio::time::sleep(Duration::from_millis(50)).await;

        std::fs::write(dir.path().join("README.md"), "# hi").expect("write md");
        std::fs::write(dir.path().join(".gitignore"), "target/").expect("write gitignore");
        std::fs::write(dir.path().join("notes.txt"), "scratch").expect("write txt");

        // Wait past the debounce window.
        tokio::time::sleep(Duration::from_millis(600)).await;

        let count = counter.load(Ordering::SeqCst);
        assert_eq!(            count, 0,
            "non-SQL writes should never trigger the callback (got {count})",
);
    }
}
