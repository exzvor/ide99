//! ERD layout export & import for the `.ide99` envelope.
//!
//! Layout = list of `(node_id, x, y)` positions only (no schema). The target
//! instance resolves them against its own current schema; missing nodes are
//! silently dropped on render.

#![allow(clippy::missing_errors_doc, clippy::missing_panics_doc)]

use serde::{Deserialize, Serialize};

use crate::file_sharing::types::ShareError;
use crate::schema::positions::NodePos;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportedErdLayout {
    pub label: String,
    pub schemas_key: String,
    pub positions: Vec<NodePos>,
}

pub fn to_payload(    label: &str,
    schemas_key: &str,
    positions: &[NodePos],
) -> Result<serde_json::Value, ShareError> {
    let exp = ExportedErdLayout {
        label: label.to_string(),
        schemas_key: schemas_key.to_string(),
        positions: positions.to_vec(),
    };
    serde_json::to_value(exp).map_err(|e| ShareError::InvalidFile(format!("encode erd: {e}")))
}

pub fn from_payload(value: &serde_json::Value) -> Result<ExportedErdLayout, ShareError> {
    serde_json::from_value(value.clone())
        .map_err(|e| ShareError::InvalidFile(format!("decode erd: {e}")))
}

pub fn summary(value: &serde_json::Value) -> Result<String, ShareError> {
    let l = from_payload(value)?;
    Ok(format!("{} ({} nodes)", l.label, l.positions.len()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pos(id: &str, x: f64, y: f64) -> NodePos {
        NodePos {
            node_id: id.into(),
            x,
            y,
        }
    }

    #[test]
    fn payload_carries_positions_only() {
        let positions = vec![
            pos("public.users", 10.0, 20.0),
            pos("public.orders", 100.0, 30.0),
        ];
        let payload = to_payload("default", "*", &positions).unwrap();
        let raw = serde_json::to_string(&payload).unwrap();
        // No schema-derived metadata leaks in.
        assert!(!raw.contains("oid"));
        assert!(!raw.contains("columns"));
        let parsed = from_payload(&payload).unwrap();
        assert_eq!(parsed.positions.len(), 2);
        assert_eq!(parsed.schemas_key, "*");
    }

    #[test]
    fn summary_counts_nodes() {
        let positions = vec![pos("a", 0.0, 0.0), pos("b", 0.0, 0.0), pos("c", 0.0, 0.0)];
        let payload = to_payload("layout", "public", &positions).unwrap();
        assert_eq!(summary(&payload).unwrap(), "layout (3 nodes)");
    }
}
