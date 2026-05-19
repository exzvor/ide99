//! Tauri command surface for `.ide99` export / import / preview.
//!
//! Per-kind contract: each kind has `ide99_export_<kind>` (writes envelope to
//! a path) + `ide99_apply_<kind>` (parses payload + lands the rows / files
//! into the target storage). The frontend dispatches `ide99_apply_<kind>`
//! based on the previewed `ShareKind`.

#![allow(clippy::missing_errors_doc, clippy::missing_panics_doc)]

use std::fs;
use std::path::{Path, PathBuf};

use tauri::State;

use crate::file_sharing::envelope;
use crate::file_sharing::kinds::{
    connection, erd_layout, health_config, keymap, migration_set, notebook, query, snippet, theme,
};
use crate::file_sharing::types::{ImportPreview, ShareEnvelope, ShareError, ShareKind};
use crate::AppState;

// ---------------------------------------------------------------------------
// Export commands — read source storage, encode envelope, write file.
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn ide99_export_connection(
    state: State<'_, AppState>,
    connection_id: String,
    path: String,
) -> Result<(), ShareError> {
    state.ide99_export_connection(&connection_id, &path).await
}

#[tauri::command]
pub async fn ide99_export_connection_bundle(
    state: State<'_, AppState>,
    name: String,
    connection_ids: Vec<String>,
    path: String,
) -> Result<(), ShareError> {
    state
        .ide99_export_connection_bundle(&name, &connection_ids, &path)
        .await
}

#[tauri::command]
pub async fn ide99_export_snippet(
    state: State<'_, AppState>,
    snippet_id: i64,
    path: String,
) -> Result<(), ShareError> {
    state.ide99_export_snippet(snippet_id, &path).await
}

#[tauri::command]
pub async fn ide99_export_snippet_bundle(
    state: State<'_, AppState>,
    name: String,
    snippet_ids: Vec<i64>,
    path: String,
) -> Result<(), ShareError> {
    state
        .ide99_export_snippet_bundle(&name, &snippet_ids, &path)
        .await
}

#[tauri::command]
pub async fn ide99_export_query(
    state: State<'_, AppState>,
    tab_id: String,
    path: String,
) -> Result<(), ShareError> {
    state.ide99_export_query(&tab_id, &path).await
}

#[tauri::command]
pub async fn ide99_export_notebook(
    state: State<'_, AppState>,
    notebook_id: String,
    path: String,
) -> Result<(), ShareError> {
    state.ide99_export_notebook(&notebook_id, &path).await
}

#[tauri::command]
pub async fn ide99_export_migration_set(
    label: String,
    src_dir: String,
    path: String,
) -> Result<(), ShareError> {
    let payload = migration_set::to_payload(&label, Path::new(&src_dir))?;
    let raw = envelope::encode(ShareKind::MigrationSet, payload)?;
    fs::write(PathBuf::from(&path), raw).map_err(|e| ShareError::Io(e.to_string()))
}

#[tauri::command]
pub async fn ide99_export_erd_layout(
    label: String,
    schemas_key: String,
    positions: Vec<crate::schema::positions::NodePos>,
    path: String,
) -> Result<(), ShareError> {
    let payload = erd_layout::to_payload(&label, &schemas_key, &positions)?;
    let raw = envelope::encode(ShareKind::ErdLayout, payload)?;
    fs::write(PathBuf::from(&path), raw).map_err(|e| ShareError::Io(e.to_string()))
}

#[tauri::command]
pub async fn ide99_export_theme(
    name: String,
    tokens: serde_json::Value,
    path: String,
) -> Result<(), ShareError> {
    let payload = theme::to_payload(&name, &tokens)?;
    let raw = envelope::encode(ShareKind::Theme, payload)?;
    fs::write(PathBuf::from(&path), raw).map_err(|e| ShareError::Io(e.to_string()))
}

#[tauri::command]
pub async fn ide99_export_keymap(
    name: String,
    bindings: Vec<serde_json::Value>,
    path: String,
) -> Result<(), ShareError> {
    let payload = keymap::to_payload(&name, &bindings)?;
    let raw = envelope::encode(ShareKind::Keymap, payload)?;
    fs::write(PathBuf::from(&path), raw).map_err(|e| ShareError::Io(e.to_string()))
}

