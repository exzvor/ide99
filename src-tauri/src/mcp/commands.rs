//! Tauri command handlers for the MCP server (Settings UI + frontend
//! bridge).
//!
//! In addition to the basic server-management commands, four resolve-
//! flow commands are exposed for the frontend UI:
//! - `mcp_authorize_response`
//! - `mcp_authorize_deny`
//! - `mcp_write_confirm_response`
//! - `mcp_get_audit_log`
//!
//! These cover the user-facing flows: the user clicks Allow/Deny → the
//! frontend invokes the relevant command → the backend resolves the
//! pending oneshot and the MCP server sends the response back to the
//! connected client.

#![allow(    clippy::missing_errors_doc,
    clippy::needless_pass_by_value,
    clippy::significant_drop_tightening,
    clippy::map_unwrap_or,
    clippy::single_match_else,
    clippy::doc_markdown,
    clippy::cast_possible_truncation
)]

use crate::mcp::auth::{AuthorizedClient, McpScope};
use crate::mcp::ide_bridge::IdeBridgeState;
use crate::mcp::server::{McpError, McpServerStatus};
use crate::mcp::store_migration;
use crate::AppState;

#[tauri::command]
pub async fn mcp_get_status(    state: tauri::State<'_, AppState>,
) -> Result<McpServerStatus, McpError> {
    let handle = state.mcp_server.lock().await;
    Ok(handle.status.clone())
}

#[tauri::command]
pub async fn mcp_set_enabled(    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
    enabled: bool,
) -> Result<McpServerStatus, McpError> {
    let mut handle = state.mcp_server.lock().await;
    if enabled {
        if handle.status.enabled {
            return Ok(handle.status.clone());
        }
        let new = crate::mcp::server::start(            state.store.clone(),
            state.pools.clone(),
            state.mcp_bridge.clone(),
            Some(app),
)
        .await?;
        *handle = new;
    } else {
        if !handle.status.enabled {
            return Ok(handle.status.clone());
        }
        crate::mcp::server::stop(&mut handle).await?;
    }
    Ok(handle.status.clone())
}

#[tauri::command]
pub async fn mcp_list_clients(    state: tauri::State<'_, AppState>,
) -> Result<Vec<AuthorizedClient>, McpError> {
    let store = state.store.lock().await;
    store_migration::list_clients(store.conn()).map_err(|e| McpError::Internal(e.to_string()))
}

#[tauri::command]
pub async fn mcp_revoke_client(    state: tauri::State<'_, AppState>,
    client_id: String,
) -> Result<(), McpError> {
    let store = state.store.lock().await;
    crate::mcp::auth::revoke_token(store.conn(), state.keychain.as_ref(), &client_id)
}

/// Config snippet to copy into `~/.claude/mcp_servers.json` or
/// `~/.cursor/mcp.json`. The frontend shows this JSON in
/// Settings → MCP → "Connect Claude Code".
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpConfigSnippet {
    pub claude_code: String,
    pub cursor: String,
}

#[tauri::command]
pub async fn mcp_get_config_snippet(    state: tauri::State<'_, AppState>,
) -> Result<McpConfigSnippet, McpError> {
    let handle = state.mcp_server.lock().await;
    if !handle.status.enabled {
        return Err(McpError::Disabled);
    }
    // Locate ide99-mcp on PATH-or-bundle. In dev we use `cargo run -p ide99
    // --bin ide99-mcp`, in production it's the side-binary next to the app.
    let binary_path = which::which("ide99-mcp")
        .map(|p| p.display().to_string())
        .unwrap_or_else(|_| "ide99-mcp".to_string());

    let claude = serde_json::json!({
        "mcpServers": {
            "ide99": {
                "command": binary_path,
                "args": []
            }
        }
    });
    let cursor = claude.clone();
    Ok(McpConfigSnippet {
        claude_code: serde_json::to_string_pretty(&claude).unwrap_or_default(),
        cursor: serde_json::to_string_pretty(&cursor).unwrap_or_default(),
    })
}

#[tauri::command]
pub async fn mcp_bridge_update(    state: tauri::State<'_, AppState>,
    snapshot: IdeBridgeState,
) -> Result<(), McpError> {
    let mut bridge = state.mcp_bridge.write().await;
    *bridge = snapshot;
    Ok(())
}

// -------- new commands --------

/// Frontend resolves a pending `mcp:authorize-request` event positively.
/// `scopes` is the user-edited subset (e.g. read-only checkbox unchecked
/// `db:write`).
#[tauri::command]
pub async fn mcp_authorize_response(    state: tauri::State<'_, AppState>,
    request_id: String,
    scopes: Vec<McpScope>,
) -> Result<(), McpError> {
    let handle = state.mcp_server.lock().await;
    let ctx = handle.context.as_ref().ok_or(McpError::Disabled)?.clone();
    drop(handle);
    ctx.auth.resolve_authorize(&request_id, scopes).await
}

/// Frontend resolves a pending `mcp:authorize-request` negatively.
#[tauri::command]
pub async fn mcp_authorize_deny(    state: tauri::State<'_, AppState>,
    request_id: String,
) -> Result<(), McpError> {
    let handle = state.mcp_server.lock().await;
    let ctx = handle.context.as_ref().ok_or(McpError::Disabled)?.clone();
    drop(handle);
    ctx.auth.deny_authorize(&request_id).await
}

/// Frontend resolves a pending write-confirmation dialog.
#[tauri::command]
pub async fn mcp_write_confirm_response(    state: tauri::State<'_, AppState>,
    request_id: String,
    allow: bool,
) -> Result<(), McpError> {
    let handle = state.mcp_server.lock().await;
    let ctx = handle.context.as_ref().ok_or(McpError::Disabled)?.clone();
    drop(handle);
    ctx.auth.resolve_write_confirm(&request_id, allow).await
}

/// Read the last `limit` lines of the MCP audit log (newest first).
#[tauri::command]
pub async fn mcp_get_audit_log(    _state: tauri::State<'_, AppState>,
    limit: u32,
) -> Result<Vec<serde_json::Value>, McpError> {
    let dir = crate::app_paths::data_dir().map_err(|e| McpError::Io(e.to_string()))?;
    // `tracing-appender::rolling::daily` writes to `<dir>/mcp-audit.log.<date>`.
    // We read the most-recent file by lexicographic sort.
    let mut entries = tokio::fs::read_dir(&dir).await.map_err(McpError::from)?;
    let mut audit_files = Vec::new();
    while let Some(entry) = entries.next_entry().await.map_err(McpError::from)? {
        let name = entry.file_name();
        let s = name.to_string_lossy();
        if s.starts_with("mcp-audit.log") {
            audit_files.push(entry.path());
        }
    }
    audit_files.sort();
    audit_files.reverse();
    let limit = limit as usize;
    let mut out: Vec<serde_json::Value> = Vec::new();
    for f in audit_files {
        let Ok(content) = tokio::fs::read_to_string(&f).await else {
            continue;
        };
        for line in content.lines().rev() {
            if line.trim().is_empty() {
                continue;
            }
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
                out.push(v);
                if out.len() >= limit {
                    return Ok(out);
                }
            }
        }
    }
    Ok(out)
}
