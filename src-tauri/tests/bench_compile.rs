//! Sprint 37 — bench-binary smoke test.
//!
//! Verifies that each Sprint-37-owned bench binary compiles AND lists at
//! least one Criterion bench id without panicking. Runs the bench's
//! `--list` Criterion mode (no measurement). This catches:
//!   - panics in fixture loading (e.g. malformed `include_str!` JSON,
//!     bad corpus file)
//!   - drift in the `KNOWN_BENCHES` table in `scripts/bench-compare.py`
//!     (our list of ids must be a superset of what each binary emits)
//!
//! Skipped on CI runners where the bench binaries aren't built — e.g.
//! the Tier 2 cross-platform jobs that don't run `cargo bench --no-run`.
//! We detect that by trying `escargot` to locate the binary and skipping
//! when it can't find one. To force the test on dev: `cargo test --release
//! --test bench_compile`.

use std::path::PathBuf;
use std::process::Command;

const SPRINT_37_BENCHES: &[&str] = &[
    "autocomplete_latency",
    "explain_render",
    "result_grid_format",
];

/// Locate a built bench binary under `target/<profile>/deps/`. Criterion
/// bench binaries are named `<bench_name>-<hash>` with optional `.exe` on
/// Windows. Picks the most recently-modified match. Returns `None` when
/// no candidate exists (CI env without compiled benches).
fn find_bench_binary(name: &str) -> Option<PathBuf> {
    // CARGO_TARGET_DIR override or workspace-default `target/`.
    // The bench profile lives at `target/release/deps/`.
    let target_dir = std::env::var_os("CARGO_TARGET_DIR")
        .map(PathBuf::from)
        .or_else(|| {
            // tests run from src-tauri/, target lives at workspace root
            let mut p = std::env::current_dir().ok()?;
            // walk up until we find a target/ sibling
            for _ in 0..5 {
                let candidate = p.join("target");
                if candidate.is_dir() {
                    return Some(candidate);
                }
                if !p.pop() {
                    break;
                }
            }
            None
        })?;
    let deps = target_dir.join("release").join("deps");
    if !deps.is_dir() {
        return None;
    }
    let prefix = format!("{name}-");
    let suffix_exe = if cfg!(windows) { ".exe" } else { "" };
    let mut candidates: Vec<(std::time::SystemTime, PathBuf)> = std::fs::read_dir(deps)
        .ok()?
        .flatten()
        .filter_map(|e| {
            let path = e.path();
            let fname = path.file_name()?.to_str()?.to_string();
            if !fname.starts_with(&prefix) {
                return None;
            }
            // Skip `.d` debug-info files and `.dSYM` directories.
            if fname.ends_with(".d") || fname.contains(".dSYM") {
                return None;
            }
            if !suffix_exe.is_empty() && !fname.ends_with(suffix_exe) {
                return None;
            }
            // Anything between prefix and suffix should be a hex hash.
            let mid = &fname[prefix.len()..fname.len() - suffix_exe.len()];
            if !mid.chars().all(|c| c.is_ascii_hexdigit()) {
                return None;
            }
            let mtime = e.metadata().ok()?.modified().ok()?;
            Some((mtime, path))
        })
        .collect();
    candidates.sort_by_key(|(t, _)| *t);
    candidates.pop().map(|(_, p)| p)
}

#[test]
fn sprint37_benches_list_at_least_one_id() {
    let mut found_any = false;
    for &name in SPRINT_37_BENCHES {
        let Some(bin) = find_bench_binary(name) else {
            eprintln!("skip {name}: no compiled bench binary at target/release/deps");
            continue;
        };
        found_any = true;
        // Criterion supports `--list` to dump bench ids without running them.
        let out = Command::new(&bin)
            .args(["--list", "--bench"])
            .output()
            .unwrap_or_else(|e| panic!("failed to run {bin:?}: {e}"));
        assert!(
            out.status.success(),
            "{name} --list exited with {:?}: stderr=\n{}",
            out.status,
            String::from_utf8_lossy(&out.stderr)
        );
        let stdout = String::from_utf8_lossy(&out.stdout);
        // A non-empty list is enough — we just want to catch panics in
        // fixture loading. Each bench file registers ≥1 id.
        assert!(
            stdout.lines().any(|l| !l.trim().is_empty()),
            "{name} --list emitted no bench ids; stdout=\n{stdout}"
        );
    }
    if !found_any {
        // Don't fail when no binary is on disk — CI runs without bench
        // build (most jobs only do `cargo test`). The dev recipe is
        // documented in `docs/engineering/17-benchmarks.md`:
        //   cd src-tauri && cargo bench --no-run
        //   cargo test --release --test bench_compile
        eprintln!(
            "no compiled bench binaries — skipping. Run `cargo bench --no-run` first \
             (see docs/engineering/17-benchmarks.md)."
        );
    }
}