#[tauri::command]
pub async fn ide99_export_health_config(
    label: String,
    checks: serde_json::Value,
    path: String,
) -> Result<(), ShareError> {
    let payload = health_config::to_payload(&label, &checks)?;
    let raw = envelope::encode(ShareKind::HealthConfig, payload)?;
    fs::write(PathBuf::from(&path), raw).map_err(|e| ShareError::Io(e.to_string()))
}

// ---------------------------------------------------------------------------
// Preview + apply commands.
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn ide99_preview_file(path: String) -> Result<ImportPreview, ShareError> {
    let raw =
        fs::read_to_string(PathBuf::from(&path)).map_err(|e| ShareError::Io(e.to_string()))?;
    let env = envelope::decode(&raw)?;
    envelope::preview(&env)
}

#[tauri::command]
pub async fn ide99_import_file(
    state: State<'_, AppState>,
    path: String,
) -> Result<ShareEnvelope, ShareError> {
    state.ide99_import_file(&path).await
}

#[tauri::command]
pub async fn ide99_apply_snippet(
    state: State<'_, AppState>,
    payload: serde_json::Value,
) -> Result<u32, ShareError> {
    let store = state.store.lock().await;
    let res = snippet::apply_single(store.conn(), &payload).map(|_| 1u32);
    drop(store);
    res
}

#[tauri::command]
pub async fn ide99_apply_snippet_bundle(
    state: State<'_, AppState>,
    payload: serde_json::Value,
) -> Result<u32, ShareError> {
    let store = state.store.lock().await;
    let n = snippet::apply_bundle(store.conn(), &payload)?;
    drop(store);
    Ok(u32::try_from(n).unwrap_or(u32::MAX))
}

#[tauri::command]
pub async fn ide99_apply_query(
    state: State<'_, AppState>,
    payload: serde_json::Value,
) -> Result<String, ShareError> {
    let store = state.store.lock().await;
    let row = query::apply(store.conn(), &payload)?;
    drop(store);
    Ok(row.id)
}

#[tauri::command]
pub async fn ide99_apply_notebook(
    state: State<'_, AppState>,
    payload: serde_json::Value,
) -> Result<String, ShareError> {
    let store = state.store.lock().await;
    let nb = notebook::apply(store.conn(), &payload)?;
    drop(store);
    Ok(nb.id)
}

#[tauri::command]
pub async fn ide99_apply_migration_set(
    payload: serde_json::Value,
    dest_dir: String,
) -> Result<u32, ShareError> {
    let n = migration_set::apply(&payload, Path::new(&dest_dir))?;
    Ok(u32::try_from(n).unwrap_or(u32::MAX))
}

/// Apply commands for the FE-owned kinds (erd-layout / theme / keymap /
/// health-config) just return the parsed payload — the frontend store does
/// the actual write into its own state.
#[tauri::command]
pub async fn ide99_apply_erd_layout(
    payload: serde_json::Value,
) -> Result<erd_layout::ExportedErdLayout, ShareError> {
    erd_layout::from_payload(&payload)
}

#[tauri::command]
pub async fn ide99_apply_theme(
    payload: serde_json::Value,
) -> Result<theme::ExportedTheme, ShareError> {
    theme::from_payload(&payload)
}

#[tauri::command]
pub async fn ide99_apply_keymap(
    payload: serde_json::Value,
) -> Result<keymap::ExportedKeymap, ShareError> {
    keymap::from_payload(&payload)
}

#[tauri::command]
pub async fn ide99_apply_health_config(
    payload: serde_json::Value,
) -> Result<health_config::ExportedHealthConfig, ShareError> {
    health_config::from_payload(&payload)
}

// ---------------------------------------------------------------------------
// AppState helpers — keep IO + lock-handling out of the #[tauri::command] bodies
// so integration tests can call the same code without spinning up the runtime.
// ---------------------------------------------------------------------------

impl AppState {
    pub async fn ide99_export_connection(
        &self,
        connection_id: &str,
        path: &str,
    ) -> Result<(), ShareError> {
        let conn = {
            let store = self.store.lock().await;
            store
                .get_by_id(connection_id)
                .map_err(|e| ShareError::Storage(e.to_string()))?
        };
        let payload = connection::to_single_payload(&conn)?;
        let raw = envelope::encode(ShareKind::Connection, payload)?;
        fs::write(PathBuf::from(path), raw).map_err(|e| ShareError::Io(e.to_string()))
    }

