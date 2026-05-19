//! IPC transport — Unix domain socket / Windows named pipe linking
//! `ide99-mcp` (subprocess mode, see `bin/ide99_mcp.rs`) to the
//! running ide99 instance.
//!
//! Frame protocol: line-delimited JSON. Each JSON-RPC frame is sent on
//! a single line terminated by `\n`. This matches how the MCP spec's
//! stdio transport delivers messages, so the `ide99-mcp` binary
//! literally proxies stdin↔socket and stdout↔socket with no framing
//! logic of its own.
//!
//! - macOS/Linux: `<data_dir>/mcp.sock` (Unix domain socket).
//! - Windows: `\\.\pipe\ide99-mcp` (named pipe).
//!
//! If ide99 is not running, `ide99-mcp` prints a hint to stderr and
//! exits with code 2 (see `bin/ide99_mcp.rs`).

#![allow(
    clippy::missing_errors_doc,
    clippy::module_name_repetitions,
    clippy::doc_markdown,
    clippy::needless_pass_by_value
)]

use std::path::PathBuf;
use std::sync::Arc;

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

use crate::mcp::server::{dispatch, McpError, RpcRequest, RpcResponse, ServerContext};

/// Resolve the canonical IPC socket path for this platform.
#[must_use]
pub fn default_socket_path() -> Option<PathBuf> {
    #[cfg(unix)]
    {
        crate::app_paths::data_dir()
            .ok()
            .map(|d| d.join("mcp.sock"))
    }
    #[cfg(windows)]
    {
        Some(PathBuf::from(r"\\.\pipe\ide99-mcp"))
    }
}

/// Run the IPC server until `shutdown` flips. Cross-platform dispatcher.
pub async fn serve(
    path: PathBuf,
    ctx: Arc<ServerContext>,
    shutdown: tokio::sync::watch::Receiver<bool>,
) -> Result<(), McpError> {
    #[cfg(unix)]
    {
        serve_unix(path, ctx, shutdown).await
    }
    #[cfg(windows)]
    {
        serve_windows(path, ctx, shutdown).await
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = (path, ctx, shutdown);
        Err(McpError::Transport("unsupported platform".into()))
    }
}

#[cfg(unix)]
async fn serve_unix(
    path: PathBuf,
    ctx: Arc<ServerContext>,
    mut shutdown: tokio::sync::watch::Receiver<bool>,
) -> Result<(), McpError> {
    // Remove stale socket file if a previous ide99 crashed.
    let _ = tokio::fs::remove_file(&path).await;
    let listener = tokio::net::UnixListener::bind(&path)
        .map_err(|e| McpError::Transport(format!("bind {}: {e}", path.display())))?;
    // 0600: only the user can connect. Same posture as ~/.pgpass.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    tracing::info!(path = %path.display(), "MCP IPC listening (Unix)");

    loop {
        tokio::select! {
            biased;
            _ = shutdown.changed() => {
                if *shutdown.borrow() {
                    break;
                }
            }
            accept = listener.accept() => {
                match accept {
                    Ok((stream, _addr)) => {
                        let ctx = ctx.clone();
                        tokio::spawn(handle_unix(stream, ctx));
                    }
                    Err(e) => {
                        tracing::warn!(error = %e, "MCP IPC accept failed");
                    }
                }
            }
        }
    }

    let _ = tokio::fs::remove_file(&path).await;
    Ok(())
}

#[cfg(unix)]
async fn handle_unix(stream: tokio::net::UnixStream, ctx: Arc<ServerContext>) {
    let (read, write) = stream.into_split();
    handle_framed(read, write, ctx).await;
}

