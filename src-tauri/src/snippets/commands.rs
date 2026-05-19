//! Tauri commands for the snippet manager.
//!
//! Pattern mirrors connection::commands — pulls the SQLite handle from
//! AppState.store, runs the SnippetStore call, returns DTO. JSON
//! export/import use serde_json on the SnippetExportBundle struct, with
//! file IO done backend-side (frontend hands us the path picked by the
//! @tauri-apps/plugin-dialog API).

#![allow(unused, clippy::pedantic, clippy::nursery, clippy::unused_async)]

use std::path::PathBuf;

use chrono::Utc;
use tauri::State;

use crate::snippets::store::SnippetStore;
use crate::snippets::types::{
    NewUserSnippet, SnippetError, SnippetExportBundle, UpdateUserSnippet, UserSnippet,
};
use crate::AppState;

#[tauri::command]
pub async fn snippets_list(state: State<'_, AppState>) -> Result<Vec<UserSnippet>, SnippetError> {
    let guard = state.store.lock().await;
    SnippetStore::new(guard.conn()).list()
}

#[tauri::command]
pub async fn snippets_create(    state: State<'_, AppState>,
    input: NewUserSnippet,
) -> Result<UserSnippet, SnippetError> {
    let guard = state.store.lock().await;
    SnippetStore::new(guard.conn()).create(&input)
}

#[tauri::command]
pub async fn snippets_update(    state: State<'_, AppState>,
    id: i64,
    input: UpdateUserSnippet,
) -> Result<UserSnippet, SnippetError> {
    let guard = state.store.lock().await;
    SnippetStore::new(guard.conn()).update(id, &input)
}

#[tauri::command]
pub async fn snippets_delete(state: State<'_, AppState>, id: i64) -> Result<(), SnippetError> {
    let guard = state.store.lock().await;
    SnippetStore::new(guard.conn()).delete(id)
}

#[tauri::command]
pub async fn snippets_export(    state: State<'_, AppState>,
    path: String,
) -> Result<SnippetExportBundle, SnippetError> {
    let bundle = {
        let guard = state.store.lock().await;
        let snippets = SnippetStore::new(guard.conn()).list()?;
        SnippetExportBundle {
            version: 1,
            kind: "snippets".to_string(),
            exported_at: Utc::now().to_rfc3339(),
            snippets,
        }
    };
    let json =
        serde_json::to_string_pretty(&bundle).map_err(|e| SnippetError::Io(e.to_string()))?;
    std::fs::write(PathBuf::from(&path), json).map_err(|e| SnippetError::Io(e.to_string()))?;
    Ok(bundle)
}

#[tauri::command]
pub async fn snippets_import(    state: State<'_, AppState>,
    path: String,
) -> Result<Vec<UserSnippet>, SnippetError> {
    let text = std::fs::read_to_string(PathBuf::from(&path))
        .map_err(|e| SnippetError::Io(e.to_string()))?;
    let bundle: SnippetExportBundle =
        serde_json::from_str(&text).map_err(|e| SnippetError::InvalidBundle(e.to_string()))?;
    if bundle.kind != "snippets" {
        return Err(SnippetError::InvalidBundle(format!(            "expected kind='snippets', got '{}'",
            bundle.kind
)));
    }
    if bundle.version != 1 {
        return Err(SnippetError::InvalidBundle(format!(            "unsupported bundle version {}",
            bundle.version
)));
    }
    let guard = state.store.lock().await;
    let store = SnippetStore::new(guard.conn());
    let mut imported = Vec::new();
    for snip in &bundle.snippets {
        let new = NewUserSnippet {
            label: snip.label.clone(),
            prefix: snip.prefix.clone(),
            body: snip.body.clone(),
            documentation: snip.documentation.clone(),
        };
        imported.push(store.create(&new)?);
    }
    Ok(imported)
}
