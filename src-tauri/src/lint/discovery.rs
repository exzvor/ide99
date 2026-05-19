//! — Squawk binary discovery on PATH + version probe.
//!
//! Surfaces a `CheckInstallResult` for the frontend's install banner and
//! is also consumed internally by `runner` / `rules` to short-circuit when
//! Squawk is missing.

#![allow(clippy::missing_errors_doc, clippy::missing_panics_doc)]

use std::process::Command;

use crate::lint::types::CheckInstallResult;

/// Parse Squawk's `--version` output. Format: `"squawk 1.5.0\n"`.
/// Returns `Some("1.5.0")` on success, `None` if the line doesn't match.
pub fn parse_version_line(s: &str) -> Option<String> {
    let trimmed = s.trim();
    let prefix = "squawk ";
    if !trimmed.starts_with(prefix) {
        return None;
    }
    let version = trimmed[prefix.len()..].trim();
    if version.is_empty() {
        return None;
    }
    Some(version.to_string())
}

/// Locate `squawk` on PATH and probe its version.
///
/// Result fields:
/// - `installed = true, version = Some(_)` → Squawk found and version probe succeeded
/// - `installed = true, version = None`    → Squawk found but `--version` returned garbage (rare)
/// - `installed = false, version = None`   → Squawk not on PATH
pub async fn find_squawk() -> CheckInstallResult {
    let path = std::env::var("PATH").unwrap_or_default();
    find_squawk_with_path(&path).await
}

/// Test-friendly variant — caller injects an explicit PATH string.
pub async fn find_squawk_with_path(path: &str) -> CheckInstallResult {
    let cwd = std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
    let exe = match which::which_in("squawk", Some(path), cwd) {
        Ok(p) => p,
        Err(_) => {
            return CheckInstallResult {
                installed: false,
                version: None,
            }
        }
    };

    let result =
        tokio::task::spawn_blocking(move || Command::new(exe).arg("--version").output()).await;

    let output = match result {
        Ok(Ok(o)) => o,
        _ => {
            return CheckInstallResult {
                installed: true,
                version: None,
            }
        }
    };

    if !output.status.success() {
        return CheckInstallResult {
            installed: true,
            version: None,
        };
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    CheckInstallResult {
        installed: true,
        version: parse_version_line(&stdout),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_version_from_squawk_output() {
        assert_eq!(            parse_version_line("squawk 1.5.0\n"),
            Some("1.5.0".to_string())
);
        assert_eq!(            parse_version_line("squawk 1.5.0"),
            Some("1.5.0".to_string())
);
    }

    #[test]
    fn parses_version_returns_none_for_garbage() {
        assert_eq!(parse_version_line(""), None);
        assert_eq!(parse_version_line("not squawk"), None);
        assert_eq!(parse_version_line("squawk"), None); // no version after the name
    }

    #[tokio::test]
    async fn find_squawk_returns_none_when_not_on_path() {
        // Use a deliberately-empty PATH so even if the dev machine has squawk,
        // the lookup fails. We test the "not found" branch.
        let result = find_squawk_with_path("/nonexistent/dir/that/does/not/exist").await;
        assert!(!result.installed);
        assert_eq!(result.version, None);
    }
}
