//! Keybinding overrides export & import for the `.ide99` envelope.
//!
//! Keymaps are owned by the frontend (S33-era keymap-import feature). The
//! envelope carries `name + bindings` array; application is UI-side via
//! the existing keymap store.

#![allow(clippy::missing_errors_doc, clippy::missing_panics_doc)]

use serde::{Deserialize, Serialize};

use crate::file_sharing::types::ShareError;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportedKeymap {
    pub name: String,
    /// Free-form bindings list. Each entry is typically
    /// `{ "command": "...", "keys": "...", "when": "..." }` but we keep it
    /// opaque so the FE schema can evolve without bumping `version`.
    pub bindings: Vec<serde_json::Value>,
}

pub fn to_payload(
    name: &str,
    bindings: &[serde_json::Value],
) -> Result<serde_json::Value, ShareError> {
    let exp = ExportedKeymap {
        name: name.to_string(),
        bindings: bindings.to_vec(),
    };
    serde_json::to_value(exp).map_err(|e| ShareError::InvalidFile(format!("encode keymap: {e}")))
}

pub fn from_payload(value: &serde_json::Value) -> Result<ExportedKeymap, ShareError> {
    serde_json::from_value(value.clone())
        .map_err(|e| ShareError::InvalidFile(format!("decode keymap: {e}")))
}

pub fn summary(value: &serde_json::Value) -> Result<String, ShareError> {
    let k = from_payload(value)?;
    Ok(format!("{} ({} bindings)", k.name, k.bindings.len()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn roundtrip_preserves_bindings() {
        let bindings = vec![
            json!({"command": "editor.run", "keys": "Cmd+Enter"}),
            json!({"command": "editor.format", "keys": "Cmd+Shift+F"}),
        ];
        let payload = to_payload("dbeaver-style", &bindings).unwrap();
        let parsed = from_payload(&payload).unwrap();
        assert_eq!(parsed.name, "dbeaver-style");
        assert_eq!(parsed.bindings.len(), 2);
        assert_eq!(parsed.bindings[0]["command"], "editor.run");
    }

    #[test]
    fn summary_counts_bindings() {
        let payload =
            to_payload("demo", &[json!({"a": 1}), json!({"b": 2}), json!({"c": 3})]).unwrap();
        assert_eq!(summary(&payload).unwrap(), "demo (3 bindings)");
    }
}
