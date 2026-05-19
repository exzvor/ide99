//! — query execution + editor tab persistence.
//!
//! Exposes 4 Tauri commands:
//! - `query_execute(conn_id, sql)` — runs SQL, returns rows (capped at 1000)
//! - `tabs_list()` — list all persisted editor tabs
//! - `tabs_save(tab)` — UPSERT a tab
//! - `tabs_delete(id)` — DELETE a tab by id
//!
//! Pool reuse follows S3 schema commands: lookup `state.pools.get(conn_id)`,
//! return `QueryError::NotConnected` if absent.

pub mod batch;
pub mod commands;
pub mod cursor;
pub mod explain;
pub mod format;
pub mod history;
pub mod jsonb;
pub mod recent_plans;
pub mod tabs;
pub mod types;

pub use types::{ColumnMeta, EditorTabRow, QueryError, QueryResult};
