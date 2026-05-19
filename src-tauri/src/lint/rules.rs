//! — One-shot `squawk --list-rules --json` cache.
//!
//! The map is built lazily on first call to `list_rules`. Subsequent calls
//! return the cached map — Squawk's rule descriptions don't change at runtime.

#![allow(clippy::missing_errors_doc, clippy::missing_panics_doc)]

use std::collections::HashMap;
use std::process::Command;
use std::sync::OnceLock;

use serde::Deserialize;

use crate::lint::discovery::find_squawk;
use crate::lint::types::{LintError, ListRulesResult};

#[derive(Deserialize)]
struct SquawkRule {
    name: String,
    #[serde(default)]
    description: String,
}

/// Cache populated on first successful `list_rules` call. None until then.
/// Process-lifetime; cleared only on restart (which is fine — Squawk's rule
/// catalog only changes when the user installs a new Squawk version).
static CACHE: OnceLock<HashMap<String, String>> = OnceLock::new();

pub fn parse_rules_json(json: &str) -> Result<HashMap<String, String>, LintError> {
    let rules: Vec<SquawkRule> =
        serde_json::from_str(json).map_err(|e| LintError::ParseError(e.to_string()))?;
    let mut map = HashMap::with_capacity(rules.len());
    for r in rules {
        map.insert(r.name, r.description);
    }
    Ok(map)
}

pub async fn list_rules() -> Result<ListRulesResult, LintError> {
    if let Some(cached) = CACHE.get() {
        return Ok(ListRulesResult {
            rules: cached.clone(),
        });
    }

    let install = find_squawk().await;
    if !install.installed {
        return Err(LintError::NotInstalled);
    }

    let output = tokio::task::spawn_blocking(|| {
        Command::new("squawk")
            .arg("--list-rules")
            .arg("--json")
            .output()
    })
    .await
    .map_err(|e| LintError::Io(e.to_string()))?
    .map_err(|e| LintError::Io(e.to_string()))?;

    if !output.status.success() {
        return Err(LintError::SubprocessFailed {
            code: output.status.code().unwrap_or(-1),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let rules = parse_rules_json(&stdout)?;
    let _ = CACHE.set(rules.clone());
    Ok(ListRulesResult { rules })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_squawk_rules_json() {
        // Squawk's --list-rules --json output (real shape from Squawk 1.5):
        // [
        // { "name": "prefer-text-field", "description": "Use text instead of varchar." },
        // { "name": "ban-drop-database", "description": "Don't drop databases." }
        // ]
        let json = r#"[
            {"name": "prefer-text-field", "description": "Use text instead of varchar."},
            {"name": "ban-drop-database", "description": "Don't drop databases."}
        ]"#;
        let parsed = parse_rules_json(json).unwrap();
        assert_eq!(
            parsed.get("prefer-text-field"),
            Some(&"Use text instead of varchar.".to_string())
        );
        assert_eq!(parsed.len(), 2);
    }

    #[test]
    fn parse_rules_json_handles_missing_description() {
        // Forward compat: some Squawk versions may emit different field names;
        // our parser must tolerate `description` missing (return empty string).
        let json = r#"[{"name": "no-desc-rule"}]"#;
        let parsed = parse_rules_json(json).unwrap();
        assert_eq!(parsed.get("no-desc-rule"), Some(&String::new()));
    }
}
