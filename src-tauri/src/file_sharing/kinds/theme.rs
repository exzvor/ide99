//! Custom theme export & import for the `.ide99` envelope.
//!
//! Themes are CSS-token bundles owned by the frontend (no backend storage
//! today). The envelope just carries `name + tokens` JSON — application is
//! UI-side. Privacy: passthrough; tokens are colors/sizes only.

#![allow(clippy::missing_errors_doc, clippy::missing_panics_doc)]

use serde::{Deserialize, Serialize};

use crate::file_sharing::types::ShareError;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportedTheme {
    pub name: String,
    /// CSS-variable map: `--bg-elev` → `#1a1a1a`, etc. Free-form to keep the
    /// envelope forward-compatible with frontend-side token additions.
    pub tokens: serde_json::Value,
}

pub fn to_payload(name: &str, tokens: &serde_json::Value) -> Result<serde_json::Value, ShareError> {
    let exp = ExportedTheme {
        name: name.to_string(),
        tokens: tokens.clone(),
    };
    serde_json::to_value(exp).map_err(|e| ShareError::InvalidFile(format!("encode theme: {e}")))
}

pub fn from_payload(value: &serde_json::Value) -> Result<ExportedTheme, ShareError> {
    serde_json::from_value(value.clone())
        .map_err(|e| ShareError::InvalidFile(format!("decode theme: {e}")))
}

pub fn summary(value: &serde_json::Value) -> Result<String, ShareError> {
    let t = from_payload(value)?;
    let count = t.tokens.as_object().map_or(0, serde_json::Map::len);
    Ok(format!("{} ({} tokens)", t.name, count))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn roundtrip_preserves_tokens() {
        let tokens = json!({
            "--bg": "#1a1a1a",
            "--fg": "#fafafa"
        });
        let payload = to_payload("midnight", &tokens).unwrap();
        let parsed = from_payload(&payload).unwrap();
        assert_eq!(parsed.name, "midnight");
        assert_eq!(parsed.tokens["--bg"], "#1a1a1a");
    }

    #[test]
    fn summary_counts_tokens() {
        let tokens = json!({"a": 1, "b": 2, "c": 3});
        let payload = to_payload("t", &tokens).unwrap();
        assert_eq!(summary(&payload).unwrap(), "t (3 tokens)");
    }
}
