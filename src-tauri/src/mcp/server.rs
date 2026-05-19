//! MCP server bootstrap — JSON-RPC 2.0 dispatch, audit log, lifecycle.
//!
//! Design choice: instead of a third-party MCP SDK we implement the
//! minimally sufficient part of JSON-RPC 2.0 on top of the MCP spec
//! ourselves. Reasons:
//! - rmcp ≥1.6 pulls 100+ transitive crates and its own reqwest;
//! - our scope (18 tools + one resource provider) is small;
//! - audit log + scope checking + IDE bridge are our own requirements
//!   that an SDK does not cover anyway.

#![allow(    clippy::missing_errors_doc,
    clippy::module_name_repetitions,
    clippy::doc_markdown,
    clippy::doc_overindented_list_items,
    clippy::significant_drop_tightening,
    clippy::missing_const_for_fn,
    clippy::must_use_candidate,
    clippy::items_after_statements,
    clippy::cast_possible_truncation,
    clippy::too_long_first_doc_paragraph,
    clippy::option_if_let_else,
    clippy::needless_pass_by_value,
    clippy::missing_panics_doc,
    clippy::cognitive_complexity
)]

use std::collections::HashMap;
use std::pin::Pin;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::{Mutex, RwLock};
use tokio::task::JoinHandle;
use tracing::Instrument;

use crate::mcp::auth::{
    authorize_request, require_scope, AuditEntry, AuthState, AuthorizedClient, McpScope,
};
use crate::mcp::ide_bridge::IdeBridgeState;

/// MCP protocol version we advertise in `initialize`. Bumped only on
/// breaking changes — pub const PROTOCOL_VERSION: &str = "2024-11-05";

/// Top-level error type for all MCP operations. Serialized per the
/// ide99 convention (see `connection::types::ConnectionError`) — `String`
/// payload, so Tauri IPC can forward it to the frontend without serde
/// gymnastics.
#[derive(Debug, thiserror::Error, Serialize, Deserialize)]
pub enum McpError {
    #[error("MCP server is disabled in settings")]
    Disabled,
    #[error("MCP server already running on port {0}")]
    AlreadyRunning(u16),
    #[error("transport error: {0}")]
    Transport(String),
    #[error("authorization denied: {0}")]
    AuthDenied(String),
    #[error("client not authorized: {0}")]
    NotAuthorized(String),
    #[error("tool not found: {0}")]
    ToolNotFound(String),
    #[error("invalid tool arguments: {0}")]
    InvalidArgs(String),
    #[error("write operation rejected by user")]
    WriteRejected,
    #[error("scope insufficient: required {required}, granted {granted}")]
    ScopeInsufficient { required: String, granted: String },
    #[error("rate limit exceeded: max {0} req/s per token")]
    RateLimited(u32),
    #[error("io error: {0}")]
    Io(String),
    #[error("internal: {0}")]
    Internal(String),
}

impl From<std::io::Error> for McpError {
    fn from(e: std::io::Error) -> Self {
        Self::Io(e.to_string())
    }
}

impl McpError {
    /// JSON-RPC error code per MCP spec mapping. -32600..-32099 reserved
    /// for protocol; we use -32000..-32099 for application errors.
    #[must_use]
    pub fn rpc_code(&self) -> i32 {
        match self {
            Self::ToolNotFound(_) => -32601, // MethodNotFound
            Self::InvalidArgs(_) => -32602,  // InvalidParams
            Self::NotAuthorized(_) | Self::AuthDenied(_) => -32001,
            Self::ScopeInsufficient { .. } => -32002,
            Self::WriteRejected => -32003,
            Self::RateLimited(_) => -32004,
            Self::Disabled | Self::AlreadyRunning(_) => -32005,
            _ => -32000,
        }
    }
}

/// Snapshot of MCP server status for the frontend (Settings UI).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerStatus {
    pub enabled: bool,
    pub http_port: Option<u16>,
    pub ipc_socket: Option<String>,
    pub authorized_clients: u32,
}

impl McpServerStatus {
    #[must_use]
    pub const fn disabled() -> Self {
        Self {
            enabled: false,
            http_port: None,
            ipc_socket: None,
            authorized_clients: 0,
        }
    }
}

