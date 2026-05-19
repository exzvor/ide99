//! Snippet / snippet-bundle export & import for the `.ide99` envelope.
//!
//! Wraps existing S8 user snippets (`crate::snippets`) into the universal
//! envelope. Privacy: no secrets — passthrough of label/prefix/body/doc.
//! On apply, ids/timestamps are dropped and recreated locally so the same
//! file can be imported into multiple instances without primary-key clash.

#![allow(clippy::missing_errors_doc, clippy::missing_panics_doc)]

use serde::{Deserialize, Serialize};

use crate::file_sharing::types::ShareError;
use crate::snippets::store::SnippetStore;
use crate::snippets::types::{NewUserSnippet, UserSnippet};

/// Stripped snippet shape that lives in the envelope. Drops `id`/timestamps —
/// target instance generates them on insert.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExportedSnippet {
    pub label: String,
    pub prefix: String,
    pub body: String,
    #[serde(default)]
    pub documentation: String,
}

impl From<&UserSnippet> for ExportedSnippet {
    fn from(s: &UserSnippet) -> Self {
        Self {
            label: s.label.clone(),
            prefix: s.prefix.clone(),
            body: s.body.clone(),
            documentation: s.documentation.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnippetBundle {
    pub name: String,
    pub snippets: Vec<ExportedSnippet>,
}

pub fn to_single_payload(s: &UserSnippet) -> Result<serde_json::Value, ShareError> {
    serde_json::to_value(ExportedSnippet::from(s))
        .map_err(|e| ShareError::InvalidFile(format!("encode snippet: {e}")))
}

pub fn to_bundle_payload(
    name: &str,
    snippets: &[UserSnippet],
) -> Result<serde_json::Value, ShareError> {
    let bundle = SnippetBundle {
        name: name.to_string(),
        snippets: snippets.iter().map(ExportedSnippet::from).collect(),
    };
    serde_json::to_value(bundle).map_err(|e| ShareError::InvalidFile(format!("encode bundle: {e}")))
}

pub fn from_single_payload(value: &serde_json::Value) -> Result<ExportedSnippet, ShareError> {
    serde_json::from_value(value.clone())
        .map_err(|e| ShareError::InvalidFile(format!("decode snippet: {e}")))
}

pub fn from_bundle_payload(value: &serde_json::Value) -> Result<SnippetBundle, ShareError> {
    serde_json::from_value(value.clone())
        .map_err(|e| ShareError::InvalidFile(format!("decode snippet bundle: {e}")))
}

pub fn summary(value: &serde_json::Value) -> Result<String, ShareError> {
    let s = from_single_payload(value)?;
    Ok(format!("{} (:{})", s.label, s.prefix))
}

pub fn bundle_summary(value: &serde_json::Value) -> Result<String, ShareError> {
    let b = from_bundle_payload(value)?;
    Ok(format!("{} ({} snippets)", b.name, b.snippets.len()))
}

/// Apply a single snippet payload — inserts into the `user_snippets` table.
/// Caller holds the `Store` lock. Returns the inserted row.
pub fn apply_single(
    conn: &rusqlite::Connection,
    payload: &serde_json::Value,
) -> Result<UserSnippet, ShareError> {
    let exp = from_single_payload(payload)?;
    SnippetStore::new(conn)
        .create(&NewUserSnippet {
            label: exp.label,
            prefix: exp.prefix,
            body: exp.body,
            documentation: exp.documentation,
        })
        .map_err(|e| ShareError::Storage(e.to_string()))
}

/// Apply a snippet-bundle payload — inserts every snippet sequentially.
/// Returns the count of inserted rows.
pub fn apply_bundle(
    conn: &rusqlite::Connection,
    payload: &serde_json::Value,
) -> Result<usize, ShareError> {
    let bundle = from_bundle_payload(payload)?;
    let store = SnippetStore::new(conn);
    let mut n = 0;
    for s in &bundle.snippets {
        store
            .create(&NewUserSnippet {
                label: s.label.clone(),
                prefix: s.prefix.clone(),
                body: s.body.clone(),
                documentation: s.documentation.clone(),
            })
            .map_err(|e| ShareError::Storage(e.to_string()))?;
        n += 1;
    }
    Ok(n)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fake(id: i64, label: &str) -> UserSnippet {
        UserSnippet {
            id,
            label: label.into(),
            prefix: format!("p{id}"),
            body: "SELECT 1".into(),
            documentation: String::new(),
            created_at: "2026-05-07T00:00:00Z".into(),
            updated_at: "2026-05-07T00:00:00Z".into(),
        }
    }

    #[test]
    fn exported_snippet_strips_id_and_timestamps() {
        let s = fake(42, "demo");
        let exp = ExportedSnippet::from(&s);
        let raw = serde_json::to_string(&exp).unwrap();
        assert!(!raw.contains("createdAt"));
        assert!(!raw.contains("updatedAt"));
        assert!(!raw.contains("\"id\""));
        assert!(raw.contains("demo"));
    }

    #[test]
    fn roundtrip_single() {
        let s = fake(1, "first");
        let payload = to_single_payload(&s).unwrap();
        let parsed = from_single_payload(&payload).unwrap();
        assert_eq!(parsed.label, "first");
        assert_eq!(parsed.prefix, "p1");
    }

    #[test]
    fn bundle_summary_counts_entries() {
        let snippets = vec![fake(1, "a"), fake(2, "b"), fake(3, "c")];
        let payload = to_bundle_payload("team-helpers", &snippets).unwrap();
        assert_eq!(
            bundle_summary(&payload).unwrap(),
            "team-helpers (3 snippets)"
        );
    }

    #[test]
    fn summary_shows_prefix() {
        let s = fake(1, "Sel users");
        let payload = to_single_payload(&s).unwrap();
        assert_eq!(summary(&payload).unwrap(), "Sel users (:p1)");
    }
}
