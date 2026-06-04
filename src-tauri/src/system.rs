//! System integration commands shared across panels.
//!
//! Currently exposes only [`open_external_url`] — Tauri 2 doesn't open
//! `window.open(url, "_blank")` in the OS browser by default, so PostgreSQL
//! "Help" links rendered inside object editors silently did nothing. We
//! prefer a tiny in-tree command over pulling in `tauri-plugin-shell` /
//! `tauri-plugin-opener` because it keeps the Cargo dep set lean and the
//! permission surface explicit.

use std::process::Command;

#[derive(Debug, thiserror::Error, serde::Serialize)]
#[serde(tag = "kind", content = "message", rename_all = "camelCase")]
pub enum OpenUrlError {
    #[error("invalid url: only http(s) is allowed")]
    InvalidScheme,
    #[error("failed to spawn opener: {0}")]
    Spawn(String),
    #[error("opener exited with non-zero status: {0}")]
    NonZero(String),
}

/// Open an http(s) URL in the user's default browser.
///
/// Validates the scheme is `http` or `https` so a malicious snippet can't
/// trick a panel into invoking `file://`, `javascript:`, or shelling out
/// via `data:`. Uses the platform-native opener (`open` on macOS,
/// `xdg-open` on Linux, `cmd /c start` on Windows). Returns the kind of
/// failure to the frontend so the caller can localize a toast.
#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), OpenUrlError> {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err(OpenUrlError::InvalidScheme);
    }

    #[cfg(target_os = "macos")]
    let command_result = Command::new("open").arg(&url).status();

    #[cfg(target_os = "linux")]
    let command_result = Command::new("xdg-open").arg(&url).status();

    #[cfg(target_os = "windows")]
    let command_result = {
        // `start` is a cmd builtin, so it must run via cmd.exe; the empty
        // first argument prevents `start` from interpreting the URL as the
        // window title when it contains spaces.
        Command::new("cmd").args(["/C", "start", "", &url]).status()
    };

    match command_result {
        Ok(status) if status.success() => Ok(()),
        Ok(status) => Err(OpenUrlError::NonZero(format!("{status}"))),
        Err(e) => Err(OpenUrlError::Spawn(e.to_string())),
    }
}

#[derive(Debug, thiserror::Error, serde::Serialize)]
#[serde(tag = "kind", content = "message", rename_all = "camelCase")]
pub enum OpenLogsError {
    #[error("could not resolve data dir: {0}")]
    DataDir(String),
    #[error("could not create logs dir: {0}")]
    Mkdir(String),
    #[error("failed to spawn file manager: {0}")]
    Spawn(String),
}

/// Reveal the app's log folder (`<data_dir>/logs`) in the OS file manager and
/// return its path so the UI can also show it as text (issue #14 follow-up:
/// Windows users couldn't find the logs and looked in the WebView2 cache dir).
#[tauri::command]
pub fn open_logs_folder() -> Result<String, OpenLogsError> {
    let logs = crate::app_paths::data_dir()
        .map_err(|e| OpenLogsError::DataDir(e.to_string()))?
        .join("logs");
    std::fs::create_dir_all(&logs).map_err(|e| OpenLogsError::Mkdir(e.to_string()))?;
    let path = logs.to_string_lossy().into_owned();

    #[cfg(target_os = "macos")]
    let result = Command::new("open").arg(&logs).status();

    #[cfg(target_os = "linux")]
    let result = Command::new("xdg-open").arg(&logs).status();

    #[cfg(target_os = "windows")]
    let result = Command::new("explorer").arg(&logs).status();

    // Best-effort reveal: we don't gate on exit status. `explorer.exe` returns
    // exit code 1 even on success, and `open`/`xdg-open` hand off and exit; the
    // only real failure is a spawn error (file manager missing).
    match result {
        Ok(_) => Ok(path),
        Err(e) => Err(OpenLogsError::Spawn(e.to_string())),
    }
}