/// Tool dispatch signature. Tools are async fns returning serde JSON.
/// `ctx` carries shared resources (store, pools, bridge); `client` is the
/// authorized caller (tools may use scope or audit per-client).
pub type ToolFn = Arc<
    dyn for<'a> Fn(            &'a ServerContext,
            &'a AuthorizedClient,
            Value,
) -> Pin<
            Box<dyn std::future::Future<Output = Result<Value, McpError>> + Send + 'a>,
        > + Send
        + Sync,
>;

/// Tool registry — name → (scope_required, fn). Built once at server start.
pub struct ToolRegistry {
    tools: HashMap<&'static str, (McpScope, ToolFn)>,
}

impl std::fmt::Debug for ToolRegistry {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ToolRegistry")
            .field("count", &self.tools.len())
            .finish()
    }
}

impl ToolRegistry {
    #[must_use]
    pub fn new() -> Self {
        Self {
            tools: HashMap::new(),
        }
    }

    pub fn register(&mut self, name: &'static str, scope: McpScope, f: ToolFn) {
        self.tools.insert(name, (scope, f));
    }

    /// Build the canonical 18-tool registry for ide99. Tools whose
    /// implementation lives in `mcp::tools::*` are imported here. If a
    /// tool module is still a stub (rust-mcp-tools sub-agent hasn't
    /// landed it yet), the entry becomes a placeholder that returns
    /// `ToolNotFound` — non-blocking for our slice.
    #[must_use]
    pub fn build_default() -> Self {
        let mut r = Self::new();
        let placeholders: &[(&'static str, McpScope)] = &[
            ("list_connections", McpScope::DbList),
            ("get_schema", McpScope::DbRead),
            ("get_table_sample", McpScope::DbRead),
            ("run_query", McpScope::DbRead),
            ("run_query_write", McpScope::DbWrite),
            ("get_explain", McpScope::DbRead),
            ("get_health_summary", McpScope::DbRead),
            ("list_slow_queries", McpScope::DbRead),
            ("dry_run_migration", McpScope::DbRead),
            ("apply_migration", McpScope::DbWrite),
            ("get_active_connection", McpScope::IdeRead),
            ("get_current_query", McpScope::IdeRead),
            ("get_selected_text", McpScope::IdeRead),
            ("get_last_result", McpScope::IdeRead),
            ("get_open_tabs", McpScope::IdeRead),
            ("open_query_in_editor", McpScope::IdeWrite),
            ("run_in_editor", McpScope::IdeWrite),
            ("open_table", McpScope::IdeWrite),
            ("open_explain_for", McpScope::IdeWrite),
            ("navigate_to", McpScope::IdeWrite),
        ];
        for (name, scope) in placeholders {
            let placeholder_name = (*name).to_string();
            let f: ToolFn = Arc::new(move |_ctx, _client, _args| {
                let n = placeholder_name.clone();
                Box::pin(async move { Err(McpError::ToolNotFound(n)) })
            });
            r.register(name, *scope, f);
        }
        r
    }

    #[must_use]
    pub fn list_names(&self) -> Vec<&'static str> {
        let mut v: Vec<&'static str> = self.tools.keys().copied().collect();
        v.sort_unstable();
        v
    }

    pub fn get(&self, name: &str) -> Option<&(McpScope, ToolFn)> {
        self.tools.get(name)
    }
}

impl Default for ToolRegistry {
    fn default() -> Self {
        Self::new()
    }
}

/// Audit log writer. Wraps a [`tracing_appender`] non-blocking file appender
/// so tool calls never block on disk I/O. Rotation: daily by default; files
/// are at `<data_dir>/mcp-audit.log{,.YYYY-MM-DD}`.
pub struct AuditLog {
    _guard: tracing_appender::non_blocking::WorkerGuard,
    writer: tracing_appender::non_blocking::NonBlocking,
}

impl std::fmt::Debug for AuditLog {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AuditLog").finish()
    }
}

impl AuditLog {
    /// Open / create the audit log file in `<data_dir>/mcp-audit.log`.
    /// Falls back to a writer that drops entries if file open fails — the
    /// MCP server must not refuse to start because logging is broken.
    pub fn open(data_dir: &std::path::Path) -> Self {
        let appender = tracing_appender::rolling::daily(data_dir, "mcp-audit.log");
        let (writer, guard) = tracing_appender::non_blocking(appender);
        Self {
            _guard: guard,
            writer,
        }
    }

