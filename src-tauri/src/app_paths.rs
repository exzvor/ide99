//! OS-aware data directory resolution for ide99 persistent state.
//!
//! Honors `IDE99_DATA_DIR` env var override (used by tests + integration
//! benches to redirect away from the real user data dir). Otherwise resolves a
//! stable, product-specific directory named after the bundle identifier on
//! every platform:
//! - macOS:   ~/Library/Application Support/io.ide99.app
//! - Linux:   `$XDG_DATA_HOME/io.ide99.app`  (fallback `~/.local/share/...`)
//! - Windows: `%APPDATA%\io.ide99.app`
//!
//! We use `ProjectDirs::from_path("io.ide99.app")` rather than
//! `ProjectDirs::from("io", "ide99", "app")`: the latter is platform-
//! inconsistent — on Linux it uses ONLY the application segment, so the data
//! dir collapsed to the generic `~/.local/share/app` (issue #26), and on
//! Windows to `%APPDATA%\ide99\app`. `from_path` forces the same explicit
//! folder name everywhere. On macOS the resolved path is unchanged from the
//! legacy form, so macOS users need no migration.

use std::path::{Path, PathBuf};

use directories::ProjectDirs;

/// Stable on-disk folder name, matching the Tauri bundle identifier.
const APP_DIR_NAME: &str = "io.ide99.app";

/// Resolve the data directory path WITHOUT creating it. Honors the
/// `IDE99_DATA_DIR` override; otherwise the canonical per-OS location.
fn resolve_data_dir() -> Result<PathBuf, AppPathsError> {
    if let Ok(override_dir) = std::env::var("IDE99_DATA_DIR") {
        return Ok(PathBuf::from(override_dir));
    }
    let proj =
        ProjectDirs::from_path(PathBuf::from(APP_DIR_NAME)).ok_or(AppPathsError::NoHomeDir)?;
    Ok(proj.data_dir().to_path_buf())
}

/// Returns the data directory, creating it if needed.
///
/// # Errors
/// Returns an error if `IDE99_DATA_DIR` is unset AND no valid HOME directory
/// can be found, or if directory creation fails.
pub fn data_dir() -> Result<PathBuf, AppPathsError> {
    let dir = resolve_data_dir()?;
    std::fs::create_dir_all(&dir).map_err(AppPathsError::Mkdir)?;
    Ok(dir)
}

/// The legacy (pre-#26) data directory: `ProjectDirs::from("io","ide99","app")`.
/// On Linux this was `~/.local/share/app`, on Windows `%APPDATA%\ide99\app`,
/// and on macOS the same `…/io.ide99.app` as the canonical path. Returns `None`
/// when no HOME is resolvable.
fn legacy_data_dir() -> Option<PathBuf> {
    ProjectDirs::from("io", "ide99", "app").map(|p| p.data_dir().to_path_buf())
}

/// One-time, best-effort migration of v1.0.0–v1.0.4 user data from the legacy
/// directory to the canonical one. Called once at startup BEFORE the store is
/// opened. No-op when: the `IDE99_DATA_DIR` override is set, the legacy and
/// canonical paths coincide (macOS), the legacy dir holds no `store.db`, or the
/// canonical dir is already populated. Never deletes or overwrites existing
/// canonical data, and never panics — a failure just means the app starts in
/// the (empty) canonical dir, which is logged.
pub fn migrate_legacy_data_dir() {
    // The override path is self-contained (tests/benches); never migrate into it.
    if std::env::var_os("IDE99_DATA_DIR").is_some() {
        return;
    }
    let Ok(canonical) = resolve_data_dir() else {
        return;
    };
    let Some(legacy) = legacy_data_dir() else {
        return;
    };
    match migrate_dir(&legacy, &canonical) {
        Ok(true) => {
            tracing::info!(
                legacy = %legacy.display(),
                canonical = %canonical.display(),
                "migrated user data dir to the canonical location",
            );
        }
        Ok(false) => {}
        Err(e) => {
            tracing::warn!(
                error = %e,
                legacy = %legacy.display(),
                canonical = %canonical.display(),
                "data dir migration failed; starting in the canonical dir",
            );
        }
    }
}

/// Pure migration step: move `legacy` to `canonical` when it is safe to do so.
/// Returns `Ok(true)` if a migration was performed. Kept side-effect-explicit
/// and path-parameterized so it is unit-testable without touching HOME.
fn migrate_dir(legacy: &Path, canonical: &Path) -> std::io::Result<bool> {
    // Same resolved location (e.g. macOS) — nothing to do.
    if legacy == canonical {
        return Ok(false);
    }
    // Only a legacy dir that actually holds the store is worth migrating; an
    // absent/empty legacy dir is a fresh install.
    if !legacy.join("store.db").exists() {
        return Ok(false);
    }
    // Never clobber an already-populated canonical dir.
    if canonical.join("store.db").exists() {
        return Ok(false);
    }
    if let Some(parent) = canonical.parent() {
        std::fs::create_dir_all(parent)?;
    }
    // Prefer an atomic rename; fall back to a recursive copy across devices or
    // when the canonical dir already exists empty (rename would refuse it).
    match std::fs::rename(legacy, canonical) {
        Ok(()) => Ok(true),
        Err(_) => {
            copy_dir_recursive(legacy, canonical)?;
            Ok(true)
        }
    }
}

