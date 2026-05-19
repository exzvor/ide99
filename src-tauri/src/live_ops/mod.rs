//! — Live Ops Dashboard backend.
//!
//! Three read-only Tauri commands (`live_ops_sessions`, `live_ops_slow`,
//! `live_ops_replication`) feed a singleton-per-connection tab in the
//! frontend. All queries hit always-available system catalogs except
//! `pg_stat_statements` (slow), which is checked up-front.

pub mod commands;
pub mod replication;
pub mod sessions;
pub mod slow;
pub mod types;

use crate::live_ops::types::LiveOpsError;

/// Translate a `tokio_postgres` error into our discriminated `LiveOpsError`.
/// Mirrors the shape of `S12::health::commands::classify` but returns a
/// different error type and assumes the only relevant extension is
/// `pg_stat_statements` (used by `live_ops::slow`).
///
/// Takes `tokio_postgres::Error` by value to satisfy the
/// `Result::map_err` callback signature.
#[allow(clippy::needless_pass_by_value)]
pub(crate) fn map_err(e: tokio_postgres::Error) -> LiveOpsError {
    e.as_db_error().map_or_else(        || LiveOpsError::QueryFailed {
            sqlstate: String::new(),
            message: e.to_string(),
        },
        |db| {
            let code = db.code().code();
            let message = db.message();
            // extension is in pg_extension but the C library
            // wasn't preloaded; map to Unavailable with a setup-aware hint
            // so the Slow Queries pane shows the same friendly state as
            // when the extension is missing entirely.
            if message.contains("must be loaded via \"shared_preload_libraries\"") {
                return LiveOpsError::Unavailable {
                    extension: "pg_stat_statements".into(),
                    install_sql:
                        "ALTER SYSTEM SET shared_preload_libraries = 'pg_stat_statements';\n-- then restart PostgreSQL, then:\nCREATE EXTENSION IF NOT EXISTS pg_stat_statements;"
                            .into(),
                };
            }
            match code {
                "42501" => LiveOpsError::Forbidden {
                    required_role: "pg_monitor".into(),
                },
                "42704" | "42883" => LiveOpsError::Unavailable {
                    extension: "pg_stat_statements".into(),
                    install_sql: "CREATE EXTENSION pg_stat_statements;".into(),
                },
                _ => LiveOpsError::QueryFailed {
                    sqlstate: code.into(),
                    message: message.into(),
                },
            }
        },
)
}
