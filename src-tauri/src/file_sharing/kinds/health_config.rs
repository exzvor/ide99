//! Custom Health-Screen check config export & import for the `.ide99` envelope.
//!
//! Used for "team standards" — share thresholds for bloat / cache hit / slow
//! query counts. Backend just shuttles the JSON through; UI applies it to
//! its config store.

#![allow(clippy::missing_errors_doc, clippy::missing_panics_doc)]

use serde::{Deserialize, Serialize};

use crate::file_sharing::types::ShareError;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportedHealthConfig {
    pub label: String,
    /// Free-form check map: `{ "bloat": { "warn": 30, "crit": 60 }, ... }`.
    pub checks: serde_json::Value,
}

pub fn to_payload(
    label: &str,
    checks: &serde_json::Value,
) -> Result<serde_json::Value, ShareError> {
    let exp = ExportedHealthConfig {
        label: label.to_string(),
        checks: checks.clone(),
    };
    serde_json::to_value(exp)
        .map_err(|e| ShareError::InvalidFile(format!("encode health-config: {e}")))
}

pub fn from_payload(value: &serde_json::Value) -> Result<ExportedHealthConfig, ShareError> {
    serde_json::from_value(value.clone())
        .map_err(|e| ShareError::InvalidFile(format!("decode health-config: {e}")))
}

pub fn summary(value: &serde_json::Value) -> Result<String, ShareError> {
    let c = from_payload(value)?;
    let count = c.checks.as_object().map_or(0, serde_json::Map::len);
    Ok(format!("{} ({} checks)", c.label, count))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn roundtrip_preserves_checks() {
        let checks = json!({
            "bloat": { "warn": 30, "crit": 60 },
            "cacheHit": { "warn": 0.95 }
        });
        let payload = to_payload("team-prod", &checks).unwrap();
        let parsed = from_payload(&payload).unwrap();
        assert_eq!(parsed.label, "team-prod");
        assert_eq!(parsed.checks["bloat"]["warn"], 30);
    }

    #[test]
    fn summary_counts_checks() {
        let checks = json!({"a": 1, "b": 2});
        let payload = to_payload("c", &checks).unwrap();
        assert_eq!(summary(&payload).unwrap(), "c (2 checks)");
    }
}