    pub async fn ide99_export_connection_bundle(
        &self,
        name: &str,
        connection_ids: &[String],
        path: &str,
    ) -> Result<(), ShareError> {
        let store = self.store.lock().await;
        let mut conns = Vec::with_capacity(connection_ids.len());
        for id in connection_ids {
            let c = store
                .get_by_id(id)
                .map_err(|e| ShareError::Storage(e.to_string()))?;
            conns.push(c);
        }
        drop(store);
        let payload = connection::to_bundle_payload(name, &conns)?;
        let raw = envelope::encode(ShareKind::ConnectionBundle, payload)?;
        fs::write(PathBuf::from(path), raw).map_err(|e| ShareError::Io(e.to_string()))
    }

    pub async fn ide99_export_snippet(
        &self,
        snippet_id: i64,
        path: &str,
    ) -> Result<(), ShareError> {
        let snip = {
            let store = self.store.lock().await;
            crate::snippets::store::SnippetStore::new(store.conn())
                .get(snippet_id)
                .map_err(|e| ShareError::Storage(e.to_string()))?
        };
        let payload = snippet::to_single_payload(&snip)?;
        let raw = envelope::encode(ShareKind::Snippet, payload)?;
        fs::write(PathBuf::from(path), raw).map_err(|e| ShareError::Io(e.to_string()))
    }

    pub async fn ide99_export_snippet_bundle(
        &self,
        name: &str,
        snippet_ids: &[i64],
        path: &str,
    ) -> Result<(), ShareError> {
        let store = self.store.lock().await;
        let s = crate::snippets::store::SnippetStore::new(store.conn());
        let mut snippets = Vec::with_capacity(snippet_ids.len());
        for id in snippet_ids {
            snippets.push(s.get(*id).map_err(|e| ShareError::Storage(e.to_string()))?);
        }
        drop(store);
        let payload = snippet::to_bundle_payload(name, &snippets)?;
        let raw = envelope::encode(ShareKind::SnippetBundle, payload)?;
        fs::write(PathBuf::from(path), raw).map_err(|e| ShareError::Io(e.to_string()))
    }

    pub async fn ide99_export_query(&self, tab_id: &str, path: &str) -> Result<(), ShareError> {
        let row = {
            let store = self.store.lock().await;
            crate::query::tabs::list(store.conn())
                .map_err(|e| ShareError::Storage(e.to_string()))?
                .into_iter()
                .find(|t| t.id == tab_id)
                .ok_or_else(|| ShareError::Storage(format!("tab {tab_id} not found")))?
        };
        let payload = query::to_payload(&row)?;
        let raw = envelope::encode(ShareKind::Query, payload)?;
        fs::write(PathBuf::from(path), raw).map_err(|e| ShareError::Io(e.to_string()))
    }

    pub async fn ide99_export_notebook(
        &self,
        notebook_id: &str,
        path: &str,
    ) -> Result<(), ShareError> {
        let nb = {
            let store = self.store.lock().await;
            crate::notebook::store::get(store.conn(), notebook_id)
                .map_err(|e| ShareError::Storage(e.to_string()))?
                .ok_or_else(|| ShareError::Storage(format!("notebook {notebook_id} not found")))?
        };
        let payload = notebook::to_payload(&nb)?;
        let raw = envelope::encode(ShareKind::Notebook, payload)?;
        fs::write(PathBuf::from(path), raw).map_err(|e| ShareError::Io(e.to_string()))
    }

    /// Returns the parsed envelope. Per-kind side effects are applied via the
    /// dedicated `ide99_apply_<kind>` commands.
    ///
    /// Kept `async` so the surrounding `#[tauri::command]` adapter on
    /// `ide99_import_file` can `.await` it uniformly with the other
    /// `AppState` helpers; the body itself is sync.
    #[allow(clippy::unused_async)]
    pub async fn ide99_import_file(&self, path: &str) -> Result<ShareEnvelope, ShareError> {
        let raw =
            fs::read_to_string(PathBuf::from(path)).map_err(|e| ShareError::Io(e.to_string()))?;
        envelope::decode(&raw)
    }
}
