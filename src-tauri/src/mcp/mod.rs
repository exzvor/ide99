//! MCP server for connecting external AI agents.
//!
//! ide99 exposes a Model Context Protocol (MCP) server so that Claude
//! Code, Cursor, Windsurf, and other LLM tools can work with the user's
//! PostgreSQL database and IDE state through the standard protocol.
//!
//! Architecture: two transports on top of one core.
//! 1. **HTTP/SSE on 127.0.0.1** — embedded mode, runs directly inside
//!    the running ide99. Has full access to [`crate::AppState`] and
//!    sees what the user sees (active connection, current query).
//! 2. **stdio subprocess** — the standalone `ide99-mcp` binary (see
//!    `bin/ide99_mcp.rs`), launched by Claude Code/Cursor; proxies
//!    requests into HTTP mode through a local IPC socket.

#![allow(clippy::doc_markdown)]

pub mod auth;
pub mod client;
pub mod commands;
pub mod ide_bridge;
pub mod resources;
pub mod server;
pub mod store_migration;
pub mod tools;
pub mod transport_http;
pub mod transport_ipc;

pub use client::ClientRegistry;
pub use commands::*;
pub use ide_bridge::IdeBridgeState;
pub use server::{McpError, McpServerHandle, McpServerStatus};
