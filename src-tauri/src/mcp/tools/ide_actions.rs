//! IDE-action tools — drive the IDE by emitting Tauri events.
//!
//! Each action emits the Tauri event `mcp:action`, which React hooks
//! listen for and apply to Monaco / Object Editor / tab switching.
//!
//! All tools are fire-and-forget: they return `{ accepted: true }`
//! immediately.
//!
//! ## Tools
//! | Name | Effect |
//! |---|---|
//! | `open_query_in_editor` | inject SQL into the active Monaco tab |
//! | `run_in_editor` | inject + execute |
//! | `open_table` | open Object Editor for a table |
//! | `open_explain_for` | open the EXPLAIN visualizer |
//! | `navigate_to` | scroll the tree, focus a node |

#![allow(clippy::missing_errors_doc, clippy::doc_markdown)]

use serde_json::{json, Value};
use tauri::Emitter;

use crate::mcp::auth::AuthorizedClient;
use crate::mcp::server::{McpError, ServerContext};

const EVENT_NAME: &str = "mcp:action";

fn arg_str(args: &Value, key: &str) -> Result<String, McpError> {
    args.get(key)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| McpError::InvalidArgs(format!("missing field '{key}'")))
}

fn arg_str_opt(args: &Value, key: &str) -> Option<String> {
    args.get(key).and_then(Value::as_str).map(str::to_owned)
}

fn arg_bool(args: &Value, key: &str, default: bool) -> bool {
    args.get(key).and_then(Value::as_bool).unwrap_or(default)
}

fn emit(ctx: &ServerContext, payload: Value) -> Result<(), McpError> {
    if let Some(app) = &ctx.app_handle {
        app.emit(EVENT_NAME, payload)
            .map_err(|e| McpError::Internal(format!("emit: {e}")))?;
    }
    // No app_handle (test / headless mode) — silently accept. Returning Ok
    // keeps tests deterministic; production always carries app_handle.
    Ok(())
}

pub async fn open_query_in_editor_tool(    ctx: &ServerContext,
    _client: &AuthorizedClient,
    args: Value,
) -> Result<Value, McpError> {
    let sql = arg_str(&args, "sql")?;
    let focus = arg_bool(&args, "focusEditor", true);
    emit(        ctx,
        json!({ "kind": "open-query", "sql": sql, "focusEditor": focus }),
)?;
    Ok(json!({ "accepted": true }))
}

pub async fn run_in_editor_tool(    ctx: &ServerContext,
    _client: &AuthorizedClient,
    args: Value,
) -> Result<Value, McpError> {
    let sql = arg_str(&args, "sql")?;
    emit(ctx, json!({ "kind": "run-query", "sql": sql }))?;
    Ok(json!({ "accepted": true }))
}

pub async fn open_table_tool(    ctx: &ServerContext,
    _client: &AuthorizedClient,
    args: Value,
) -> Result<Value, McpError> {
    let conn_id = arg_str(&args, "connId")?;
    let schema = arg_str(&args, "schema")?;
    let table = arg_str(&args, "table")?;
    emit(        ctx,
        json!({
            "kind": "open-table",
            "connId": conn_id,
            "schema": schema,
            "table": table,
        }),
)?;
    Ok(json!({ "accepted": true }))
}

pub async fn open_explain_for_tool(    ctx: &ServerContext,
    _client: &AuthorizedClient,
    args: Value,
) -> Result<Value, McpError> {
    let conn_id = arg_str(&args, "connId")?;
    let sql = arg_str(&args, "sql")?;
    emit(        ctx,
        json!({
            "kind": "open-explain",
            "connId": conn_id,
            "sql": sql,
        }),
)?;
    Ok(json!({ "accepted": true }))
}

pub async fn navigate_to_tool(    ctx: &ServerContext,
    _client: &AuthorizedClient,
    args: Value,
) -> Result<Value, McpError> {
    let conn_id = arg_str(&args, "connId")?;
    let schema = arg_str(&args, "schema")?;
    let table = arg_str_opt(&args, "table");
    emit(        ctx,
        json!({
            "kind": "navigate-tree",
            "connId": conn_id,
            "schema": schema,
            "table": table,
        }),
)?;
    Ok(json!({ "accepted": true }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::auth::McpScope;
    use crate::mcp::ide_bridge::IdeBridgeState;
    use crate::mcp::server::{AuditLog, ServerContext, ToolRegistry};
    use std::sync::Arc;
    use tokio::sync::{Mutex, RwLock};

    fn dummy_client() -> AuthorizedClient {
        AuthorizedClient {
            id: "c".into(),
            name: "Test".into(),
            scopes: vec![McpScope::IdeWrite],
            created_at: String::new(),
            last_used_at: None,
        }
    }

    fn test_ctx() -> ServerContext {
        let mut store = crate::connection::Store::open_in_memory().unwrap();
        store.run_migrations().unwrap();
        let store = Arc::new(Mutex::new(store));
        let pools = Arc::new(crate::connection::PoolRegistry::new());
        let bridge = Arc::new(RwLock::new(IdeBridgeState::default()));
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
    async fn open_query_returns_accepted() {
        let ctx = test_ctx();
        let v = open_query_in_editor_tool(&ctx, &dummy_client(), json!({ "sql": "SELECT 1" }))
            .await
            .unwrap();
        assert_eq!(v["accepted"], json!(true));
    }

    #[tokio::test]
    async fn missing_sql_is_invalid_args() {
        let ctx = test_ctx();
        let err = open_query_in_editor_tool(&ctx, &dummy_client(), json!({}))
            .await
            .unwrap_err();
        assert!(matches!(err, McpError::InvalidArgs(_)));
    }

    #[tokio::test]
    async fn run_in_editor_returns_accepted() {
        let ctx = test_ctx();
        let v = run_in_editor_tool(&ctx, &dummy_client(), json!({ "sql": "SELECT 1" }))
            .await
            .unwrap();
        assert_eq!(v["accepted"], json!(true));
    }

    #[tokio::test]
    async fn open_table_validates_args() {
        let ctx = test_ctx();
        let v = open_table_tool(            &ctx,
            &dummy_client(),
            json!({ "connId": "c", "schema": "public", "table": "users" }),
)
        .await
        .unwrap();
        assert_eq!(v["accepted"], json!(true));
        let err = open_table_tool(&ctx, &dummy_client(), json!({ "schema": "public" }))
            .await
            .unwrap_err();
        assert!(matches!(err, McpError::InvalidArgs(_)));
    }

    #[tokio::test]
    async fn navigate_to_accepts_optional_table() {
        let ctx = test_ctx();
        let v = navigate_to_tool(            &ctx,
            &dummy_client(),
            json!({ "connId": "c", "schema": "public" }),
)
        .await
        .unwrap();
        assert_eq!(v["accepted"], json!(true));
    }
}
