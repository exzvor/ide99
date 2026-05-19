//! — Subprocess invocation of `squawk lint --reporter json` + parser.
//!
//! Public surface: `parse_findings_json` (pure) and `lint_path` (async, runs
//! Squawk under a 5s timeout). When Squawk is not on PATH, `lint_path`
//! returns an empty findings list (silent no-op — the frontend already shows
//! the install banner via `lint_check_install`).

#![allow(clippy::missing_errors_doc, clippy::missing_panics_doc)]

use std::process::Command;
use std::time::Duration;

use serde::Deserialize;
use tokio::time::timeout;

use crate::lint::discovery::find_squawk;
use crate::lint::types::{LintError, LintFileResult, SquawkFinding, SquawkSeverity};

const TIMEOUT_MS: u64 = 5_000;

/// Squawk's JSON output: array of these envelope objects.
#[derive(Deserialize)]
struct SquawkEntry {
    file: String,
    line: u32,
    column: u32,
    #[serde(default)]
    level: String,
    #[serde(default)]
    messages: Vec<SquawkMessage>,
}

#[derive(Deserialize)]
struct SquawkMessage {
    #[serde(rename = "Title", default)]
    title: String,
    #[serde(rename = "Note", default)]
    note: String,
}

fn level_to_severity(s: &str) -> SquawkSeverity {
    // Squawk uses "Warning" / "Error" (capitalized). Anything else → Warning.
    match s.to_ascii_lowercase().as_str() {
        "error" => SquawkSeverity::Error,
        _ => SquawkSeverity::Warning,
    }
}

pub fn parse_findings_json(json: &str) -> Result<Vec<SquawkFinding>, LintError> {
    let entries: Vec<SquawkEntry> =
        serde_json::from_str(json).map_err(|e| LintError::ParseError(e.to_string()))?;
    let mut findings = Vec::new();
    for entry in entries {
        let severity = level_to_severity(&entry.level);
        for msg in entry.messages {
            findings.push(SquawkFinding {
                rule: msg.title,
                severity,
                file: entry.file.clone(),
                line: entry.line,
                column: entry.column,
                message: msg.note,
            });
        }
    }
    Ok(findings)
}

pub async fn lint_path(path: &str) -> Result<LintFileResult, LintError> {
    let install = find_squawk().await;
    if !install.installed {
        // Per design §8: silent no-op when Squawk missing (frontend already
        // shows install banner).
        return Ok(LintFileResult {
            findings: Vec::new(),
        });
    }

    let path_owned = path.to_string();
    let blocking = tokio::task::spawn_blocking(move || {
        Command::new("squawk")
            .args(["lint", "--reporter", "json"])
            .arg(&path_owned)
            .output()
    });

    let output_result = timeout(Duration::from_millis(TIMEOUT_MS), blocking)
        .await
        .map_err(|_| LintError::Timeout { ms: TIMEOUT_MS })?
        .map_err(|e| LintError::Io(e.to_string()))?;

    let output = match output_result {
        Ok(o) => o,
        Err(e) => return Err(LintError::Io(e.to_string())),
    };

    // Squawk: exit 0 = clean; exit 1 = findings present (still success); >1 = error.
    let code = output.status.code().unwrap_or(-1);
    if code > 1 {
        return Err(LintError::SubprocessFailed {
            code,
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        return Ok(LintFileResult {
            findings: Vec::new(),
        });
    }

    let findings = parse_findings_json(trimmed)?;
    Ok(LintFileResult { findings })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn squawk_available() -> bool {
        which::which("squawk").is_ok()
    }

    macro_rules! skip_if_no_squawk {
        () => {
            if !squawk_available() {
                eprintln!("[skip] squawk not on PATH");
                return;
            }
        };
    }

    #[test]
    fn parses_squawk_findings_json() {
        // Real Squawk JSON output shape (squawk lint --reporter json on a violating .sql):
        // [
        // {
        // "file": "/tmp/foo.up.sql",
        // "line": 1,
        // "column": 1,
        // "level": "Warning",
        // "messages": [{"Note": "...", "Help": null, "Title": "prefer-text-field"}]
        // }
        // ]
        // Our parser collapses each `messages[i]` into one SquawkFinding.
        let json = r#"[
            {
                "file": "/tmp/x.up.sql",
                "line": 1,
                "column": 1,
                "level": "Warning",
                "messages": [{"Note": "Use text", "Help": null, "Title": "prefer-text-field"}]
            }
        ]"#;
        let findings = parse_findings_json(json).unwrap();
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].rule, "prefer-text-field");
        assert_eq!(findings[0].line, 1);
        assert_eq!(findings[0].file, "/tmp/x.up.sql");
        assert_eq!(            findings[0].severity,
            crate::lint::types::SquawkSeverity::Warning
);
    }

    #[test]
    fn parse_findings_handles_empty_array() {
        let findings = parse_findings_json("[]").unwrap();
        assert_eq!(findings.len(), 0);
    }

    #[test]
    fn parse_findings_handles_unknown_severity() {
        // Forward-compat: unknown severity defaults to Warning.
        let json = r#"[
            {"file":"x","line":1,"column":1,"level":"FutureLevel","messages":[{"Title":"r"}]}
        ]"#;
        let findings = parse_findings_json(json).unwrap();
        assert_eq!(            findings[0].severity,
            crate::lint::types::SquawkSeverity::Warning
);
    }

    #[tokio::test]
    async fn lint_path_returns_empty_when_no_squawk() {
        skip_if_no_squawk!();
        // Empty SQL → no findings. Touches the real Squawk binary if available.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("empty.up.sql");
        std::fs::write(&path, "-- empty\n").unwrap();
        let result = lint_path(path.to_str().unwrap()).await.unwrap();
        assert_eq!(result.findings.len(), 0);
    }

    #[tokio::test]
    async fn lint_path_invalid_sql_doesnt_panic() {
        skip_if_no_squawk!();
        // Squawk's behavior on invalid SQL: emits a finding for the parse error
        // OR exits with a non-zero code. Either way, we should get a Result back,
        // not a panic.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("invalid.up.sql");
        std::fs::write(&path, "THIS IS NOT SQL").unwrap();
        let _ = lint_path(path.to_str().unwrap()).await;
        // Test passes if we got here without panic.
    }
}
