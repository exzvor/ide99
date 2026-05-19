//! Query (saved editor tab) export & import for the `.ide99` envelope.
//!
//! Backed by `editor_tabs` `SQLite` table — queries are persisted as editor
//! tabs with `kind = "editor"`. Privacy: the source instance's `connection_id`
//! is stripped (the target instance has its own connections). `node_key` is
//! also dropped (it points at a schema browser path that won't exist remotely).

#![allow(clippy::missing_errors_doc, clippy::missing_panics_doc)]

use chrono::Utc;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::file_sharing::types::ShareError;
use crate::query::tabs;
use crate::query::types::EditorTabRow;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExportedQuery {
    pub name: String,
    pub content: String,
    /// Editor or object-editor flavor — preserved verbatim.
    #[serde(default = "default_kind")]
    pub kind: String,
}

fn default_kind() -> String {
    "editor".into()
}

impl From<&EditorTabRow> for ExportedQuery {
    fn from(row: &EditorTabRow) -> Self {
        Self {
            name: row.name.clone(),
            content: row.content.clone(),
            kind: row.kind.clone(),
        }
    }
}

pub fn to_payload(row: &EditorTabRow) -> Result<serde_json::Value, ShareError> {
    serde_json::to_value(ExportedQuery::from(row))
        .map_err(|e| ShareError::InvalidFile(format!("encode query: {e}")))
}

pub fn from_payload(value: &serde_json::Value) -> Result<ExportedQuery, ShareError> {
    serde_json::from_value(value.clone())
        .map_err(|e| ShareError::InvalidFile(format!("decode query: {e}")))
}

pub fn summary(value: &serde_json::Value) -> Result<String, ShareError> {
    let q = from_payload(value)?;
    let snippet: String = q.content.chars().take(60).collect();
    Ok(format!("{} ({} chars)", q.name, snippet.len()))
}

/// Apply: insert a fresh `editor_tabs` row with a new id + timestamps.
/// `connection_id` and `node_key` deliberately reset to NULL — caller (UI)
/// re-binds them to a target connection if desired.
pub fn apply(    conn: &rusqlite::Connection,
    payload: &serde_json::Value,
) -> Result<EditorTabRow, ShareError> {
    let q = from_payload(payload)?;
    let now = Utc::now().to_rfc3339();
    let row = EditorTabRow {
        id: Uuid::new_v4().to_string(),
        kind: if q.kind.is_empty() {
            "editor".into()
        } else {
            q.kind
        },
        name: q.name,
        content: q.content,
        connection_id: None,
        node_key: None,
        cursor_line: 1,
        cursor_col: 1,
        created_at: now.clone(),
        updated_at: now,
    };
    tabs::upsert(conn, &row).map_err(|e| ShareError::Storage(e.to_string()))?;
    Ok(row)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fake(id: &str, name: &str) -> EditorTabRow {
        EditorTabRow {
            id: id.into(),
            kind: "editor".into(),
            name: name.into(),
            content: "SELECT * FROM users".into(),
            connection_id: Some("conn-secret".into()),
            node_key: Some("schema/public/users".into()),
            cursor_line: 5,
            cursor_col: 8,
            created_at: "2026-05-07T00:00:00Z".into(),
            updated_at: "2026-05-07T00:00:00Z".into(),
        }
    }

    #[test]
    fn exported_query_strips_connection_id_and_node_key() {
        let row = fake("t-1", "active users");
        let exp = ExportedQuery::from(&row);
        let raw = serde_json::to_string(&exp).unwrap();
        assert!(!raw.contains("connectionId"));
        assert!(!raw.contains("nodeKey"));
        assert!(!raw.contains("conn-secret"));
        assert!(raw.contains("active users"));
    }

    #[test]
    fn roundtrip_keeps_content_and_kind() {
        let row = fake("t-1", "demo");
        let payload = to_payload(&row).unwrap();
        let parsed = from_payload(&payload).unwrap();
        assert_eq!(parsed.name, "demo");
        assert_eq!(parsed.content, "SELECT * FROM users");
        assert_eq!(parsed.kind, "editor");
    }

    #[test]
    fn summary_includes_name() {
        let row = fake("t-1", "demo");
        let payload = to_payload(&row).unwrap();
        let s = summary(&payload).unwrap();
        assert!(s.starts_with("demo"));
    }
}