    /// Serialize and append one entry. Errors are swallowed — audit logging
    /// is best-effort and must never break tool execution.
    pub fn write(&self, entry: &AuditEntry) {
        if let Ok(mut s) = serde_json::to_string(entry) {
            s.push('\n');
            // `NonBlocking` impls std::io::Write — we ignore the result.
            use std::io::Write;
            let mut w = self.writer.clone();
            let _ = w.write_all(s.as_bytes());
        }
    }
}

/// JSON-RPC 2.0 request envelope.
#[derive(Debug, Clone, Deserialize)]
pub struct RpcRequest {
    pub jsonrpc: String,
    #[serde(default)]
    pub id: Option<Value>,
    pub method: String,
    #[serde(default)]
    pub params: Option<Value>,
}

/// JSON-RPC 2.0 response envelope.
#[derive(Debug, Clone, Serialize)]
pub struct RpcResponse {
    pub jsonrpc: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<RpcError>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RpcError {
    pub code: i32,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

impl RpcResponse {
    #[must_use]
    pub const fn ok(id: Option<Value>, result: Value) -> Self {
        Self {
            jsonrpc: "2.0",
            id,
            result: Some(result),
            error: None,
        }
    }

    #[must_use]
    pub fn err(id: Option<Value>, e: &McpError) -> Self {
        Self {
            jsonrpc: "2.0",
            id,
            result: None,
            error: Some(RpcError {
                code: e.rpc_code(),
                message: e.to_string(),
                data: None,
            }),
        }
    }
}

/// Shared runtime context for a single session (HTTP connection or IPC
/// client). Passed into the dispatch loop. Holds a subset of AppState
/// fields needed by tools plus auth/audit/registry. Intentionally does
/// NOT hold the whole `Arc<AppState>`: tauri::State does not expose its
/// inner Arc, and duplicating the state fields into our `ServerContext`
/// is enough — all shared features (store, pools, bridge) are already
/// Arc-wrapped in AppState.
#[derive(Clone)]
pub struct ServerContext {
    pub store: Arc<Mutex<crate::connection::Store>>,
    pub pools: Arc<crate::connection::PoolRegistry>,
    pub bridge: Arc<RwLock<IdeBridgeState>>,
    pub auth: Arc<AuthState>,
    pub registry: Arc<ToolRegistry>,
    pub audit: Arc<AuditLog>,
    pub app_handle: Option<tauri::AppHandle>,
}

impl std::fmt::Debug for ServerContext {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ServerContext").finish()
    }
}

/// Dispatch one JSON-RPC request. The `bearer` is `None` for unauthenticated
/// methods (`initialize`, `ping`); otherwise it must match a row in
/// `mcp_clients` and the method-specific scope check.
pub async fn dispatch(ctx: &ServerContext, bearer: Option<&str>, req: &RpcRequest) -> RpcResponse {
    let id = req.id.clone();
    if req.jsonrpc != "2.0" {
        return RpcResponse::err(            id,
            &McpError::InvalidArgs(format!("unsupported jsonrpc version: {}", req.jsonrpc)),
);
    }

    let result = handle_method(ctx, bearer, req).await;
    match result {
        Ok(v) => RpcResponse::ok(id, v),
        Err(e) => RpcResponse::err(id, &e),
    }
}

async fn handle_method(    ctx: &ServerContext,
    bearer: Option<&str>,
    req: &RpcRequest,
) -> Result<Value, McpError> {
    match req.method.as_str() {
        "initialize" => Ok(json!({
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {
                "tools": {},
                "resources": {}
            },
            "serverInfo": {
                "name": "ide99",
                "version": env!("CARGO_PKG_VERSION")
            }
        })),
        "ping" => Ok(json!({})),
        "tools/list" => {
            // Return tool names + their required scope, even before the
            // client is authorized — agents need this to know what to ask
            // for.
            let mut tools = Vec::new();
            for name in ctx.registry.list_names() {
                if let Some((scope, _)) = ctx.registry.get(name) {
                    tools.push(json!({
                        "name": name,
                        "description": format!("ide99 MCP tool `{name}` (scope: {})", serde_json::to_string(scope).unwrap_or_default()),
                        "inputSchema": { "type": "object" }
                    }));
                }
            }
            Ok(json!({ "tools": tools }))
        }
        "tools/call" => {
            let token = bearer.ok_or_else(|| {
                McpError::NotAuthorized("missing Authorization Bearer header".into())
            })?;
            let store = ctx.store.lock().await;
            let client = authorize_request(store.conn(), token)?;
            drop(store);

            // Rate-limit: per-client, per-second.
            if !ctx.auth.check_rate(&client.id).await {
                return Err(McpError::RateLimited(crate::mcp::auth::RATE_LIMIT_PER_SEC));
            }

            let params = req.params.clone().unwrap_or_else(|| json!({}));
            let tool_name = params
                .get("name")
                .and_then(Value::as_str)
                .ok_or_else(|| McpError::InvalidArgs("missing tool name".into()))?
                .to_string();
            let args = params
                .get("arguments")
                .cloned()
                .unwrap_or_else(|| json!({}));

            let (scope, f) = ctx
                .registry
                .get(&tool_name)
                .ok_or_else(|| McpError::ToolNotFound(tool_name.clone()))?
                .clone();
            require_scope(&client, scope)?;

            let started = std::time::Instant::now();
            let outcome = (f)(ctx, &client, args)
                .instrument(tracing::info_span!("mcp_tool", name = %tool_name))
                .await;
            let elapsed = started.elapsed().as_millis() as u64;

            let entry = AuditEntry {
                timestamp: chrono::Utc::now().to_rfc3339(),
                client_id: client.id.clone(),
                client_name: client.name.clone(),
                tool: tool_name.clone(),
                status: match &outcome {
                    Ok(_) => "ok".into(),
                    Err(e) => format!("err:{}", e.rpc_code()),
                },
                duration_ms: elapsed,
            };
            ctx.audit.write(&entry);
            outcome
        }
        "resources/list" => {
            // resources/list is unauthenticated by spec — agents need to know
            // what's offered before deciding to ask for scope. Concrete resource
            // *content* (resources/read) still goes through scope-checked
            // authorization below.
            let resources: Vec<Value> = crate::mcp::resources::list_resources(ctx)
                .into_iter()
                .map(|r| {
                    json!({
                        "uri": r.uri,
                        "name": r.name,
                        "mimeType": r.mime_type,
                    })
                })
                .collect();
            Ok(json!({ "resources": resources }))
        }
        "resources/read" => {
            // Reading a resource — even ambient context — exposes schema or
            // active-connection metadata, so it requires `db:read` scope.
            let token = bearer.ok_or_else(|| {
                McpError::NotAuthorized("missing Authorization Bearer header".into())
            })?;
            let store = ctx.store.lock().await;
            let client = authorize_request(store.conn(), token)?;
            drop(store);

            if !ctx.auth.check_rate(&client.id).await {
                return Err(McpError::RateLimited(crate::mcp::auth::RATE_LIMIT_PER_SEC));
            }
            require_scope(&client, McpScope::DbRead)?;

            let params = req.params.clone().unwrap_or_else(|| json!({}));
            let uri = params
                .get("uri")
                .and_then(Value::as_str)
                .ok_or_else(|| McpError::InvalidArgs("missing field 'uri'".into()))?;
            let contents = crate::mcp::resources::read_resource(ctx, uri).await?;
            Ok(json!({ "contents": [contents] }))
        }
        other => Err(McpError::ToolNotFound(format!("method `{other}`"))),
    }
}

// -------- ToolFn manual Clone helper --------
impl Clone for ToolRegistry {
    fn clone(&self) -> Self {
        Self {
            tools: self.tools.clone(),
        }
    }
}

/// Handle to a running server. Real `JoinHandle`s for the two
/// transports plus per-server cancellation token (`shutdown_tx`) and
/// `ServerContext` needed by commands.rs.
pub struct McpServerHandle {
    pub status: McpServerStatus,
    pub http_handle: Option<JoinHandle<()>>,
    pub ipc_handle: Option<JoinHandle<()>>,
    pub shutdown_tx: Option<tokio::sync::watch::Sender<bool>>,
    pub context: Option<Arc<ServerContext>>,
}

impl std::fmt::Debug for McpServerHandle {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("McpServerHandle")
            .field("status", &self.status)
            .field("running", &self.shutdown_tx.is_some())
            .finish_non_exhaustive()
    }
}

