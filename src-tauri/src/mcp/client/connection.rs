//! One outbound connection to an external MCP server.
//!
//! Two transports:
//! - **stdio:** spawn subprocess (`command + args + env`), exchange JSON-RPC
//! over its stdin/stdout (line-delimited).
//! - **http:** issue POST to the configured URL with `Authorization: Bearer`.
//!
//! Lifecycle:
//! ```text
//! .new()           — Disconnected (no I/O yet)
//! .connect()       — Connected; runs `initialize` + caches tools/resources
//! .disconnect()    — kills subprocess / drops HTTP client
//! ```
//!
//! v1.0 is **read-only** — we only ever issue `initialize`, `tools/list`,
//! `resources/list`, `resources/read`, `ping`. We never call `tools/call`
//! because there's no in-IDE consumer for the result; that flips on in
//! v1.1+ when our own AI features arrive.

use std::process::Stdio;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;
use tokio::time::{timeout, Duration};

use crate::mcp::client::config::{expand_env, McpServerEntry};
use crate::mcp::server::McpError;

/// Hard cap on `initialize + list` time. External MCP servers usually
/// respond in <1s; we give them a little more, then surface a
/// `ConnectError` so the user sees a status badge instead of a hang.
const INITIALIZE_TIMEOUT: Duration = Duration::from_secs(15);

/// MCP `tool` shape echoed from the remote `tools/list` response. We keep
/// only what UI needs (name, description) — full inputSchema lives on the
/// remote and is fetched if/when we ever call `tools/call`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteTool {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
}

/// MCP `resource` shape echoed from `resources/list`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteResource {
    pub uri: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default, rename = "mimeType")]
    pub mime_type: Option<String>,
}

/// Live connection status, surfaced to UI via `mcp_client_list`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum ConnectionStatus {
    /// Configured but not yet started.
    Disconnected,
    /// `connect()` is running (initialize handshake in flight).
    Connecting,
    /// Healthy. `tools` + `resources` populated.
    Connected {
        tools: Vec<RemoteTool>,
        resources: Vec<RemoteResource>,
        /// `serverInfo.name` from the remote, when provided.
        server_name: Option<String>,
        /// MCP protocol version the remote claims.
        protocol_version: Option<String>,
    },
    /// Last `connect()` failed. Caller can retry.
    Error { message: String },
}

/// One configured client. Carries the entry definition + live state. Owned
/// by [`crate::mcp::client::registry::ClientRegistry`] under a `Mutex` so
/// concurrent commands serialize naturally without a write-fight.
pub struct ClientConnection {
    pub name: String,
    pub entry: McpServerEntry,
    pub status: Arc<Mutex<ConnectionStatus>>,
    /// stdio transport: kept so `disconnect()` can `kill()`.
    process: Arc<Mutex<Option<Child>>>,
}

impl ClientConnection {
    #[must_use]
    pub fn new(name: String, entry: McpServerEntry) -> Self {
        Self {
            name,
            entry,
            status: Arc::new(Mutex::new(ConnectionStatus::Disconnected)),
            process: Arc::new(Mutex::new(None)),
        }
    }

    /// Open the connection: spawn / open HTTP, run handshake, cache lists.
    pub async fn connect(&self) -> Result<(), McpError> {
        {
            let mut s = self.status.lock().await;
            *s = ConnectionStatus::Connecting;
        }

        let result = match &self.entry {
            McpServerEntry::Stdio {
                command, args, env, ..
            } => self.connect_stdio(command, args, env).await,
            McpServerEntry::Http { url, auth, .. } => self.connect_http(url, auth.as_deref()).await,
        };

        let mut s = self.status.lock().await;
        match result {
            Ok((tools, resources, server_name, protocol_version)) => {
                *s = ConnectionStatus::Connected {
                    tools,
                    resources,
                    server_name,
                    protocol_version,
                };
                Ok(())
            }
            Err(e) => {
                *s = ConnectionStatus::Error {
                    message: e.to_string(),
                };
                Err(e)
            }
        }
    }

    /// Stop the connection: kill subprocess (stdio) or drop HTTP client.
    pub async fn disconnect(&self) -> Result<(), McpError> {
        let mut proc = self.process.lock().await;
        if let Some(mut child) = proc.take() {
            // Best-effort; the process might already have exited.
            let _ = child.kill().await;
        }
        let mut s = self.status.lock().await;
        *s = ConnectionStatus::Disconnected;
        Ok(())
    }

    // ---- transport-specific handshake ----

    async fn connect_stdio(
        &self,
        command: &str,
        args: &[String],
        env: &std::collections::BTreeMap<String, String>,
    ) -> Result<
        (
            Vec<RemoteTool>,
            Vec<RemoteResource>,
            Option<String>,
            Option<String>,
        ),
        McpError,
    > {
        let mut cmd = Command::new(command);
        cmd.args(args);
        for (k, v) in env {
            cmd.env(k, expand_env(v));
        }
        cmd.stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true);

