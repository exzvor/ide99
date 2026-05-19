//! IDE Bridge — shared state between the frontend (React/Monaco) and
//! the MCP tools.
//!
//! This is the part missing from every existing pg-MCP server and the
//! one that sets ide99 MCP apart from a trivial psql wrapper: an
//! external agent sees exactly what the user sees — current active
//! connection, Monaco contents, selected text, last result.
//!
//! Flow: the frontend debounces updates (300 ms) and pushes a snapshot
//! through the Tauri command `mcp_bridge_update`. The backend writes it
//! into `IdeBridgeState` under an `RwLock`. MCP tools (see
//! [`crate::mcp::tools::ide_state`]) read from the bridge when an
//! external agent calls them.
//!
//! Push-only from frontend → backend, to avoid circular updates and to
//! keep MCP from becoming a bi-directional reactive channel.

use serde::{Deserialize, Serialize};

/// Full snapshot of IDE state that the agent can read.
///
/// All fields are Optional or empty by default — the bridge starts safely
/// before the user has opened the first tab.
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdeBridgeState {
    /// ID of the active connection from
    /// [`crate::connection::types::Connection::id`].
    /// `None` means the user is on the Welcome screen.
    pub active_conn_id: Option<String>,

    /// Current contents of the active Monaco editor (full document).
    /// An empty string means there is no active editor tab.
    pub editor_content: String,

    /// Selected range in the editor. `None` means cursor without
    /// selection. Stored as (start, end) char offsets from document start.
    pub editor_selection: Option<(usize, usize)>,

    /// Last executed query — text plus statistics. `None` means there
    /// has been no query execution in this session yet.
    pub last_query: Option<ExecutedQuery>,

    /// Snapshot of the last result (up to 1000 rows to cap overhead).
    /// `None` means there is no result (the last query failed or was DDL).
    pub last_result: Option<ResultSnapshot>,

    /// Open tabs. Used by the `get_open_tabs` tool.
    pub open_tabs: Vec<TabSnapshot>,

    /// True if the user is currently on the Health Screen — gives the
    /// agent context that the user is looking at health metrics.
    pub health_screen_visible: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutedQuery {
    pub sql: String,
    pub conn_id: String,
    pub started_at: String,
    pub duration_ms: u64,
    pub row_count: Option<u64>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultSnapshot {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TabSnapshot {
    pub id: String,
    pub title: String,
    pub conn_id: Option<String>,
    pub kind: TabKind,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TabKind {
    Query,
    ObjectEditor,
    HealthScreen,
    LiveOps,
    Erd,
    Migrations,
}
