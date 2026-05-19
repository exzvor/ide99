//! Tauri command handlers for the MCP **client** (Settings UI side).
//!
//! Surfaces:
//! - `mcp_client_list` — current registry snapshot for the Settings panel.
//! - `mcp_client_connect` / `mcp_client_disconnect` — manual control.
//! - `mcp_client_reload` — re-read `~/.config/ide99/mcp-servers.json` from
//! disk, sync registry, optionally re-run auto-start.
//! - `mcp_client_config_path` — for the "Open config file" link.

#![allow(clippy::missing_errors_doc, clippy::needless_pass_by_value)]

use serde::Serialize;

use crate::mcp::client::config::{ExternalServerConfig, McpClientConfig};
use crate::mcp::client::connection::ConnectionStatus;
use crate::mcp::server::McpError;
use crate::AppState;

/// One row in the "External MCP servers" Settings table.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpClientListItem {
    /// Static config (name, transport, displayTarget, autoStart).
    pub config: ExternalServerConfig,
    /// Live status — Disconnected / Connecting / Connected{tools, resources, …} / Error.
    pub status: ConnectionStatus,
}

#[tauri::command]
pub async fn mcp_client_list(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<McpClientListItem>, McpError> {
    let cfg_path =
        crate::app_paths::mcp_servers_config_path().map_err(|e| McpError::Io(e.to_string()))?;
    let cfg = McpClientConfig::load(&cfg_path)?;
    state.mcp_client_registry.sync_from_config(&cfg).await?;

    let snap = state.mcp_client_registry.snapshot().await;
    let summaries: std::collections::HashMap<String, ExternalServerConfig> = cfg
        .to_summaries()
        .into_iter()
        .map(|s| (s.name.clone(), s))
        .collect();

    Ok(snap
        .into_iter()
        .filter_map(|(name, status)| {
            summaries
                .get(&name)
                .cloned()
                .map(|config| McpClientListItem { config, status })
        })
        .collect())
}

#[tauri::command]
pub async fn mcp_client_connect(
    state: tauri::State<'_, AppState>,
    name: String,
) -> Result<(), McpError> {
    let conn = state
        .mcp_client_registry
        .get(&name)
        .await
        .ok_or_else(|| McpError::Internal(format!("unknown server: {name}")))?;
    conn.connect().await
}

#[tauri::command]
pub async fn mcp_client_disconnect(
    state: tauri::State<'_, AppState>,
    name: String,
) -> Result<(), McpError> {
    let conn = state
        .mcp_client_registry
        .get(&name)
        .await
        .ok_or_else(|| McpError::Internal(format!("unknown server: {name}")))?;
    conn.disconnect().await
}

/// Force re-read of `mcp-servers.json` from disk; sync registry; do NOT
/// auto-start (manual reload is initiated by the user, who can connect
/// individual entries themselves).
#[tauri::command]
pub async fn mcp_client_reload(state: tauri::State<'_, AppState>) -> Result<(), McpError> {
    let cfg_path =
        crate::app_paths::mcp_servers_config_path().map_err(|e| McpError::Io(e.to_string()))?;
    let cfg = McpClientConfig::load(&cfg_path)?;
    state.mcp_client_registry.sync_from_config(&cfg).await
}

/// Path of the user-editable config file. Frontend shows it next to
/// "Open in editor" so users can `cat` / hand-edit.
#[tauri::command]
pub async fn mcp_client_config_path(
    _state: tauri::State<'_, AppState>,
) -> Result<String, McpError> {
    let p = crate::app_paths::mcp_servers_config_path().map_err(|e| McpError::Io(e.to_string()))?;
    Ok(p.to_string_lossy().into_owned())
}
