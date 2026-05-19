//! Sprint 30 — integration test для MCP HTTP transport.
//!
//! Поднимает реальный axum router на ephemeral порту 127.0.0.1:0,
//! делает MCP handshake (`initialize`) через TCP-клиент и проверяет, что
//! ответ содержит `protocolVersion`. Проверяет также `tools/list`,
//! Origin-rejection и Bearer-required для `tools/call`.

use std::sync::Arc;

use ide99::connection::{keychain::MemoryKeychain, Keychain, PoolRegistry, Store};
use ide99::mcp::auth::{issue_token, AuthState, McpScope};
use ide99::mcp::ide_bridge::IdeBridgeState;
use ide99::mcp::server::{AuditLog, ServerContext, ToolRegistry};
use ide99::mcp::transport_http;
use serde_json::json;
use tokio::sync::{Mutex, RwLock};

async fn start_test_server() -> (String, tokio::sync::watch::Sender<bool>, String) {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.keep();
    let db_path = path.join("store.db");
    let mut store = Store::open(&db_path).unwrap();
    store.run_migrations().unwrap();
    let store = Arc::new(Mutex::new(store));
    let pools = Arc::new(PoolRegistry::new());
    let bridge = Arc::new(RwLock::new(IdeBridgeState::default()));
    let auth = AuthState::new();
    let registry = Arc::new(ToolRegistry::build_default());
    let audit = Arc::new(AuditLog::open(&path));

    // Issue a token directly so we can hit `tools/call`.
    let kc: Box<dyn Keychain> = Box::new(MemoryKeychain::new());
    let store_g = store.lock().await;
    let (_id, token) = issue_token(
        store_g.conn(),
        kc.as_ref(),
        "integration-test",
        &McpScope::default_grant(),
    )
    .unwrap();
    drop(store_g);

    let ctx = Arc::new(ServerContext {
        store,
        pools,
        bridge,
        auth,
        registry,
        audit,
        app_handle: None,
    });

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let (shutdown_tx, shutdown_rx) = tokio::sync::watch::channel(false);
    tokio::spawn(async move {
        transport_http::serve(listener, ctx, shutdown_rx)
            .await
            .unwrap();
    });
    // Tiny grace period to let the server start accepting.
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;

    (format!("http://127.0.0.1:{port}"), shutdown_tx, token)
}

/// Minimal HTTP/1.1 client over TCP — avoids pulling reqwest into deps.
async fn http_post_json(
    url: &str,
    headers: &[(&str, &str)],
    body: serde_json::Value,
) -> (u16, serde_json::Value) {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let stripped = url.trim_start_matches("http://");
    let (host_port, path) = stripped
        .split_once('/')
        .map_or((stripped, ""), |(h, p)| (h, p));
    let path = format!("/{path}");
    let body_str = body.to_string();

    let mut req = format!("POST {path} HTTP/1.1\r\nHost: {host_port}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n", body_str.len());
    for (k, v) in headers {
        req.push_str(&format!("{k}: {v}\r\n"));
    }
    req.push_str("\r\n");
    req.push_str(&body_str);

    let mut stream = tokio::net::TcpStream::connect(host_port).await.unwrap();
    stream.write_all(req.as_bytes()).await.unwrap();
    stream.flush().await.unwrap();

    let mut buf = Vec::new();
    stream.read_to_end(&mut buf).await.unwrap();
    let raw = String::from_utf8_lossy(&buf);

    let (status_line, rest) = raw.split_once("\r\n").unwrap_or((raw.as_ref(), ""));
    let status_code: u16 = status_line
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    // Find body after blank line.
    let body_str = rest.split_once("\r\n\r\n").map(|(_, b)| b).unwrap_or("");
    let json_body = serde_json::from_str(body_str).unwrap_or(serde_json::json!({}));
    (status_code, json_body)
}

#[tokio::test]
async fn initialize_returns_protocol_version() {
    let (base, shutdown, _tok) = start_test_server().await;
    let (status, body) = http_post_json(
        &format!("{base}/mcp"),
        &[],
        json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize"
        }),
    )
    .await;
    assert_eq!(status, 200, "initialize should return 200");
    assert!(body["result"]["protocolVersion"].is_string());
    assert_eq!(body["result"]["serverInfo"]["name"], "ide99");
    let _ = shutdown.send(true);
}

#[tokio::test]
async fn tools_list_returns_eighteen_plus() {
    let (base, shutdown, _tok) = start_test_server().await;
    let (status, body) = http_post_json(
        &format!("{base}/mcp"),
        &[],
        json!({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/list"
        }),
    )
    .await;
    assert_eq!(status, 200);
    let tools = body["result"]["tools"].as_array().expect("tools array");
    assert!(tools.len() >= 18, "expected ≥18 tools, got {}", tools.len());
    let _ = shutdown.send(true);
}

#[tokio::test]
async fn tools_call_without_bearer_is_unauthorized() {
    let (base, shutdown, _tok) = start_test_server().await;
    let (_status, body) = http_post_json(
        &format!("{base}/mcp"),
        &[],
        json!({
            "jsonrpc": "2.0",
            "id": 3,
            "method": "tools/call",
            "params": { "name": "list_connections", "arguments": {} }
        }),
    )
    .await;
    assert_eq!(body["error"]["code"], -32001);
    let _ = shutdown.send(true);
}

#[tokio::test]
async fn tools_call_with_bearer_dispatches() {
    let (base, shutdown, token) = start_test_server().await;
    let bearer = format!("Bearer {token}");
    let (status, body) = http_post_json(
        &format!("{base}/mcp"),
        &[("Authorization", &bearer)],
        json!({
            "jsonrpc": "2.0",
            "id": 4,
            "method": "tools/call",
            "params": { "name": "get_current_query", "arguments": {} }
        }),
    )
    .await;
    assert_eq!(status, 200);
    // Placeholder tool returns ToolNotFound (-32601). The dispatch path
    // worked — we got past auth and scope.
    assert_eq!(body["error"]["code"], -32601);
    let _ = shutdown.send(true);
}

#[tokio::test]
async fn evil_origin_is_rejected() {
    let (base, shutdown, _tok) = start_test_server().await;
    let (status, _body) = http_post_json(
        &format!("{base}/mcp"),
        &[("Origin", "https://evil.example")],
        json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize" }),
    )
    .await;
    assert_eq!(status, 403, "evil origin should be 403");
    let _ = shutdown.send(true);
}

#[tokio::test]
async fn rate_limit_blocks_eleventh_call() {
    let (base, shutdown, token) = start_test_server().await;
    let bearer = format!("Bearer {token}");
    let mut hit_rate_limit = false;
    for i in 0..15 {
        let (_status, body) = http_post_json(
            &format!("{base}/mcp"),
            &[("Authorization", &bearer)],
            json!({
                "jsonrpc": "2.0",
                "id": i,
                "method": "tools/call",
                "params": { "name": "get_current_query", "arguments": {} }
            }),
        )
        .await;
        if body["error"]["code"].as_i64() == Some(-32004) {
            hit_rate_limit = true;
            break;
        }
    }
    assert!(hit_rate_limit, "11th+ call must hit -32004 rate-limit");
    let _ = shutdown.send(true);
}