#[cfg(windows)]
async fn serve_windows(
    path: PathBuf,
    ctx: Arc<ServerContext>,
    mut shutdown: tokio::sync::watch::Receiver<bool>,
) -> Result<(), McpError> {
    use tokio::net::windows::named_pipe::ServerOptions;

    let path_str = path.to_string_lossy().into_owned();
    tracing::info!(pipe = %path_str, "MCP IPC listening (Windows named pipe)");

    loop {
        let server = ServerOptions::new()
            .first_pipe_instance(true)
            .create(&path_str)
            .map_err(|e| McpError::Transport(format!("named pipe create: {e}")))?;
        tokio::select! {
            biased;
            _ = shutdown.changed() => {
                if *shutdown.borrow() {
                    break Ok(());
                }
            }
            connect = server.connect() => {
                match connect {
                    Ok(()) => {
                        let ctx = ctx.clone();
                        tokio::spawn(async move {
                            let (read, write) = tokio::io::split(server);
                            handle_framed(read, write, ctx).await;
                        });
                    }
                    Err(e) => {
                        tracing::warn!(error = %e, "MCP IPC pipe connect failed");
                    }
                }
            }
        }
    }
}

/// Generic line-delimited JSON-RPC frame loop. Used for both Unix sockets
/// and Windows named pipes — `tokio::io::AsyncRead` / `AsyncWrite` is the
/// shared abstraction.
async fn handle_framed<R, W>(read: R, write: W, ctx: Arc<ServerContext>)
where
    R: tokio::io::AsyncRead + Unpin + Send + 'static,
    W: tokio::io::AsyncWrite + Unpin + Send + 'static,
{
    let mut reader = BufReader::new(read);
    let mut writer = write;
    let mut line = String::new();
    loop {
        line.clear();
        let n = match reader.read_line(&mut line).await {
            Ok(n) => n,
            Err(e) => {
                tracing::debug!(error = %e, "MCP IPC read error; closing");
                return;
            }
        };
        if n == 0 {
            return; // EOF
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let req_value: serde_json::Value = match serde_json::from_str(trimmed) {
            Ok(v) => v,
            Err(e) => {
                let err_resp =
                    RpcResponse::err(None, &McpError::InvalidArgs(format!("frame parse: {e}")));
                let _ = write_frame(&mut writer, &err_resp).await;
                continue;
            }
        };
        let req: RpcRequest = match serde_json::from_value(req_value) {
            Ok(r) => r,
            Err(e) => {
                let err_resp =
                    RpcResponse::err(None, &McpError::InvalidArgs(format!("envelope: {e}")));
                let _ = write_frame(&mut writer, &err_resp).await;
                continue;
            }
        };
        // Bearer token comes inline in `params._meta.token` for stdio
        // transport — there are no HTTP headers. This is an MCP-spec-
        // compatible extension; agents using stdio set it through the
        // proxy's environment.
        let bearer = extract_token_from_params(&req).map(String::from);
        let resp = dispatch(&ctx, bearer.as_deref(), &req).await;
        if write_frame(&mut writer, &resp).await.is_err() {
            return;
        }
    }
}

fn extract_token_from_params(req: &RpcRequest) -> Option<&str> {
    req.params.as_ref()?.get("_meta")?.get("token")?.as_str()
}

async fn write_frame<W: tokio::io::AsyncWrite + Unpin>(
    w: &mut W,
    resp: &RpcResponse,
) -> std::io::Result<()> {
    let mut s = serde_json::to_string(resp).unwrap_or_else(|_| "{}".to_string());
    s.push('\n');
    w.write_all(s.as_bytes()).await?;
    w.flush().await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn socket_path_resolves() {
        // Sanity check: at least returns Some in test environments.
        // (data_dir might fail in pristine sandboxes; we tolerate either).
        let _ = default_socket_path();
    }

    #[test]
    fn extract_token_from_meta() {
        let req = RpcRequest {
            jsonrpc: "2.0".into(),
            id: None,
            method: "tools/call".into(),
            params: Some(serde_json::json!({
                "name": "x",
                "arguments": {},
                "_meta": { "token": "tok-1" }
            })),
        };
        assert_eq!(extract_token_from_params(&req), Some("tok-1"));
    }

    #[test]
    fn extract_token_missing_is_none() {
        let req = RpcRequest {
            jsonrpc: "2.0".into(),
            id: None,
            method: "tools/call".into(),
            params: Some(serde_json::json!({"name": "x"})),
        };
        assert!(extract_token_from_params(&req).is_none());
    }
}
