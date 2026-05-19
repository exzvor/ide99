//! OS-aware data directory resolution for ide99 persistent state.
//!
//! Honors `IDE99_DATA_DIR` env var override (used by tests + integration
//! benches to redirect away from the real user data dir). Otherwise uses
//! `directories::ProjectDirs::from("io", "ide99", "app")` which resolves to:
//! - macOS:   ~/Library/Application Support/io.ide99.app
//! - Linux:   `$XDG_DATA_HOME/io.ide99.app`  (fallback `~/.local/share/...`)
//! - Windows: %LOCALAPPDATA%\io.ide99.app

use std::path::PathBuf;

use directories::ProjectDirs;

/// Returns the data directory, creating it if needed.
///
/// # Errors
/// Returns an error if `IDE99_DATA_DIR` is unset AND `ProjectDirs::from`
/// returns `None` (no valid HOME), or if directory creation fails.
pub fn data_dir() -> Result<PathBuf, AppPathsError> {
    let dir = if let Ok(override_dir) = std::env::var("IDE99_DATA_DIR") {
        PathBuf::from(override_dir)
    } else {
        let proj = ProjectDirs::from("io", "ide99", "app").ok_or(AppPathsError::NoHomeDir)?;
        proj.data_dir().to_path_buf()
    };

    std::fs::create_dir_all(&dir).map_err(AppPathsError::Mkdir)?;
    Ok(dir)
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

    /// Serialize env-var mutation across the two tests in this module — they
    /// both touch `IDE99_DATA_DIR`, which is process-global, so they would
    /// otherwise race when the test runner picks parallelism > 1.
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
}