impl McpServerHandle {
    #[must_use]
    pub const fn disabled() -> Self {
        Self {
            status: McpServerStatus::disabled(),
            http_handle: None,
            ipc_handle: None,
            shutdown_tx: None,
            context: None,
        }
    }
}

/// Start the MCP server. Resolves an unused TCP port on 127.0.0.1, opens
/// the IPC endpoint, and spawns both transports.
///
/// Returns a handle that the caller stows in `AppState::mcp_server`.
pub async fn start(    store: Arc<Mutex<crate::connection::Store>>,
    pools: Arc<crate::connection::PoolRegistry>,
    bridge: Arc<RwLock<IdeBridgeState>>,
    app_handle: Option<tauri::AppHandle>,
) -> Result<McpServerHandle, McpError> {
    // Bind a TCP socket on a random ephemeral port. We let the OS pick by
    // requesting :0 — this avoids racey port-scanning.
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let port = listener.local_addr()?.port();

    let auth = AuthState::new();
    // build_default() seeds 20 placeholders; register_all
    // overwrites each with the real tool impl from `mcp::tools::*`. After
    // this point the registry is canonical.
    let mut registry = ToolRegistry::build_default();
    crate::mcp::tools::register_all(&mut registry);
    let registry = Arc::new(registry);
    let data_dir = crate::app_paths::data_dir().map_err(|e| McpError::Io(e.to_string()))?;
    let audit = Arc::new(AuditLog::open(&data_dir));

    let ctx = Arc::new(ServerContext {
        store: store.clone(),
        pools,
        bridge,
        auth,
        registry,
        audit,
        app_handle,
    });

    let (shutdown_tx, shutdown_rx) = tokio::sync::watch::channel(false);

    // HTTP transport: serve on the already-bound listener so we know the
    // exact port up front.
    let http_ctx = ctx.clone();
    let http_shutdown = shutdown_rx.clone();
    let http_handle = tokio::spawn(async move {
        if let Err(e) = crate::mcp::transport_http::serve(listener, http_ctx, http_shutdown).await {
            tracing::error!(error = %e, "MCP HTTP transport stopped");
        }
    });

    // IPC transport: best-effort; if socket creation fails (e.g., stale
    // file in target dir), we still keep HTTP up.
    let ipc_ctx = ctx.clone();
    let ipc_shutdown = shutdown_rx.clone();
    let socket_path = crate::mcp::transport_ipc::default_socket_path()
        .ok_or_else(|| McpError::Io("could not resolve IPC socket path".into()))?;
    let socket_str = socket_path.display().to_string();
    let ipc_handle = tokio::spawn(async move {
        if let Err(e) = crate::mcp::transport_ipc::serve(socket_path, ipc_ctx, ipc_shutdown).await {
            tracing::error!(error = %e, "MCP IPC transport stopped");
        }
    });

    let store_g = store.lock().await;
    let authorized_clients = u32::try_from(        crate::mcp::store_migration::list_clients(store_g.conn())
            .map(|v| v.len())
            .unwrap_or(0),
)
    .unwrap_or(0);
    drop(store_g);

    let status = McpServerStatus {
        enabled: true,
        http_port: Some(port),
        ipc_socket: Some(socket_str),
        authorized_clients,
    };

    Ok(McpServerHandle {
        status,
        http_handle: Some(http_handle),
        ipc_handle: Some(ipc_handle),
        shutdown_tx: Some(shutdown_tx),
        context: Some(ctx),
    })
}

