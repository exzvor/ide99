//! Cold-start Criterion benchmark.
//!
//! Measures time from spawning the release ide99 binary to the first
//! `READY` line printed on stdout. Sub-agent C wires the `READY` print in
//! `src-tauri/src/lib.rs` via the Tauri main-window event handler — this
//! bench depends on that handshake. Until C's wiring lands, the bench
//! will time out waiting for `READY`; that is expected during S1
//! integration.
//!
//! Methodology (see spec §10):
//! - Per-iteration timing via `Criterion::iter_custom` so we measure only
//!   spawn → READY, never Criterion harness overhead.
//! - One untimed warm-up spawn before the measured iterations to discard
//!   the cold-filesystem-cache outlier on CI runners.
//! - 10 measured iterations, median used (Criterion default) for the gate.
//! - Each iteration kills the child gracefully, then force-kills if it
//!   has not exited within 30s.
//!
//! Binary path resolution:
//! - Honors `IDE99_BINARY` env var when set (CI sets this to the artifact
//!   path).
//! - Otherwise falls back to `target/release/ide99[.exe]` resolved from
//!   the workspace root (`CARGO_MANIFEST_DIR` / `..`).

// `clippy::duration_suboptimal_units` is a Rust 1.95+ pedantic lint suggesting
// `Duration::from_mins(1)` — but `from_mins` was only stabilized in 1.95, while
// this repo's MSRV stays compatible with 1.89 via Homebrew rustc. Keep the
// portable `from_secs(60)` form and silence the lint on toolchains that know it.
// `unknown_lints` covers older toolchains that don't recognize the lint name.
#![allow(unknown_lints)]
#![allow(clippy::duration_suboptimal_units)]

use std::env;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use criterion::{criterion_group, criterion_main, Criterion};

/// Hard ceiling for a single launch attempt; if the binary does not print
/// `READY` within this window we declare the iteration a failure.
const READY_TIMEOUT: Duration = Duration::from_secs(30);

/// Grace window between SIGTERM and force-kill on shutdown.
const SHUTDOWN_GRACE: Duration = Duration::from_secs(30);

fn resolve_binary_path() -> PathBuf {
    if let Ok(explicit) = env::var("IDE99_BINARY") {
        return PathBuf::from(explicit);
    }

    // Fallback: workspace_root/target/release/ide99[.exe].
    // CARGO_MANIFEST_DIR points at src-tauri/, the workspace lives one up.
    let manifest_dir = env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| ".".to_string());
    let workspace_root = Path::new(&manifest_dir)
        .parent()
        .map_or_else(|| PathBuf::from("."), Path::to_path_buf);

    let bin_name = if cfg!(windows) { "ide99.exe" } else { "ide99" };
    workspace_root.join("target").join("release").join(bin_name)
}

/// Spawn the binary and block until it prints `READY` on stdout, or return
/// an error if the timeout elapses or the process exits early.
fn spawn_until_ready(binary: &Path) -> Result<(Child, Duration), String> {
    let started = Instant::now();
    let mut child = Command::new(binary)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to spawn {}: {e}", binary.display()))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "child stdout not captured".to_string())?;

    let (tx, rx) = mpsc::channel::<Result<(), String>>();
    thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            match line {
                Ok(l) if l.trim() == "READY" => {
                    let _ = tx.send(Ok(()));
                    return;
                }
                Ok(_) => {}
                Err(e) => {
                    let _ = tx.send(Err(format!("stdout read error: {e}")));
                    return;
                }
            }
        }
        let _ = tx.send(Err("child stdout closed before READY".to_string()));
    });

    match rx.recv_timeout(READY_TIMEOUT) {
        Ok(Ok(())) => Ok((child, started.elapsed())),
        Ok(Err(msg)) => {
            let _ = child.kill();
            Err(msg)
        }
        Err(_) => {
            let _ = child.kill();
            Err(format!(
                "timed out after {}s waiting for READY",
                READY_TIMEOUT.as_secs()
            ))
        }
    }
}

/// Tear the spawned child down: try graceful kill, then force after the
/// grace window. Always waits so we never leak zombies between iterations.
fn shutdown(mut child: Child) {
    // std::process::Child::kill maps to TerminateProcess on Windows and
    // SIGKILL on Unix. We do not have a portable SIGTERM in std; the
    // criterion bench only needs the process gone before the next
    // iteration, so SIGKILL is acceptable here. The Playwright e2e test
    // uses the more graceful SIGTERM path.
    let _ = child.kill();

    let deadline = Instant::now() + SHUTDOWN_GRACE;
    loop {
        match child.try_wait() {
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    return;
                }
                thread::sleep(Duration::from_millis(50));
            }
            Ok(Some(_)) | Err(_) => return,
        }
    }
}

fn bench_cold_start(c: &mut Criterion) {
    let binary = resolve_binary_path();
    assert!(
        binary.exists(),
        "ide99 binary not found at {}. Build with `cargo tauri build --release --no-bundle` \
         or set IDE99_BINARY to an explicit path.",
        binary.display()
    );

    // Untimed warm-up spawn — drops cold filesystem cache and any first-run
    // OS-level work (codesign cache, font cache) out of the measured set.
    if let Ok((child, _)) = spawn_until_ready(&binary) {
        shutdown(child);
    }

    let mut group = c.benchmark_group("cold_start");
    group
        .sample_size(10)
        // Criterion's own warm-up runs the closure repeatedly with the
        // wall-clock budget below; we do our own warm-up above and want
        // the first measured iteration to be representative, so disable
        // Criterion warm-up entirely.
        .warm_up_time(Duration::from_millis(1))
        .measurement_time(Duration::from_secs(60))
        .nresamples(1_000);

    group.bench_function("spawn_to_ready", |b| {
        b.iter_custom(|iters| {
            let mut total = Duration::ZERO;
            for _ in 0..iters {
                match spawn_until_ready(&binary) {
                    Ok((child, elapsed)) => {
                        total += elapsed;
                        shutdown(child);
                    }
                    Err(msg) => {
                        panic!("cold_start iteration failed: {msg}");
                    }
                }
            }
            total
        });
    });

    group.finish();
}

criterion_group!(benches, bench_cold_start);
criterion_main!(benches);
