//! MCP Resources — ambient context available to the agent without an
//! explicit tool call.
//!
//! Registered:
//! - `ide99://schema/{conn_id}` — JSON snapshot of the connection schema.
//! - `ide99://active-context` — active connection + `dbName` +
//!   `pgVersion` + `searchPath`.
//!
//! Public API used by `server.rs::handle_method`:
//! - [`list_resources`] — for `resources/list`.
//! - [`read_resource`] — for `resources/read`.

#![allow(
    clippy::missing_errors_doc,
    clippy::doc_markdown,
    clippy::module_name_repetitions
)]

use serde::Serialize;
use serde_json::{json, Value};

use crate::mcp::server::{McpError, ServerContext};

/// Lightweight metadata for `resources/list`. Shape follows MCP spec —
/// `name`, `uri`, `mimeType` are the only required fields.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceMeta {
    pub uri: String,
    pub name: String,
    pub mime_type: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

const SCHEMA_URI_PREFIX: &str = "ide99://schema/";
const ACTIVE_CONTEXT_URI: &str = "ide99://active-context";

/// Build the static resource list. The schema resource is registered with a
/// placeholder URI (`ide99://schema/<active>`) — callers that want a specific
/// connection invoke `read_resource` with the explicit URI directly.
#[must_use]
pub fn list_resources(_ctx: &ServerContext) -> Vec<ResourceMeta> {
    vec![
        ResourceMeta {
            uri: ACTIVE_CONTEXT_URI.to_string(),
            name: "Active context".to_string(),
            mime_type: "application/json",
            description: Some(                "Current active connection, database name, PG version, search_path".into(),
),
        },
        ResourceMeta {
            uri: format!("{SCHEMA_URI_PREFIX}<conn_id>"),
            name: "Schema snapshot".to_string(),
            mime_type: "application/json",
            description: Some(                "Full autocomplete-style schema dump for a connection. Replace <conn_id> with a real id from list_connections.".into(),
),
        },
    ]
}

/// Read a resource by URI. Two URI shapes are accepted:
/// - `ide99://active-context` — current active connection metadata.
/// - `ide99://schema/{conn_id}` — schema snapshot for a specific connection.
pub async fn read_resource(ctx: &ServerContext, uri: &str) -> Result<Value, McpError> {
    if uri == ACTIVE_CONTEXT_URI {
        return read_active_context(ctx).await;
    }
    if let Some(conn_id) = uri.strip_prefix(SCHEMA_URI_PREFIX) {
        if conn_id.is_empty() {
            return Err(McpError::InvalidArgs(format!(
                "schema resource URI missing conn_id: {uri}"
            )));
        }
        return read_schema_snapshot(ctx, conn_id).await;
    }
    Err(McpError::InvalidArgs(format!(
        "unknown resource URI: {uri}"
    )))
}

async fn read_active_context(ctx: &ServerContext) -> Result<Value, McpError> {
    let bridge = ctx.bridge.read().await;
    let active = bridge.active_conn_id.clone();
    drop(bridge);

    let Some(conn_id) = active else {
        return Ok(json!({
            "active": false,
        }));
    };

    let store = ctx.store.lock().await;
    let conn = store
        .get_by_id(&conn_id)
        .map_err(|e| McpError::Internal(format!("store get_by_id: {e}")))?;
    drop(store);

    // Fetch live PG version + search_path if there's a pool — best effort.
    let mut pg_version: Option<String> = None;
    let mut search_path: Vec<String> = Vec::new();
    if let Some(pool) = ctx.pools.get(&conn_id).await {
        if let Ok(client) = pool.get().await {
            if let Ok(row) = client.query_one("SELECT version() AS v", &[]).await {
                pg_version = Some(row.get::<_, String>("v"));
            }
            if let Ok(row) = client.query_one("SHOW search_path", &[]).await {
                let raw: String = row.get(0);
                let current_user = client
                    .query_one("SELECT current_user::text AS u", &[])
                    .await
                    .ok()
                    .and_then(|r| r.try_get::<_, String>("u").ok())
                    .unwrap_or_default();
                search_path = crate::schema::commands::resolve_search_path(&raw, &current_user);
            }
        }
    }

    Ok(json!({
        "active": true,
        "activeConnId": conn.id,
        "dbName": conn.database,
        "host": conn.host,
        "port": conn.port,
        "pgVersion": pg_version,
        "searchPath": search_path,
    }))
}

