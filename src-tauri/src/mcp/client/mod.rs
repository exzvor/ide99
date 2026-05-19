//! MCP **client** for connecting ide99 to external MCP servers
//! (Linear, GitHub, company-glossary, ...).
//!
//! The server side lets external agents connect to ide99; the client
//! side makes ide99 a client of other MCP servers. In v1.0 this is
//! **read-only**: we call `tools/list` + `resources/list` but we **do
//! not invoke write-tagged tools** (we have no in-house AI that would
//! initiate them). When v1.1+ ships in-house AI features, they will be
//! able to read context from here.
//!
//! Architecture:
//! - [`config`] — `~/.config/ide99/mcp-servers.json` schema + load/save.
//! - [`connection`] — a single connection: stdio subprocess or HTTP/SSE.
//! - [`registry`] — `Arc<RwLock<HashMap>>` of all active connections.
//! - [`commands`] — IPC handlers for the Settings UI.

pub mod commands;
pub mod config;
pub mod connection;
pub mod registry;

pub use commands::*;
pub use config::{ExternalServerConfig, McpClientConfig, McpServerEntry};
pub use connection::{ClientConnection, ConnectionStatus};
pub use registry::ClientRegistry;
