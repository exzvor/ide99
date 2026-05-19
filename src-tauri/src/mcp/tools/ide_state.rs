//! IDE-state tools — read-only mirror of [`crate::mcp::ide_bridge::IdeBridgeState`].
//!
//! This is the part that sets the ide99 MCP server apart from a psql
//! wrapper: the external agent sees the active connection, current
//! editor, selection, last result, and open tabs.
//!
//! ## Tools
//! | Name | Returns |
//! |---|---|
//! | `get_active_connection` | { active, id, name, host, port, database, environment } |
//! | `get_current_query` | { content } |
//! | `get_selected_text` | { text } |
//! | `get_last_result` | columns + rows + truncated |
//! | `get_open_tabs` | open_tabs (as an array) |

#![allow(clippy::missing_errors_doc, clippy::doc_markdown)]

use serde_json::{json, Value};

use crate::mcp::auth::AuthorizedClient;
use crate::mcp::server::{McpError, ServerContext};

const DEFAULT_MAX_ROWS: u64 = 1000;

pub async fn get_active_connection_tool(    ctx: &ServerContext,
    _client: &AuthorizedClient,
    _args: Value,
) -> Result<Value, McpError> {
    let bridge = ctx.bridge.read().await;
    let Some(conn_id) = bridge.active_conn_id.clone() else {
        return Ok(json!({ "active": false }));
    };
    drop(bridge);

    let store = ctx.store.lock().await;
    let conn = store
        .get_by_id(&conn_id)
        .map_err(|e| McpError::Internal(format!("store get_by_id: {e}")))?;
    drop(store);

    Ok(json!({
        "active": true,
        "id": conn.id,
        "name": conn.name,
        "host": conn.host,
        "port": conn.port,
        "database": conn.database,
        "environment": conn.environment.as_str(),
    }))
}

pub async fn get_current_query_tool(    ctx: &ServerContext,
    _client: &AuthorizedClient,
    _args: Value,
) -> Result<Value, McpError> {
    let bridge = ctx.bridge.read().await;
    Ok(json!({ "content": bridge.editor_content }))
}

pub async fn get_selected_text_tool(    ctx: &ServerContext,
    _client: &AuthorizedClient,
    _args: Value,
) -> Result<Value, McpError> {
    let bridge = ctx.bridge.read().await;
    let text = bridge.editor_selection.map_or_else(String::new, |(s, e)| {
        let chars: Vec<char> = bridge.editor_content.chars().collect();
        let len = chars.len();
        let start = s.min(len);
        let end = e.min(len);
        if start >= end {
            String::new()
        } else {
            chars[start..end].iter().collect()
        }
    });
    Ok(json!({ "text": text }))
}

pub async fn get_last_result_tool(    ctx: &ServerContext,
    _client: &AuthorizedClient,
    args: Value,
) -> Result<Value, McpError> {
    let max_rows = args
        .get("maxRows")
        .and_then(Value::as_u64)
        .unwrap_or(DEFAULT_MAX_ROWS) as usize;

    let bridge = ctx.bridge.read().await;
    let Some(snap) = bridge.last_result.clone() else {
        return Ok(json!({
            "columns": [],
            "rows": [],
            "truncated": false,
        }));
    };

    let truncated = snap.truncated || snap.rows.len() > max_rows;
    let rows: Vec<_> = snap.rows.into_iter().take(max_rows).collect();
    Ok(json!({
        "columns": snap.columns,
        "rows": rows,
        "truncated": truncated,
    }))
}

