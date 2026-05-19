//! `.ide99nb` file format read/write.
//!
//! Wraps a `Notebook` in a `NotebookFile` envelope (version + kind) —
//! currently version=1. Forward-compat: the version is checked on read,
//! and the `kind="notebook"` tag prevents importing foreign JSON files.

#![allow(clippy::missing_errors_doc)]

use std::fs;
use std::path::Path;

use chrono::Utc;
use uuid::Uuid;

use crate::notebook::types::{
    Cell, Notebook, NotebookError, NotebookFile, NOTEBOOK_FILE_KIND, NOTEBOOK_FILE_VERSION,
};

/// Encode a notebook into pretty JSON wrapped in a `NotebookFile` envelope.
pub fn encode(notebook: &Notebook) -> Result<String, NotebookError> {
    let envelope = NotebookFile {
        version: NOTEBOOK_FILE_VERSION,
        kind: NOTEBOOK_FILE_KIND.into(),
        exported_at: Utc::now().to_rfc3339(),
        notebook: notebook.clone(),
    };
    serde_json::to_string_pretty(&envelope)
        .map_err(|e| NotebookError::InvalidFile(format!("encode: {e}")))
}

/// Encode a notebook without inline `result` snapshots — for sharing
/// notebooks (tutorials, code review) without the last query results.
///
/// SQL cells keep body + `share_as_cte` + `cte_name`; `result` is reset
/// to `None`. Standalone `Result` cells are fully excluded from the
/// export (they make no sense without their source).
pub fn encode_minimal(notebook: &Notebook) -> Result<String, NotebookError> {
    let mut cloned = notebook.clone();
    cloned.cells = cloned
        .cells
        .into_iter()
        .filter_map(|cell| match cell {
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
            Cell::Markdown { .. } => Some(cell),
            Cell::Result { .. } => None,
        })
        .collect();
    encode(&cloned)
}

/// Parse `.ide99nb` JSON; rejects mismatched `kind` and unsupported
/// `version > NOTEBOOK_FILE_VERSION` (older versions are passed through —
/// when v2 lands, add explicit migration here).
///
/// Normalisation: if `notebook.id` is missing or empty, a fresh UUID v4
/// is generated. This lets users share notebooks without leaking their
/// local id and prevents clashes when importing somebody else's export
/// into an existing `SQLite` database.
pub fn decode(raw: &str) -> Result<Notebook, NotebookError> {
    let envelope: NotebookFile = serde_json::from_str(raw)
        .map_err(|e| NotebookError::InvalidFile(format!("decode: {e}")))?;
    if envelope.kind != NOTEBOOK_FILE_KIND {
        return Err(NotebookError::InvalidFile(format!(
            "expected kind='{NOTEBOOK_FILE_KIND}', got '{}'",
            envelope.kind
        )));
    }
    if envelope.version > NOTEBOOK_FILE_VERSION {
        return Err(NotebookError::InvalidFile(format!(
            "unsupported version {} (max supported: {NOTEBOOK_FILE_VERSION})",
            envelope.version
        )));
    }
    let mut nb = envelope.notebook;
    if nb.id.trim().is_empty() {
        nb.id = Uuid::new_v4().to_string();
    }
    Ok(nb)
}

pub fn write_to_path(path: &Path, notebook: &Notebook) -> Result<(), NotebookError> {
    let raw = encode(notebook)?;
    fs::write(path, raw).map_err(|e| NotebookError::Io(e.to_string()))
}

pub fn write_minimal_to_path(path: &Path, notebook: &Notebook) -> Result<(), NotebookError> {
    let raw = encode_minimal(notebook)?;
    fs::write(path, raw).map_err(|e| NotebookError::Io(e.to_string()))
}

