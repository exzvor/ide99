//! Tauri command handlers for notebook persistence + file I/O.
//!
//! Pattern mirrors `query::commands` / `snippets::commands`: thin
//! wrappers over `AppState` inherent helpers so unit tests can exercise
//! the same code paths.

#![allow(clippy::missing_errors_doc, clippy::missing_panics_doc)]

use std::path::PathBuf;

use tauri::State;

use crate::notebook::cte::{compose, ComposedSql};
use crate::notebook::file_io;
use crate::notebook::markdown;
use crate::notebook::store;
use crate::notebook::types::{Cell, Notebook, NotebookError, UpsertNotebookInput};
use crate::AppState;

#[tauri::command]
pub async fn notebook_list(state: State<'_, AppState>) -> Result<Vec<Notebook>, NotebookError> {
    state.notebook_list().await
}

#[tauri::command]
pub async fn notebook_get(    state: State<'_, AppState>,
    id: String,
) -> Result<Option<Notebook>, NotebookError> {
    state.notebook_get(&id).await
}

#[tauri::command]
pub async fn notebook_save(    state: State<'_, AppState>,
    input: UpsertNotebookInput,
) -> Result<Notebook, NotebookError> {
    state.notebook_save(input).await
}

#[tauri::command]
pub async fn notebook_delete(state: State<'_, AppState>, id: String) -> Result<(), NotebookError> {
    state.notebook_delete(&id).await
}

#[tauri::command]
pub async fn notebook_export_file(notebook: Notebook, path: String) -> Result<(), NotebookError> {
    file_io::write_to_path(&PathBuf::from(path), &notebook)
}

/// Export without inline-result snapshots (for sharing a "clean"
/// notebook: tutorials, code review).
#[tauri::command]
pub async fn notebook_export_file_minimal(    notebook: Notebook,
    path: String,
) -> Result<(), NotebookError> {
    file_io::write_minimal_to_path(&PathBuf::from(path), &notebook)
}

#[tauri::command]
pub async fn notebook_import_file(path: String) -> Result<Notebook, NotebookError> {
    file_io::read_from_path(&PathBuf::from(path))
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub fn notebook_compose_sql(    cells: Vec<Cell>,
    target_idx: usize,
) -> Result<ComposedSql, NotebookError> {
    compose(&cells, target_idx).map_err(NotebookError::InvalidInput)
}

/// Render a Markdown cell with `{{ ... }}` placeholders substituted
/// from inline-result snapshots of preceding SQL cells. Markdown→HTML
/// rendering stays on the frontend.
#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub fn notebook_render_markdown(    cells: Vec<Cell>,
    target_idx: usize,
) -> Result<String, NotebookError> {
    markdown::render_markdown(&cells, target_idx)
}

/// Total notebook count (gate for the "Recent notebooks" banner).
#[tauri::command]
pub async fn notebook_count(state: State<'_, AppState>) -> Result<usize, NotebookError> {
    state.notebook_count().await
}

impl AppState {
    pub async fn notebook_list(&self) -> Result<Vec<Notebook>, NotebookError> {
        let store = self.store.lock().await;
        store::list(store.conn())
    }

    pub async fn notebook_get(&self, id: &str) -> Result<Option<Notebook>, NotebookError> {
        let store = self.store.lock().await;
        store::get(store.conn(), id)
    }

    pub async fn notebook_save(        &self,
        input: UpsertNotebookInput,
) -> Result<Notebook, NotebookError> {
        let store = self.store.lock().await;
        store::upsert(store.conn(), &input)
    }

    pub async fn notebook_delete(&self, id: &str) -> Result<(), NotebookError> {
        let store = self.store.lock().await;
        store::delete(store.conn(), id)
    }

    pub async fn notebook_count(&self) -> Result<usize, NotebookError> {
        let store = self.store.lock().await;
        store::count(store.conn())
    }
}

// Serde compatibility for ComposedSql going across the IPC bridge.
impl serde::Serialize for ComposedSql {
    fn serialize<S: serde::Serializer>(&self, ser: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut s = ser.serialize_struct("ComposedSql", 3)?;
        s.serialize_field("sql", &self.sql)?;
        s.serialize_field("importedNames", &self.imported_names)?;
        s.serialize_field("unresolvedNames", &self.unresolved_names)?;
        s.end()
    }
}
