//! MCP tools — functions invoked by external agents.
//!
//! Split into three families:
//! - [`db`] — PostgreSQL access (list_connections, get_schema, run_query, ...).
//! - [`ide_state`] — read IDE state (get_current_query, get_active_connection, ...).
//! - [`ide_actions`] — drive the IDE (open_query_in_editor, run_in_editor, ...).

#![allow(clippy::missing_errors_doc, clippy::doc_markdown)]

use std::sync::Arc;

use crate::mcp::auth::McpScope;
use crate::mcp::server::{ToolFn, ToolRegistry};

pub mod db;
pub mod ide_actions;
pub mod ide_state;

/// Register all 20 canonical MCP tools onto `r`. Calls override the
/// placeholders that [`ToolRegistry::build_default`] inserts (HashMap
/// inserts replace existing entries by key).
///
/// Idempotent — calling twice replaces with the same closures.
pub fn register_all(r: &mut ToolRegistry) {
    macro_rules! reg {
        ($name:expr, $scope:expr, $f:path) => {{
            // Wrap the async fn in a non-generic closure that pin-boxes its
            // returned future. The HRTB on `ToolFn` requires the future
            // borrow `ctx`/`client` for `'a` — `Box::pin(async move { ... })`
            // captures both by reference, so the lifetime works out.
            let f: ToolFn = Arc::new(|ctx, c, args| Box::pin($f(ctx, c, args)));
            r.register($name, $scope, f);
        }};
    }

    // ---- DB family (10) ----
    reg!(        "list_connections",
        McpScope::DbList,
        db::list_connections_tool
);
    reg!("get_schema", McpScope::DbRead, db::get_schema_tool);
    reg!(        "get_table_sample",
        McpScope::DbRead,
        db::get_table_sample_tool
);
    reg!("run_query", McpScope::DbRead, db::run_query_tool);
    reg!(        "run_query_write",
        McpScope::DbWrite,
        db::run_query_write_tool
);
    reg!("get_explain", McpScope::DbRead, db::get_explain_tool);
    reg!(        "get_health_summary",
        McpScope::DbRead,
        db::get_health_summary_tool
);
    reg!(        "list_slow_queries",
        McpScope::DbRead,
        db::list_slow_queries_tool
);
    reg!(        "dry_run_migration",
        McpScope::DbRead,
        db::dry_run_migration_tool
);
    reg!(        "apply_migration",
        McpScope::DbWrite,
        db::apply_migration_tool
);

    // ---- IDE state family (5) ----
    reg!(        "get_active_connection",
        McpScope::IdeRead,
        ide_state::get_active_connection_tool
);
    reg!(        "get_current_query",
        McpScope::IdeRead,
        ide_state::get_current_query_tool
);
    reg!(        "get_selected_text",
        McpScope::IdeRead,
        ide_state::get_selected_text_tool
);
    reg!(        "get_last_result",
        McpScope::IdeRead,
        ide_state::get_last_result_tool
);
    reg!(        "get_open_tabs",
        McpScope::IdeRead,
        ide_state::get_open_tabs_tool
);

    // ---- IDE actions family (5) ----
    reg!(        "open_query_in_editor",
        McpScope::IdeWrite,
        ide_actions::open_query_in_editor_tool
);
    reg!(        "run_in_editor",
        McpScope::IdeWrite,
        ide_actions::run_in_editor_tool
);
    reg!(        "open_table",
        McpScope::IdeWrite,
        ide_actions::open_table_tool
);
    reg!(        "open_explain_for",
        McpScope::IdeWrite,
        ide_actions::open_explain_for_tool
);
    reg!(        "navigate_to",
        McpScope::IdeWrite,
        ide_actions::navigate_to_tool
);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::server::ToolRegistry;

    #[test]
    fn register_all_registers_twenty_tools() {
        let mut r = ToolRegistry::build_default();
        register_all(&mut r);
        let names = r.list_names();
        assert_eq!(names.len(), 20, "expected exactly 20 tools, got {names:?}");
        for expected in [
            "list_connections",
            "get_schema",
            "get_table_sample",
            "run_query",
            "run_query_write",
            "get_explain",
            "get_health_summary",
            "list_slow_queries",
            "dry_run_migration",
            "apply_migration",
            "get_active_connection",
            "get_current_query",
            "get_selected_text",
            "get_last_result",
            "get_open_tabs",
            "open_query_in_editor",
            "run_in_editor",
            "open_table",
            "open_explain_for",
            "navigate_to",
        ] {
            assert!(                r.get(expected).is_some(),
                "missing tool registration: {expected}"
);
        }
    }

    #[test]
    fn register_all_preserves_canonical_scopes() {
        let mut r = ToolRegistry::build_default();
        register_all(&mut r);
        assert_eq!(r.get("list_connections").unwrap().0, McpScope::DbList);
        assert_eq!(r.get("get_schema").unwrap().0, McpScope::DbRead);
        assert_eq!(r.get("run_query_write").unwrap().0, McpScope::DbWrite);
        assert_eq!(r.get("get_current_query").unwrap().0, McpScope::IdeRead);
        assert_eq!(r.get("open_query_in_editor").unwrap().0, McpScope::IdeWrite);
    }
}