/// Recursively copy `from` into `to`, creating `to` if needed.
fn copy_dir_recursive(from: &Path, to: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let src = entry.path();
        let dst = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir_recursive(&src, &dst)?;
        } else {
            std::fs::copy(&src, &dst)?;
        }
    }
    Ok(())
}

/// Returns the path to the connections `SQLite` database.
pub fn store_db_path() -> Result<PathBuf, AppPathsError> {
    Ok(data_dir()?.join("store.db"))
}

/// — path to `erd-layouts.json`, where the visual schema editor
/// persists per-`(connId, schemasKey)` table positions across sessions.
pub fn erd_layouts_path() -> Result<PathBuf, AppPathsError> {
    Ok(data_dir()?.join("erd-layouts.json"))
}

/// — path to `mcp-servers.json`, the user-editable list of
/// external MCP servers ide99 should connect to (Linear, GitHub, …).
/// md` §4.
pub fn mcp_servers_config_path() -> Result<PathBuf, AppPathsError> {
    Ok(data_dir()?.join("mcp-servers.json"))
}

#[derive(Debug, thiserror::Error)]
pub enum AppPathsError {
    #[error("no valid home directory found and IDE99_DATA_DIR not set")]
    NoHomeDir,
    #[error("could not create data directory: {0}")]
    Mkdir(std::io::Error),
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::*;

    /// Serialize env-var mutation across the tests in this module — they touch
    /// `IDE99_DATA_DIR`, which is process-global, so they would otherwise race
    /// when the test runner picks parallelism > 1.
    static ENV_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn override_via_env() {
        let _g = ENV_LOCK
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let tmp = tempfile::tempdir().unwrap();
        std::env::set_var("IDE99_DATA_DIR", tmp.path());
        let dir = data_dir().unwrap();
        assert_eq!(dir, tmp.path());
        std::env::remove_var("IDE99_DATA_DIR");
    }

    #[test]
    fn store_db_path_under_data_dir() {
        let _g = ENV_LOCK
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let tmp = tempfile::tempdir().unwrap();
        std::env::set_var("IDE99_DATA_DIR", tmp.path());
        let p = store_db_path().unwrap();
        assert_eq!(p, tmp.path().join("store.db"));
        std::env::remove_var("IDE99_DATA_DIR");
    }

    #[test]
    fn canonical_dir_name_is_identifier() {
        // Regression for #26: the resolved (non-override) dir must end in the
        // product-specific identifier, never the generic "app".
        let _g = ENV_LOCK
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        std::env::remove_var("IDE99_DATA_DIR");
        if let Ok(dir) = resolve_data_dir() {
            assert_eq!(dir.file_name().unwrap().to_str().unwrap(), "io.ide99.app");
            assert_ne!(dir.file_name().unwrap().to_str().unwrap(), "app");
        }
    }

    #[test]
    fn migrate_moves_legacy_store_when_canonical_absent() {
        let tmp = tempfile::tempdir().unwrap();
        let legacy = tmp.path().join("app");
        let canonical = tmp.path().join("io.ide99.app");
        std::fs::create_dir_all(&legacy).unwrap();
        std::fs::write(legacy.join("store.db"), b"data").unwrap();
        std::fs::write(legacy.join("erd-layouts.json"), b"{}").unwrap();

        assert!(migrate_dir(&legacy, &canonical).unwrap());
        assert!(canonical.join("store.db").exists());
        assert!(canonical.join("erd-layouts.json").exists());
    }

    #[test]
    fn migrate_noop_when_canonical_already_populated() {
        let tmp = tempfile::tempdir().unwrap();
        let legacy = tmp.path().join("app");
        let canonical = tmp.path().join("io.ide99.app");
        std::fs::create_dir_all(&legacy).unwrap();
        std::fs::write(legacy.join("store.db"), b"legacy").unwrap();
        std::fs::create_dir_all(&canonical).unwrap();
        std::fs::write(canonical.join("store.db"), b"current").unwrap();

        assert!(!migrate_dir(&legacy, &canonical).unwrap());
        // Existing canonical data must be left untouched.
        assert_eq!(
            std::fs::read(canonical.join("store.db")).unwrap(),
            b"current"
        );
    }

    #[test]
    fn migrate_noop_when_legacy_absent_or_empty() {
        let tmp = tempfile::tempdir().unwrap();
        let canonical = tmp.path().join("io.ide99.app");
        // Absent legacy dir (fresh install).
        assert!(!migrate_dir(&tmp.path().join("app"), &canonical).unwrap());
        // Present but no store.db.
        let empty_legacy = tmp.path().join("app2");
        std::fs::create_dir_all(&empty_legacy).unwrap();
        assert!(!migrate_dir(&empty_legacy, &canonical).unwrap());
        assert!(!canonical.exists());
    }

    #[test]
    fn migrate_noop_when_paths_equal() {
        let tmp = tempfile::tempdir().unwrap();
        let same = tmp.path().join("io.ide99.app");
        std::fs::create_dir_all(&same).unwrap();
        std::fs::write(same.join("store.db"), b"x").unwrap();
        assert!(!migrate_dir(&same, &same).unwrap());
    }
}