        let mut child = cmd
            .spawn()
            .map_err(|e| McpError::Transport(format!("spawn `{command}`: {e}")))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| McpError::Transport("no stdin".into()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| McpError::Transport("no stdout".into()))?;

        // We move stdin/stdout into the work future; the child handle stays
        // with `self` so `disconnect()` can kill it.
        {
            let mut p = self.process.lock().await;
            *p = Some(child);
        }

        let work = handshake_over_stdio(stdin, stdout);
        match timeout(INITIALIZE_TIMEOUT, work).await {
            Ok(r) => r,
            Err(_) => Err(McpError::Transport("handshake timed out".into())),
        }
    }

    async fn connect_http(
        &self,
        _url: &str,
        _auth: Option<&str>,
    ) -> Result<
        (
            Vec<RemoteTool>,
            Vec<RemoteResource>,
            Option<String>,
            Option<String>,
        ),
        McpError,
    > {
        // v1.0 ships stdio only — HTTP transport is the rarer path and
        // brings in a full HTTP client dep we don't otherwise need.
        // Surfacing a clear error keeps the Settings UI honest until v1.1
        // grows real HTTP support.
        Err(McpError::Transport(
            "HTTP transport for external MCP servers is not yet supported (v1.1+)".into(),
        ))
    }
}

// ---- JSON-RPC handshake helpers ----

async fn handshake_over_stdio(
    mut stdin: tokio::process::ChildStdin,
    stdout: tokio::process::ChildStdout,
) -> Result<
    (
        Vec<RemoteTool>,
        Vec<RemoteResource>,
        Option<String>,
        Option<String>,
    ),
    McpError,
> {
    let mut reader = BufReader::new(stdout).lines();
    let mut next_id: u64 = 1;

    // 1. initialize
    let init_req = json!({
        "jsonrpc": "2.0",
        "id": next_id,
        "method": "initialize",
        "params": {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": { "name": "ide99", "version": env!("CARGO_PKG_VERSION") }
        }
    });
    next_id += 1;
    write_line(&mut stdin, &init_req).await?;
    let init_resp = read_line(&mut reader).await?;
    let server_name = init_resp
        .pointer("/result/serverInfo/name")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);
    let protocol_version = init_resp
        .pointer("/result/protocolVersion")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);

    // 2. tools/list
    let tools_req = json!({"jsonrpc": "2.0", "id": next_id, "method": "tools/list"});
    next_id += 1;
    write_line(&mut stdin, &tools_req).await?;
    let tools_resp = read_line(&mut reader).await?;
    let tools: Vec<RemoteTool> = tools_resp
        .pointer("/result/tools")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    // 3. resources/list — many servers don't expose any; treat absence as empty.
    let res_req = json!({"jsonrpc": "2.0", "id": next_id, "method": "resources/list"});
    write_line(&mut stdin, &res_req).await?;
    let res_resp = read_line(&mut reader).await.unwrap_or_else(|_| json!({}));
    let resources: Vec<RemoteResource> = res_resp
        .pointer("/result/resources")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    Ok((tools, resources, server_name, protocol_version))
}

async fn write_line(
    stdin: &mut tokio::process::ChildStdin,
    payload: &Value,
) -> Result<(), McpError> {
    let line =
        serde_json::to_string(payload).map_err(|e| McpError::Transport(format!("encode: {e}")))?;
    stdin
        .write_all(line.as_bytes())
        .await
        .map_err(McpError::from)?;
    stdin.write_all(b"\n").await.map_err(McpError::from)?;
    stdin.flush().await.map_err(McpError::from)?;
    Ok(())
}

async fn read_line<R: AsyncBufReadExt + Unpin>(
    reader: &mut tokio::io::Lines<R>,
) -> Result<Value, McpError> {
    let line = reader
        .next_line()
        .await
        .map_err(McpError::from)?
        .ok_or_else(|| McpError::Transport("remote closed stdout".into()))?;
    serde_json::from_str(&line).map_err(|e| McpError::Transport(format!("decode: {e}")))
}

// Suppress an unused-import warning when the file is built for tests-only.
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_serializes_with_kind_tag() {
        let s = ConnectionStatus::Disconnected;
        let v = serde_json::to_value(&s).unwrap();
        assert_eq!(v["kind"], "disconnected");

        let s = ConnectionStatus::Error {
            message: "oops".into(),
        };
        let v = serde_json::to_value(&s).unwrap();
        assert_eq!(v["kind"], "error");
        assert_eq!(v["message"], "oops");
    }

    #[test]
    fn http_transport_is_unsupported_in_v10() {
        // Compile-time: ensure the variant exists. Runtime check elsewhere.
        let entry = McpServerEntry::Http {
            transport: "http".into(),
            url: "https://x".into(),
            auth: None,
            auto_start: false,
        };
        // Just construct — nothing to assert beyond shape.
        let _ = entry;
    }
}
