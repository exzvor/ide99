//! Notebook types — DTO surface for the frontend + persistence layer.
//!
//! Cell is a discriminated union: `sql` (executable), `markdown`
//! (documentation), `result` (auto-generated after execute). `result`
//! is stored optionally — the frontend may push the last-run snapshot
//! for restore-on-reload.
//!
//! A cell `id` is an opaque string (the frontend generates ULID/UUID);
//! the backend does not interpret it, only serializes it verbatim.

#![allow(clippy::struct_excessive_bools)]

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Cell {
    Sql {
        id: String,
        source: String,
        /// Optional last-run snapshot — kept inline so reload restores the
        /// result without re-executing (important for bug-investigation
        /// notebooks).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        result: Option<CellResult>,
        /// `true` if the cell is part of a CTE chain (see `cte::compose`).
        /// Off by default: the user explicitly marks "share as CTE".
        #[serde(default)]
        share_as_cte: bool,
        /// CTE name (used with `share_as_cte`); fallback is `cell_<idx>`.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        cte_name: Option<String>,
    },
    Markdown {
        id: String,
        source: String,
    },
    /// Standalone Result cell (rare — results usually live inline in SQL).
    /// Used when the user explicitly inserts a result snapshot (for
    /// example via `Insert result above`).
    Result {
        id: String,
        result: CellResult,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CellResult {
    /// `[ ["col1", "col2"], ... ]` — header + body rows as `Vec<Vec<String>>`,
    /// matching `query::types::QueryResult.rows` (frontend stringifies).
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Option<String>>>,
    pub truncated: bool,
    pub duration_ms: u64,
    pub executed_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Notebook {
    pub id: String,
    pub name: String,
    pub cells: Vec<Cell>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub connection_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_path: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Wire format for the `.ide99nb` file. Version + explicit `kind` give
/// forward compatibility and mismatch detection when importing exports
/// from other tools.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotebookFile {
    pub version: u32,
    pub kind: String, // "notebook"
    pub exported_at: String,
    pub notebook: Notebook,
}

pub const NOTEBOOK_FILE_VERSION: u32 = 1;
pub const NOTEBOOK_FILE_KIND: &str = "notebook";

/// IPC payload for save (id + name + cells JSON blob + opt. connection
/// + opt. `file_path`). A separate type so the frontend does not send
/// redundant `created_at`/`updated_at` — the backend sets those itself.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertNotebookInput {
    pub id: String,
    pub name: String,
    pub cells: Vec<Cell>,
    #[serde(default)]
    pub connection_id: Option<String>,
    #[serde(default)]
    pub file_path: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum NotebookError {
    #[error("storage error: {0}")]
    Storage(String),
    #[error("not found: id {0}")]
    NotFound(String),
    #[error("io error: {0}")]
    Io(String),
    #[error("invalid file: {0}")]
    InvalidFile(String),
    #[error("invalid input: {0}")]
    InvalidInput(String),
}

impl serde::Serialize for NotebookError {
    fn serialize<S: serde::Serializer>(&self, ser: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let (code, message) = match self {
            Self::Storage(m) => ("storage_error", m.clone()),
            Self::NotFound(id) => ("not_found", format!("notebook {id} not found")),
            Self::Io(m) => ("io_error", m.clone()),
            Self::InvalidFile(m) => ("invalid_file", m.clone()),
            Self::InvalidInput(m) => ("invalid_input", m.clone()),
        };
        let mut s = ser.serialize_struct("NotebookError", 2)?;
        s.serialize_field("code", code)?;
        s.serialize_field("message", &message)?;
        s.end()
    }
}