async fn read_schema_snapshot(ctx: &ServerContext, conn_id: &str) -> Result<Value, McpError> {
    let pool = ctx
        .pools
        .get(conn_id)
        .await
        .ok_or_else(|| McpError::Internal(format!("connection not active: {conn_id}")))?;
    let client = pool
        .get()
        .await
        .map_err(|e| McpError::Internal(format!("pool: {e}")))?;

    // Reuse the same SQL the schema command uses, so the snapshot mirrors
    // the IDE's autocomplete view exactly.
    let current_user: String = client
        .query_one(crate::schema::queries::CURRENT_USER_SQL, &[])
        .await
        .map_err(|e| McpError::Internal(format!("current_user: {e}")))?
        .get(0);
    let raw_path: String = client
        .query_one(crate::schema::queries::SHOW_SEARCH_PATH_SQL, &[])
        .await
        .map_err(|e| McpError::Internal(format!("search_path: {e}")))?
        .get(0);
    let resolved_path = crate::schema::commands::resolve_search_path(&raw_path, &current_user);
    let path_array: Vec<&str> = resolved_path.iter().map(String::as_str).collect();

    let rows = client
        .query(
            crate::schema::queries::AUTOCOMPLETE_SNAPSHOT_SQL,
            &[&path_array],
        )
        .await
        .map_err(|e| McpError::Internal(format!("autocomplete snapshot: {e}")))?;

    let mut relations: Vec<Value> = Vec::new();
    for row in &rows {
        let kind: String = row.get("kind");
        let schema: String = row.get("schema");
        let name: String = row.get("name");
        if kind == "rel" {
            let rel_kind: String = row.get("rel_kind");
            relations.push(json!({
                "schema": schema,
                "name": name,
                "kind": rel_kind,
                "columns": [],
            }));
        } else {
            let col_name: String = row.get("col_name");
            let col_type: String = row.get("col_type");
            let nullable: bool = row.get("col_nullable");
            let is_jsonb: bool = row.get("col_is_jsonb");
            if let Some(last) = relations.last_mut() {
                if let Some(cols) = last.get_mut("columns").and_then(Value::as_array_mut) {
                    cols.push(json!({
                        "name": col_name,
                        "dataType": col_type,
                        "nullable": nullable,
                        "isJsonb": is_jsonb,
                    }));
                }
            }
        }
    }

    Ok(json!({
        "connId": conn_id,
        "searchPath": resolved_path,
        "relations": relations,
        "loadedAt": chrono::Utc::now().timestamp_millis(),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::server::{AuditLog, ToolRegistry};
    use std::sync::Arc;
    use tokio::sync::{Mutex, RwLock};

    fn test_ctx() -> ServerContext {
        let mut store = crate::connection::Store::open_in_memory().unwrap();
        store.run_migrations().unwrap();
        let store = Arc::new(Mutex::new(store));
        let pools = Arc::new(crate::connection::PoolRegistry::new());
        let bridge = Arc::new(RwLock::new(
            crate::mcp::ide_bridge::IdeBridgeState::default(),
        ));
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

    #[test]
    fn list_resources_includes_two_entries() {
        let ctx = test_ctx();
        let v = list_resources(&ctx);
        assert_eq!(v.len(), 2);
        assert!(v.iter().any(|r| r.uri == ACTIVE_CONTEXT_URI));
        assert!(v.iter().any(|r| r.uri.starts_with(SCHEMA_URI_PREFIX)));
    }

    #[tokio::test]
    async fn read_resource_unknown_uri_errors() {
        let ctx = test_ctx();
        let err = read_resource(&ctx, "ide99://nope").await.unwrap_err();
        assert!(matches!(err, McpError::InvalidArgs(_)));
    }

    #[tokio::test]
    async fn read_resource_active_context_inactive_when_no_conn() {
        let ctx = test_ctx();
        let v = read_resource(&ctx, ACTIVE_CONTEXT_URI).await.unwrap();
        assert_eq!(v["active"], json!(false));
    }

    #[tokio::test]
    async fn read_resource_schema_requires_conn_id() {
        let ctx = test_ctx();
        let err = read_resource(&ctx, "ide99://schema/").await.unwrap_err();
        assert!(matches!(err, McpError::InvalidArgs(_)));
    }
}