/// Stop the MCP server: signal shutdown, await both join handles.
pub async fn stop(handle: &mut McpServerHandle) -> Result<(), McpError> {
    if let Some(tx) = handle.shutdown_tx.take() {
        let _ = tx.send(true);
    }
    if let Some(h) = handle.http_handle.take() {
        let _ = h.await;
    }
    if let Some(h) = handle.ipc_handle.take() {
        let _ = h.await;
    }
    handle.context = None;
    handle.status = McpServerStatus::disabled();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_has_eighteen_or_more_tools() {
        let r = ToolRegistry::build_default();
        // Spec lists 20 tools (10 db + 5 ide-state + 5 ide-actions).
        assert_eq!(r.list_names().len(), 20);
        assert!(r.get("list_connections").is_some());
        assert!(r.get("run_query_write").is_some());
    }

    fn test_ctx() -> ServerContext {
        let mut store = crate::connection::Store::open_in_memory().unwrap();
        store.run_migrations().unwrap();
        let store = Arc::new(Mutex::new(store));
        let pools = Arc::new(crate::connection::PoolRegistry::new());
        let bridge = Arc::new(RwLock::new(IdeBridgeState::default()));
        let auth = AuthState::new();
        let registry = Arc::new(ToolRegistry::build_default());
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
    async fn dispatch_initialize_returns_protocol_version() {
        let ctx = test_ctx();
        let resp = dispatch(            &ctx,
            None,
            &RpcRequest {
                jsonrpc: "2.0".into(),
                id: Some(json!(1)),
                method: "initialize".into(),
                params: None,
            },
)
        .await;
        assert!(resp.error.is_none(), "got error: {:?}", resp.error);
        let result = resp.result.unwrap();
        assert_eq!(result["protocolVersion"], json!(PROTOCOL_VERSION));
    }

    #[tokio::test]
    async fn dispatch_tools_call_without_token_is_unauthorized() {
        let ctx = test_ctx();
        let resp = dispatch(            &ctx,
            None,
            &RpcRequest {
                jsonrpc: "2.0".into(),
                id: Some(json!(2)),
                method: "tools/call".into(),
                params: Some(json!({ "name": "list_connections", "arguments": {} })),
            },
)
        .await;
        assert!(resp.error.is_some());
        assert_eq!(resp.error.unwrap().code, -32001);
    }

    #[tokio::test]
    async fn dispatch_tools_list_works_without_token() {
        let ctx = test_ctx();
        let resp = dispatch(            &ctx,
            None,
            &RpcRequest {
                jsonrpc: "2.0".into(),
                id: Some(json!(3)),
                method: "tools/list".into(),
                params: None,
            },
)
        .await;
        assert!(resp.error.is_none());
        let result = resp.result.unwrap();
        let tools = result["tools"].as_array().unwrap();
        assert!(tools.len() >= 18, "expected at least 18 tools");
    }

    #[tokio::test]
    async fn dispatch_tools_call_with_token_runs_placeholder() {
        let ctx = test_ctx();
        // Issue a token by writing directly into the store + matching keychain.
        let kc: Box<dyn crate::connection::Keychain> =
            Box::new(crate::connection::keychain::MemoryKeychain::new());
        let store_lock = ctx.store.lock().await;
        let (_id, token) = crate::mcp::auth::issue_token(            store_lock.conn(),
            kc.as_ref(),
            "test-client",
            &McpScope::default_grant(),
)
        .unwrap();
        drop(store_lock);
        let resp = dispatch(            &ctx,
            Some(&token),
            &RpcRequest {
                jsonrpc: "2.0".into(),
                id: Some(json!(4)),
                method: "tools/call".into(),
                params: Some(json!({ "name": "get_current_query", "arguments": {} })),
            },
)
        .await;
        // Default registry returns ToolNotFound for placeholders; that's
        // expected until rust-mcp-tools wires real impls.
        assert!(resp.error.is_some());
        assert_eq!(resp.error.unwrap().code, -32601);
    }

    #[tokio::test]
    async fn dispatch_invalid_method_is_method_not_found() {
        let ctx = test_ctx();
        let resp = dispatch(            &ctx,
            None,
            &RpcRequest {
                jsonrpc: "2.0".into(),
                id: Some(json!(5)),
                method: "bogus/thing".into(),
                params: None,
            },
)
        .await;
        assert!(resp.error.is_some());
        assert_eq!(resp.error.unwrap().code, -32601);
    }

    #[tokio::test]
    async fn start_then_stop_cycles_cleanly() {
        let mut store = crate::connection::Store::open_in_memory().unwrap();
        store.run_migrations().unwrap();
        let store = Arc::new(Mutex::new(store));
        let pools = Arc::new(crate::connection::PoolRegistry::new());
        let bridge = Arc::new(RwLock::new(IdeBridgeState::default()));
        // Override data dir so we don't write audit logs into ~/Library.
        let tmp = tempfile::tempdir().unwrap();
        std::env::set_var("IDE99_DATA_DIR", tmp.path());

        let mut handle = start(store, pools, bridge, None).await.unwrap();
        assert!(handle.status.enabled);
        assert!(handle.status.http_port.is_some());

        stop(&mut handle).await.unwrap();
        assert!(!handle.status.enabled);
        std::env::remove_var("IDE99_DATA_DIR");
    }
}