pub fn read_from_path(path: &Path) -> Result<Notebook, NotebookError> {
    let raw = fs::read_to_string(path).map_err(|e| NotebookError::Io(e.to_string()))?;
    decode(&raw)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::notebook::types::Cell;
    use tempfile::tempdir;

    fn sample_nb() -> Notebook {
        Notebook {
            id: "nb-1".into(),
            name: "Demo".into(),
            cells: vec![
                Cell::Markdown {
                    id: "c1".into(),
                    source: "# Title".into(),
                },
                Cell::Sql {
                    id: "c2".into(),
                    source: "SELECT 1".into(),
                    result: None,
                    share_as_cte: true,
                    cte_name: Some("first".into()),
                },
            ],
            connection_id: None,
            file_path: None,
            created_at: "2026-05-06T00:00:00Z".into(),
            updated_at: "2026-05-06T00:00:00Z".into(),
        }
    }

    #[test]
    fn encode_decode_roundtrip() {
        let nb = sample_nb();
        let raw = encode(&nb).expect("encode");
        let decoded = decode(&raw).expect("decode");
        assert_eq!(decoded.id, nb.id);
        assert_eq!(decoded.cells.len(), 2);
    }

    #[test]
    fn rejects_wrong_kind() {
        let bad = r#"{"version":1,"kind":"snippets","exportedAt":"x","notebook":{"id":"n","name":"","cells":[],"createdAt":"x","updatedAt":"x"}}"#;
        let err = decode(bad).expect_err("must fail");
        assert!(matches!(err, NotebookError::InvalidFile(_)));
    }

    #[test]
    fn rejects_future_version() {
        let bad = r#"{"version":99,"kind":"notebook","exportedAt":"x","notebook":{"id":"n","name":"","cells":[],"createdAt":"x","updatedAt":"x"}}"#;
        let err = decode(bad).expect_err("must fail");
        assert!(matches!(err, NotebookError::InvalidFile(_)));
    }

    #[test]
    fn write_then_read() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("demo.ide99nb");
        write_to_path(&path, &sample_nb()).expect("write");
        let nb = read_from_path(&path).expect("read");
        assert_eq!(nb.id, "nb-1");
    }

    #[test]
    fn decode_regenerates_missing_id() {
        // Manually-crafted .ide99nb with an empty id (e.g. foreign export).
        let raw = r#"{
            "version": 1,
            "kind": "notebook",
            "exportedAt": "2026-05-06T00:00:00Z",
            "notebook": {
                "id": "",
                "name": "Shared",
                "cells": [],
                "createdAt": "2026-05-06T00:00:00Z",
                "updatedAt": "2026-05-06T00:00:00Z"
            }
        }"#;
        let nb = decode(raw).expect("decode");
        assert!(!nb.id.is_empty());
        // Must be a valid UUID v4 (36 chars, dash-separated).
        assert_eq!(nb.id.len(), 36);
        assert_eq!(nb.id.matches('-').count(), 4);
    }

    #[test]
    fn decode_regenerates_whitespace_id() {
        let raw = r#"{
            "version": 1,
            "kind": "notebook",
            "exportedAt": "2026-05-06T00:00:00Z",
            "notebook": {
                "id": "   ",
                "name": "x",
                "cells": [],
                "createdAt": "2026-05-06T00:00:00Z",
                "updatedAt": "2026-05-06T00:00:00Z"
            }
        }"#;
        let nb = decode(raw).expect("decode");
        assert_ne!(nb.id, "   ");
        assert!(!nb.id.trim().is_empty());
    }

    #[test]
    fn encode_minimal_strips_inline_results() {
        let mut nb = sample_nb();
        // Inject a result-snapshot.
        if let Cell::Sql { result, .. } = &mut nb.cells[1] {
            *result = Some(crate::notebook::types::CellResult {
                columns: vec!["c".into()],
                rows: vec![vec![Some("v".into())]],
                truncated: false,
                duration_ms: 5,
                executed_at: "2026-05-06T00:00:00Z".into(),
            });
        } else {
            panic!("expected SQL cell");
        }
        let raw = encode_minimal(&nb).expect("encode_minimal");
        assert!(!raw.contains("\"result\""), "result should be stripped");
        assert!(!raw.contains("executedAt"));
        // Re-decode and check structural integrity.
        let decoded = decode(&raw).expect("decode");
        assert_eq!(decoded.cells.len(), 2);
        if let Cell::Sql { result, .. } = &decoded.cells[1] {
            assert!(result.is_none());
        } else {
            panic!("expected SQL cell after decode");
        }
    }

    #[test]
    fn encode_minimal_drops_standalone_result_cells() {
        let mut nb = sample_nb();
        nb.cells.push(Cell::Result {
            id: "r1".into(),
            result: crate::notebook::types::CellResult {
                columns: vec!["x".into()],
                rows: vec![vec![Some("1".into())]],
                truncated: false,
                duration_ms: 1,
                executed_at: "2026-05-06T00:00:00Z".into(),
            },
        });
        assert_eq!(nb.cells.len(), 3);
        let raw = encode_minimal(&nb).expect("encode_minimal");
        let decoded = decode(&raw).expect("decode");
        assert_eq!(decoded.cells.len(), 2, "standalone Result-cell dropped");
    }
}
