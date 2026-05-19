//! HTTP/SSE transport on 127.0.0.1 — embedded mode for an
//! already-running ide99.
//!
//! Listens only on loopback (`127.0.0.1`); Origin check against a
//! whitelist (`http://localhost`, `tauri://localhost`,
//! `https://tauri.localhost`); Bearer-token auth; rate limiting happens
//! below in [`crate::mcp::server::dispatch`].
//!
//! Transport: for simplicity we implement unidirectional POST-RPC
//! (`POST /mcp` → JSON-RPC request → JSON-RPC response). Anthropic's
//! MCP clients support this alongside SSE — it covers tools/list and
//! tools/call. SSE can be added later if we need server-initiated
//! notifications.

#![allow(    clippy::missing_errors_doc,
    clippy::module_name_repetitions,
    clippy::doc_markdown
)]

use std::sync::Arc;

use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::Value;

use crate::mcp::server::{dispatch, McpError, RpcRequest, RpcResponse, ServerContext};

/// Allowed `Origin` header values. We only accept loopback origins —
/// remote browsers cannot abuse the local server even if someone forwards
/// the port. Empty / missing Origin is also allowed because `curl` and
/// native clients (Claude Code stdio proxy) don't send one.
const ALLOWED_ORIGINS: &[&str] = &[
    "http://localhost",
    "http://127.0.0.1",
    "tauri://localhost",
    "https://tauri.localhost",
];

fn origin_allowed(headers: &HeaderMap) -> bool {
    let Some(origin) = headers.get("origin").and_then(|h| h.to_str().ok()) else {
        return true;
    };
    ALLOWED_ORIGINS.iter().any(|a| origin.starts_with(a))
}

fn extract_bearer(headers: &HeaderMap) -> Option<String> {
    headers
        .get("authorization")
        .and_then(|h| h.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(str::to_string)
}

async fn rpc_handler(    State(ctx): State<Arc<ServerContext>>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    if !origin_allowed(&headers) {
        return (            StatusCode::FORBIDDEN,
            Json(serde_json::json!({"error": "origin"})),
)
            .into_response();
    }

    let req: RpcRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => {
            let err = McpError::InvalidArgs(e.to_string());
            return (StatusCode::BAD_REQUEST, Json(RpcResponse::err(None, &err))).into_response();
        }
    };

    let bearer = extract_bearer(&headers);
    let resp = dispatch(&ctx, bearer.as_deref(), &req).await;
    (StatusCode::OK, Json(resp)).into_response()
}

async fn health_handler() -> impl IntoResponse {
    Json(serde_json::json!({ "status": "ok", "protocol": "mcp" }))
}

/// Build the axum router for the MCP HTTP transport.
pub fn router(ctx: Arc<ServerContext>) -> Router {
    Router::new()
        .route("/mcp", post(rpc_handler))
        .route("/health", get(health_handler))
        .with_state(ctx)
}

/// Run the HTTP server on the pre-bound listener until `shutdown` flips
/// to `true`.
pub async fn serve(    listener: tokio::net::TcpListener,
    ctx: Arc<ServerContext>,
    mut shutdown: tokio::sync::watch::Receiver<bool>,
) -> Result<(), McpError> {
    let app = router(ctx);
    axum::serve(listener, app)
        .with_graceful_shutdown(async move {
            // Wait until shutdown flips to true.
            while !*shutdown.borrow() {
                if shutdown.changed().await.is_err() {
                    return;
                }
            }
        })
        .await
        .map_err(|e| McpError::Transport(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    #[test]
    fn empty_origin_allowed() {
        let h = HeaderMap::new();
        assert!(origin_allowed(&h));
    }

    #[test]
    fn loopback_origin_allowed() {
        let mut h = HeaderMap::new();
        h.insert("origin", HeaderValue::from_static("http://localhost:1420"));
        assert!(origin_allowed(&h));
    }

    #[test]
    fn remote_origin_blocked() {
        let mut h = HeaderMap::new();
        h.insert("origin", HeaderValue::from_static("https://evil.example"));
        assert!(!origin_allowed(&h));
    }

    #[test]
    fn bearer_extracted() {
        let mut h = HeaderMap::new();
        h.insert("authorization", HeaderValue::from_static("Bearer abc123"));
        assert_eq!(extract_bearer(&h).as_deref(), Some("abc123"));
    }

    #[test]
    fn bearer_missing_is_none() {
        let h = HeaderMap::new();
        assert!(extract_bearer(&h).is_none());
    }

    #[test]
    fn non_bearer_authorization_is_none() {
        let mut h = HeaderMap::new();
        h.insert("authorization", HeaderValue::from_static("Basic xxx"));
        assert!(extract_bearer(&h).is_none());
    }
}
