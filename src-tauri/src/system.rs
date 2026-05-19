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
