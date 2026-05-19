#![allow(
    clippy::cast_possible_truncation,
    clippy::missing_errors_doc,
    clippy::missing_panics_doc,
    clippy::doc_markdown,
    clippy::too_many_lines,
    clippy::needless_pass_by_value,
    clippy::option_if_let_else
)]

//! — one-click fix actions (REINDEX, VACUUM, ANALYZE, DROP INDEX,
//! kill PID) for the Health Screen.
//!
//! The five `do_*` functions build SQL via `quote_qualified` and never receive
//! raw SQL from the frontend; identifier escape happens here. `ActionRegistry`
//! maps `actionId → backend pid` so `health_action_progress` can poll
//! `pg_stat_progress_*` for the right pid.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use deadpool_postgres::Pool;

use crate::health::types::{
    ActionError, ActionKind, ActionResult, ActionStartedPayload, ActionStatus,
};

/// In-memory map of `actionId → ActionEntry`. Populated by each action right
/// before it issues the long-running SQL; cleared on the action's RAII guard
/// `Drop` so panics / cancels don't leak entries.
#[derive(Default)]
pub struct ActionRegistry {
    inner: Mutex<HashMap<String, ActionEntry>>,
}

#[derive(Clone, Copy)]
pub struct ActionEntry {
    pub pid: i32,
    pub kind: ActionKind,
}

/// Removes the entry for `action_id` when this guard is dropped.
///
/// Returned from `ActionRegistry::insert_guard` so callers can hold it
/// across an `await` and have the entry survive only for the action's
/// lifetime.
pub struct RegistryGuard {
    registry: Arc<ActionRegistry>,
    action_id: String,
}

impl Drop for RegistryGuard {
    fn drop(&mut self) {
        if let Ok(mut g) = self.registry.inner.lock() {
            g.remove(&self.action_id);
        }
    }
}

impl ActionRegistry {
    pub fn insert_guard(
        self: &Arc<Self>,
        action_id: &str,
        pid: i32,
        kind: ActionKind,
    ) -> RegistryGuard {
        if let Ok(mut g) = self.inner.lock() {
            g.insert(action_id.to_string(), ActionEntry { pid, kind });
        }
        RegistryGuard {
            registry: Arc::clone(self),
            action_id: action_id.to_string(),
        }
    }

    pub fn get(&self, action_id: &str) -> Option<ActionEntry> {
        self.inner
            .lock()
            .ok()
            .and_then(|g| g.get(action_id).copied())
    }
}

// ─────────────────────────────────────────────────────────────────────────
// Identifier escape helpers (— Task B2).
// ─────────────────────────────────────────────────────────────────────────

#[allow(dead_code)]
pub(crate) fn quote_ident(name: &str) -> Result<String, ActionError> {
    if name.is_empty() || name.len() > 63 || name.contains('\0') {
        return Err(ActionError::ObjectNotFound {
            target: name.to_string(),
        });
    }
    Ok(format!("\"{}\"", name.replace('"', "\"\"")))
}

#[allow(dead_code)]
pub(crate) fn quote_qualified(schema: &str, name: &str) -> Result<String, ActionError> {
    Ok(format!("{}.{}", quote_ident(schema)?, quote_ident(name)?))
}

