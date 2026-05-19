//! Notebook export & import for the `.ide99` envelope.
//!
//! Wraps S34 notebook (`crate::notebook`) — reuses `file_io::encode_minimal`
//! which already strips inline result snapshots and drops standalone Result-
//! cells (the privacy discipline established for `.ide99nb` files).
//! `connection_id` is stripped (target instance owns its own connections).
//! `id` is regenerated on apply so the same notebook can be imported into
//! multiple instances without primary-key clash.

#![allow(clippy::missing_errors_doc, clippy::missing_panics_doc)]

use chrono::Utc;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::file_sharing::types::ShareError;
use crate::notebook::store as notebook_store;
use crate::notebook::types::{Cell, Notebook, UpsertNotebookInput};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportedNotebook {
    pub name: String,
    pub cells: Vec<Cell>,
}

/// Build payload from a `Notebook` — strips inline result snapshots and
/// drops standalone Result cells (matches `notebook::file_io::encode_minimal`
/// privacy contract).
pub fn to_payload(nb: &Notebook) -> Result<serde_json::Value, ShareError> {
    let cells: Vec<Cell> = nb
        .cells
        .iter()
        .filter_map(|cell| match cell.clone() {
            Cell::Sql {
                id,
                source,
                share_as_cte,
                cte_name,
                ..
            } => Some(Cell::Sql {
                id,
                source,
                result: None,
                share_as_cte,
                cte_name,
            }),
            Cell::Markdown { .. } => Some(cell.clone()),
            Cell::Result { .. } => None,
        })
        .collect();
    let exported = ExportedNotebook {
        name: nb.name.clone(),
        cells,
    };
    serde_json::to_value(exported)
        .map_err(|e| ShareError::InvalidFile(format!("encode notebook: {e}")))
}

pub fn from_payload(value: &serde_json::Value) -> Result<ExportedNotebook, ShareError> {
    serde_json::from_value(value.clone())
        .map_err(|e| ShareError::InvalidFile(format!("decode notebook: {e}")))
}

pub fn summary(value: &serde_json::Value) -> Result<String, ShareError> {
    let nb = from_payload(value)?;
    let sql_count = nb
        .cells
        .iter()
        .filter(|c| matches!(c, Cell::Sql { .. }))
        .count();
    let md_count = nb
        .cells
        .iter()
        .filter(|c| matches!(c, Cell::Markdown { .. }))
        .count();
    Ok(format!(
        "{} ({} cells: {} SQL, {} Markdown)",
        nb.name,
        nb.cells.len(),
        sql_count,
        md_count
    ))
}

/// Apply: insert a fresh notebook row with a new id; never overwrite an
/// existing one (the imported notebook lives alongside any local one with the
/// same name — UI may rename it later).
pub fn apply(
    conn: &rusqlite::Connection,
    payload: &serde_json::Value,
) -> Result<Notebook, ShareError> {
    let exp = from_payload(payload)?;
    let id = Uuid::new_v4().to_string();
    let _ = Utc::now().to_rfc3339();
    let input = UpsertNotebookInput {
        id,
        name: exp.name,
        cells: exp.cells,
        connection_id: None,
        file_path: None,
    };
    notebook_store::upsert(conn, &input).map_err(|e| ShareError::Storage(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::notebook::types::CellResult;

    fn sample_nb_with_results() -> Notebook {
        Notebook {
            id: "nb-1".into(),
            name: "Investigation".into(),
            cells: vec![
                Cell::Markdown {
                    id: "c1".into(),
                    source: "# Hello".into(),
                },
                Cell::Sql {
                    id: "c2".into(),
                    source: "SELECT 1".into(),
                    result: Some(CellResult {
                        columns: vec!["x".into()],
                        rows: vec![vec![Some("1".into())]],
                        truncated: false,
                        duration_ms: 5,
                        executed_at: "2026-05-07T00:00:00Z".into(),
                    }),
                    share_as_cte: false,
                    cte_name: None,
                },
                Cell::Result {
                    id: "c3".into(),
                    result: CellResult {
                        columns: vec!["y".into()],
                        rows: vec![vec![Some("2".into())]],
                        truncated: false,
                        duration_ms: 1,
                        executed_at: "2026-05-07T00:00:00Z".into(),
                    },
                },
            ],
            connection_id: Some("conn-secret".into()),
            file_path: Some("/tmp/secret.ide99nb".into()),
            created_at: "2026-05-07T00:00:00Z".into(),
            updated_at: "2026-05-07T00:00:00Z".into(),
        }
    }

    #[test]
    fn payload_strips_inline_results_and_standalone_result_cells() {
        let nb = sample_nb_with_results();
        let payload = to_payload(&nb).unwrap();
        let raw = serde_json::to_string(&payload).unwrap();
        assert!(!raw.contains("executedAt"));
        assert!(!raw.contains("\"durationMs\""));
        // `connection_id`, `file_path`, `id` not in exported shape
        assert!(!raw.contains("connectionId"));
        assert!(!raw.contains("filePath"));
        assert!(!raw.contains("conn-secret"));
        // Standalone Result cell dropped
        let parsed = from_payload(&payload).unwrap();
        assert_eq!(parsed.cells.len(), 2, "Result cell dropped");
        if let Cell::Sql { result, .. } = &parsed.cells[1] {
            assert!(result.is_none(), "inline result stripped");
        } else {
            panic!("expected SQL cell");
        }
    }

    #[test]
    fn summary_breaks_down_cell_kinds() {
        let nb = sample_nb_with_results();
        let payload = to_payload(&nb).unwrap();
        assert_eq!(
            summary(&payload).unwrap(),
            "Investigation (2 cells: 1 SQL, 1 Markdown)"
        );
    }
}