pub async fn get_open_tabs_tool(    ctx: &ServerContext,
    _client: &AuthorizedClient,
    _args: Value,
) -> Result<Value, McpError> {
    let bridge = ctx.bridge.read().await;
    Ok(json!({ "tabs": bridge.open_tabs }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::auth::McpScope;
    use crate::mcp::ide_bridge::{
        ExecutedQuery, IdeBridgeState, ResultSnapshot, TabKind, TabSnapshot,
    };
    use crate::mcp::server::{AuditLog, ServerContext, ToolRegistry};
    use std::sync::Arc;
    use tokio::sync::{Mutex, RwLock};

    fn dummy_client() -> AuthorizedClient {
        AuthorizedClient {
            id: "c".into(),
            name: "Test".into(),
            scopes: vec![McpScope::IdeRead],
            created_at: String::new(),
            last_used_at: None,
        }
    }

    fn ctx_with_bridge(bridge: IdeBridgeState) -> ServerContext {
        let mut store = crate::connection::Store::open_in_memory().unwrap();
        store.run_migrations().unwrap();
        let store = Arc::new(Mutex::new(store));
        let pools = Arc::new(crate::connection::PoolRegistry::new());
        let bridge = Arc::new(RwLock::new(bridge));
        let auth = crate::mcp::auth::AuthState::new();
        let registry = Arc::new(ToolRegistry::new());
        let tmp = tempfile::tempdir().unwrap();
        let audit = Arc::new(AuditLog::open(tmp.path()));
        ServerContext {
            store,
            pools,
            bridge,
            auth,
            registry,
            audit,
            app_handle: None,
        }
    }

    #[tokio::test]
    async fn get_current_query_echoes_editor_content() {
        let mut b = IdeBridgeState::default();
        b.editor_content = "SELECT 1".into();
        let ctx = ctx_with_bridge(b);
        let v = get_current_query_tool(&ctx, &dummy_client(), json!({}))
            .await
            .unwrap();
        assert_eq!(v["content"], json!("SELECT 1"));
    }

    #[tokio::test]
    async fn get_selected_text_returns_substring() {
        let mut b = IdeBridgeState::default();
        b.editor_content = "SELECT 1, 2, 3".into();
        b.editor_selection = Some((7, 8)); // "1"
        let ctx = ctx_with_bridge(b);
        let v = get_selected_text_tool(&ctx, &dummy_client(), json!({}))
            .await
            .unwrap();
        assert_eq!(v["text"], json!("1"));
    }

    #[tokio::test]
    async fn get_selected_text_empty_when_no_selection() {
        let b = IdeBridgeState::default();
        let ctx = ctx_with_bridge(b);
        let v = get_selected_text_tool(&ctx, &dummy_client(), json!({}))
            .await
            .unwrap();
        assert_eq!(v["text"], json!(""));
    }

    #[tokio::test]
    async fn get_active_connection_inactive_when_none() {
        let ctx = ctx_with_bridge(IdeBridgeState::default());
        let v = get_active_connection_tool(&ctx, &dummy_client(), json!({}))
            .await
            .unwrap();
        assert_eq!(v["active"], json!(false));
    }

    #[tokio::test]
    async fn get_last_result_truncates_to_max_rows() {
        let mut b = IdeBridgeState::default();
        b.last_result = Some(ResultSnapshot {
            columns: vec!["id".into()],
            rows: (0..5).map(|i| vec![serde_json::Value::from(i)]).collect(),
            truncated: false,
        });
        b.last_query = Some(ExecutedQuery {
            sql: "SELECT id FROM t".into(),
            conn_id: "c".into(),
            started_at: "now".into(),
            duration_ms: 1,
            row_count: Some(5),
            error: None,
        });
        let ctx = ctx_with_bridge(b);
        let v = get_last_result_tool(&ctx, &dummy_client(), json!({ "maxRows": 2 }))
            .await
            .unwrap();
        assert_eq!(v["rows"].as_array().unwrap().len(), 2);
        assert_eq!(v["truncated"], json!(true));
    }

    #[tokio::test]
    async fn get_open_tabs_echoes_bridge() {
        let mut b = IdeBridgeState::default();
        b.open_tabs.push(TabSnapshot {
            id: "t1".into(),
            title: "tab1".into(),
            conn_id: None,
            kind: TabKind::Query,
        });
        let ctx = ctx_with_bridge(b);
        let v = get_open_tabs_tool(&ctx, &dummy_client(), json!({}))
            .await
            .unwrap();
        assert_eq!(v["tabs"].as_array().unwrap().len(), 1);
    }
}