#[allow(dead_code)]
pub(crate) fn map_err(e: tokio_postgres::Error) -> ActionError {
    if let Some(db) = e.as_db_error() {
        let code = db.code().code();
        match code {
            "42501" => ActionError::Forbidden {
                required: "pg_signal_backend or owner".to_string(),
            },
            "25001" => ActionError::ActiveTransaction,
            "42P01" | "42704" => ActionError::ObjectNotFound {
                target: db.message().to_string(),
            },
            _ => ActionError::QueryFailed {
                sqlstate: code.to_string(),
                message: db.message().to_string(),
            },
        }
    } else {
        ActionError::QueryFailed {
            sqlstate: String::new(),
            message: e.to_string(),
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────
// Five action functions (— Tasks B3..B7).
// ─────────────────────────────────────────────────────────────────────────

pub async fn do_reindex_table_inner(
    pool: &Pool,
    registry: &Arc<ActionRegistry>,
    schema: &str,
    table: &str,
) -> Result<ActionResult, ActionError> {
    let started = Instant::now();
    let action_id = uuid::Uuid::new_v4().to_string();
    let qualified = quote_qualified(schema, table)?;
    let client = pool.get().await.map_err(|_| ActionError::NotConnected)?;
    let pid: i32 = client
        .query_one("SELECT pg_backend_pid()", &[])
        .await
        .map_err(map_err)?
        .get(0);
    let _guard = registry.insert_guard(&action_id, pid, ActionKind::ReindexTable);
    client
        .batch_execute(&format!("REINDEX TABLE CONCURRENTLY {qualified}"))
        .await
        .map_err(map_err)?;
    Ok(ActionResult {
        action_id,
        duration_ms: started.elapsed().as_millis() as u64,
        status: ActionStatus::Completed,
    })
}

pub async fn do_reindex_table(
    pool: &Pool,
    registry: &Arc<ActionRegistry>,
    app: &tauri::AppHandle,
    schema: &str,
    table: &str,
) -> Result<ActionResult, ActionError> {
    let started = Instant::now();
    let action_id = uuid::Uuid::new_v4().to_string();
    let qualified = quote_qualified(schema, table)?;
    let client = pool.get().await.map_err(|_| ActionError::NotConnected)?;
    let pid: i32 = client
        .query_one("SELECT pg_backend_pid()", &[])
        .await
        .map_err(map_err)?
        .get(0);
    let _guard = registry.insert_guard(&action_id, pid, ActionKind::ReindexTable);
    emit_started(
        app,
        &ActionStartedPayload {
            action_id: action_id.clone(),
            pid,
        },
    )?;
    client
        .batch_execute(&format!("REINDEX TABLE CONCURRENTLY {qualified}"))
        .await
        .map_err(map_err)?;
    Ok(ActionResult {
        action_id,
        duration_ms: started.elapsed().as_millis() as u64,
        status: ActionStatus::Completed,
    })
}

pub async fn do_vacuum_inner(
    pool: &Pool,
    registry: &Arc<ActionRegistry>,
    schema: &str,
    table: &str,
) -> Result<ActionResult, ActionError> {
    let started = Instant::now();
    let action_id = uuid::Uuid::new_v4().to_string();
    let qualified = quote_qualified(schema, table)?;
    let client = pool.get().await.map_err(|_| ActionError::NotConnected)?;
    let pid: i32 = client
        .query_one("SELECT pg_backend_pid()", &[])
        .await
        .map_err(map_err)?
        .get(0);
    let _guard = registry.insert_guard(&action_id, pid, ActionKind::Vacuum);
    client
        .batch_execute(&format!("VACUUM {qualified}"))
        .await
        .map_err(map_err)?;
    Ok(ActionResult {
        action_id,
        duration_ms: started.elapsed().as_millis() as u64,
        status: ActionStatus::Completed,
    })
}

pub async fn do_vacuum(
    pool: &Pool,
    registry: &Arc<ActionRegistry>,
    app: &tauri::AppHandle,
    schema: &str,
    table: &str,
) -> Result<ActionResult, ActionError> {
    let started = Instant::now();
    let action_id = uuid::Uuid::new_v4().to_string();
    let qualified = quote_qualified(schema, table)?;
    let client = pool.get().await.map_err(|_| ActionError::NotConnected)?;
    let pid: i32 = client
        .query_one("SELECT pg_backend_pid()", &[])
        .await
        .map_err(map_err)?
        .get(0);
    let _guard = registry.insert_guard(&action_id, pid, ActionKind::Vacuum);
    emit_started(
        app,
        &ActionStartedPayload {
            action_id: action_id.clone(),
            pid,
        },
    )?;
    client
        .batch_execute(&format!("VACUUM {qualified}"))
        .await
        .map_err(map_err)?;
    Ok(ActionResult {
        action_id,
        duration_ms: started.elapsed().as_millis() as u64,
        status: ActionStatus::Completed,
    })
}

pub async fn do_analyze(
    pool: &Pool,
    schema: &str,
    table: &str,
) -> Result<ActionResult, ActionError> {
    let started = Instant::now();
    let action_id = uuid::Uuid::new_v4().to_string();
    let qualified = quote_qualified(schema, table)?;
    let client = pool.get().await.map_err(|_| ActionError::NotConnected)?;
    client
        .batch_execute(&format!("ANALYZE {qualified}"))
        .await
        .map_err(map_err)?;
    Ok(ActionResult {
        action_id,
        duration_ms: started.elapsed().as_millis() as u64,
        status: ActionStatus::Completed,
    })
}

pub async fn do_drop_index(
    pool: &Pool,
    schema: &str,
    index: &str,
) -> Result<ActionResult, ActionError> {
    let started = Instant::now();
    let action_id = uuid::Uuid::new_v4().to_string();
    let qualified = quote_qualified(schema, index)?;
    let client = pool.get().await.map_err(|_| ActionError::NotConnected)?;
    client
        .batch_execute(&format!("DROP INDEX CONCURRENTLY {qualified}"))
        .await
        .map_err(map_err)?;
    Ok(ActionResult {
        action_id,
        duration_ms: started.elapsed().as_millis() as u64,
        status: ActionStatus::Completed,
    })
}

pub async fn do_kill_pid(
    pool: &Pool,
    pid: i32,
    terminate: bool,
) -> Result<ActionResult, ActionError> {
    let started = Instant::now();
    let action_id = uuid::Uuid::new_v4().to_string();
    let client = pool.get().await.map_err(|_| ActionError::NotConnected)?;
    let fn_name = if terminate {
        "pg_terminate_backend"
    } else {
        "pg_cancel_backend"
    };
    let row = client
        .query_one(&format!("SELECT {fn_name}($1)"), &[&pid])
        .await
        .map_err(map_err)?;
    let ok: bool = row.get(0);
    let status = if !ok {
        ActionStatus::NotFound
    } else if terminate {
        ActionStatus::Terminated
    } else {
        ActionStatus::Completed
    };
    Ok(ActionResult {
        action_id,
        duration_ms: started.elapsed().as_millis() as u64,
        status,
    })
}

pub async fn check_pid(pool: &Pool, pid: i32) -> Result<bool, ActionError> {
    let client = pool.get().await.map_err(|_| ActionError::NotConnected)?;
    let row = client
        .query_opt(
            "SELECT 1 FROM pg_stat_activity WHERE pid = $1 AND state IS DISTINCT FROM 'idle'",
            &[&pid],
        )
        .await
        .map_err(map_err)?;
    Ok(row.is_some())
}

pub async fn read_progress(
    pool: &Pool,
    entry: ActionEntry,
) -> Result<(String, Option<i64>, Option<i64>), ActionError> {
    let client = pool.get().await.map_err(|_| ActionError::NotConnected)?;
    let res = match entry.kind {
        ActionKind::Vacuum => client
            .query_opt(
                "SELECT phase, heap_blks_total, heap_blks_scanned
                   FROM pg_stat_progress_vacuum
                  WHERE pid = $1",
                &[&entry.pid],
            )
            .await
            .map_err(map_err)?
            .map(|r| {
                let phase: String = r.get(0);
                let total: Option<i64> = r.get(1);
                let scanned: Option<i64> = r.get(2);
                (phase, scanned, total)
            }),
        ActionKind::ReindexTable => client
            .query_opt(
                "SELECT phase, blocks_total, blocks_done
                   FROM pg_stat_progress_create_index
                  WHERE pid = $1",
                &[&entry.pid],
            )
            .await
            .map_err(map_err)?
            .map(|r| {
                let phase: String = r.get(0);
                let total: Option<i64> = r.get(1);
                let done: Option<i64> = r.get(2);
                (phase, done, total)
            }),
        _ => None,
    };
    Ok(res.unwrap_or_else(|| ("starting".to_string(), None, None)))
}

/// Build + emit the started event. Used by `do_vacuum` and `do_reindex_table`
/// only — short actions don't bother. Pulled into a helper because both call
/// sites do the same JSON build.
pub(crate) fn emit_started(
    app: &tauri::AppHandle,
    payload: &ActionStartedPayload,
) -> Result<(), ActionError> {
    use tauri::Emitter;
    app.emit("health-action-started", payload)
        .map_err(|e| ActionError::QueryFailed {
            sqlstate: String::new(),
            message: e.to_string(),
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::health::types::ActionKind;

    #[test]
    fn registry_inserts_and_clears_via_guard() {
        let reg = Arc::new(ActionRegistry::default());
        {
            let _g = reg.insert_guard("a1", 1234, ActionKind::Vacuum);
            assert_eq!(reg.get("a1").unwrap().pid, 1234);
            assert!(matches!(reg.get("a1").unwrap().kind, ActionKind::Vacuum));
        }
        assert!(reg.get("a1").is_none(), "guard drop must clear entry");
    }

    #[test]
    fn registry_handles_concurrent_actions() {
        let reg = Arc::new(ActionRegistry::default());
        let _g1 = reg.insert_guard("a1", 1, ActionKind::Vacuum);
        let _g2 = reg.insert_guard("a2", 2, ActionKind::ReindexTable);
        assert_eq!(reg.get("a1").unwrap().pid, 1);
        assert_eq!(reg.get("a2").unwrap().pid, 2);
    }

    #[test]
    fn quote_ident_doubles_quotes() {
        assert_eq!(quote_ident("users").unwrap(), "\"users\"");
        assert_eq!(quote_ident("we\"ird").unwrap(), "\"we\"\"ird\"");
    }

    #[test]
    fn quote_ident_rejects_empty_long_or_nul() {
        assert!(quote_ident("").is_err());
        let too_long = "a".repeat(64);
        assert!(quote_ident(&too_long).is_err());
        assert!(quote_ident("a\0b").is_err());
    }

    #[test]
    fn quote_qualified_combines() {
        assert_eq!(
            quote_qualified("public", "users").unwrap(),
            "\"public\".\"users\""
        );
    }
}
