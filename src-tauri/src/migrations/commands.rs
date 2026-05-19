//! Tauri command handlers for the native migration engine .
//!
//! All bodies are filled in here per Phase C; the 9 signatures (set/clear dir,
//! list, apply, rollback, preview up/down, diff snapshots, set options) are
//! frozen by `lib.rs::generate_handler!` and the spec.
//!
//! ## Apply / Rollback progress events
//!
//! The spec asks for `migrations:apply-progress` events fired for each
//! migration as it runs (`phase: "running" | "done" | "failed"`). Two
//! candidate designs were considered:
//!
//! 1. Pass an event callback into `executor::apply` so the executor itself
//! fires progress events.
//! 2. Drive the per-migration loop here in `commands.rs`, calling
//! `executor::apply(...)` once per migration with `ApplyMode::Single` and
//! emitting events between calls.
//!
//! We chose **option 2**: it keeps the executor purely a SQL/transaction
//! orchestrator with no Tauri/AppHandle coupling, and it makes the progress
//! event semantics trivial to reason about in tests (no inter-task event
//! sequencing). The trade-off is that the executor receives a one-element
//! slice per call — which is fine for "Apply All Pending" sized jobs (≤ tens
//! to low hundreds of migrations); we don't need the executor's batch
//! optimization here.

#![allow(clippy::missing_errors_doc, clippy::missing_panics_doc)]

use std::path::Path;

use serde_json::json;
use tauri::{AppHandle, Emitter, State};

use crate::migrations::types::{
    AppliedEntry, ApplyFailure, ApplyMode, ApplyResult, DiffResult, ListResult, Migration,
    MigrationStatus, MigrationsError, RollbackResult, SqlPreview, WatcherHandle,
};
use crate::migrations::{discovery, executor, snapshot, tracking, watcher};
use crate::AppState;

// --- helpers ------------------------------------------------------------

/// Look up the connection metadata, mapping `NotFound` → `ConnectionNotFound`.
async fn load_connection(
    state: &AppState,
    conn_id: &str,
) -> Result<crate::connection::types::Connection, MigrationsError> {
    let store = state.store.lock().await;
    store.get_by_id(conn_id).map_err(|e| match e {
        crate::connection::ConnectionError::NotFound(id) => MigrationsError::ConnectionNotFound(id),
        other => MigrationsError::Storage(format!("{other}")),
    })
}

/// Acquire a pool client for `conn_id`, surfacing `NotConnected` when the
/// pool isn't registered (i.e. user hasn't connected via `connection_connect`).
async fn pool_client(
    state: &AppState,
    conn_id: &str,
) -> Result<deadpool_postgres::Object, MigrationsError> {
    let pool = state
        .pools
        .get(conn_id)
        .await
        .ok_or_else(|| MigrationsError::NotConnected(conn_id.to_string()))?;
    pool.get()
        .await
        .map_err(|e| MigrationsError::Postgres(e.to_string()))
}

/// Run discovery + ledger join for `conn_id`. Returns the merged migration
/// list and a flag indicating whether the tracking table is missing
/// (true when `tracking_enabled` and the table is absent — UI can prompt to
/// create it on first apply).
async fn list_with_ledger(
    state: &AppState,
    conn_id: &str,
) -> Result<(Vec<Migration>, bool), MigrationsError> {
    let conn = load_connection(state, conn_id).await?;
    let dir = conn
        .migrations_dir
        .as_deref()
        .ok_or(MigrationsError::DirNotSet)?;
    let disk = discovery::discover(Path::new(dir))?;

    // If the connection isn't open yet, return discovery-only data — the FE
    // can still render the timeline as "all pending" prior to connect.
    let Ok(client) = pool_client(state, conn_id).await else {
        return Ok((disk, false));
    };

    if !conn.migration_tracking_enabled {
        return Ok((disk, false));
    }

    if !tracking::table_exists(&client).await? {
        return Ok((disk, true));
    }

    let ledger = tracking::list_applied(&client).await?;
    let merged = tracking::join_with_ledger(disk, ledger);
    Ok((merged, false))
}

/// Drop and replace the watcher for `conn_id`, if any. The dropped handle's
/// task ends gracefully when its oneshot stop fires (or when the handle is
/// dropped, which closes the oneshot's receiver and breaks the loop).
async fn replace_watcher(state: &AppState, conn_id: &str, new_handle: Option<WatcherHandle>) {
    let mut map = state.migration_watchers.write().await;
    if let Some(prev) = map.remove(conn_id) {
        // Send on the oneshot so the blocking task notices on its next poll.
        let _ = prev.stop.send(());
    }
    if let Some(h) = new_handle {
        map.insert(conn_id.to_string(), h);
    }
}

// --- commands -----------------------------------------------------------

#[tauri::command]
pub async fn migrations_set_dir(
    state: State<'_, AppState>,
    app: AppHandle,
    conn_id: String,
    dir: String,
) -> Result<(), MigrationsError> {
    // Persist first so the FE can re-render even if watcher spawn fails.
    {
        let store = state.store.lock().await;
        store
            .set_migrations_dir(&conn_id, Some(&dir))
            .map_err(|e| MigrationsError::Storage(format!("{e}")))?;
    }

    // Spawn fresh watcher; emit `migrations:dir-changed` for each debounced burst.
    let app_for_cb = app.clone();
    let conn_id_for_cb = conn_id.clone();
    let cb: watcher::WatcherCallback = Box::new(move || {
        let _ = app_for_cb.emit(
            "migrations:dir-changed",
            json!({ "connId": conn_id_for_cb }),
        );
    });

    let handle = watcher::spawn_watcher(std::path::PathBuf::from(&dir), cb).await?;
    replace_watcher(&state, &conn_id, Some(handle)).await;

    Ok(())
}

#[tauri::command]
pub async fn migrations_clear_dir(
    state: State<'_, AppState>,
    conn_id: String,
) -> Result<(), MigrationsError> {
    {
        let store = state.store.lock().await;
        store
            .set_migrations_dir(&conn_id, None)
            .map_err(|e| MigrationsError::Storage(format!("{e}")))?;
    }
    replace_watcher(&state, &conn_id, None).await;
    Ok(())
}

#[tauri::command]
pub async fn migrations_list(
    state: State<'_, AppState>,
    app: AppHandle,
    conn_id: String,
) -> Result<ListResult, MigrationsError> {
    let conn = load_connection(&state, &conn_id).await?;
    let (migrations, tracking_table_missing) = list_with_ledger(&state, &conn_id).await?;

    // auto-spawn the fs watcher if the connection has a
    // persisted migrations_dir but no live watcher (typical after restart:
    // the persisted dir is loaded but `migrations_set_dir` was never called
    // again, so the listener never started).
    if let Some(dir) = conn.migrations_dir.as_deref() {
        let needs_spawn = {
            let map = state.migration_watchers.read().await;
            !map.contains_key(&conn_id)
        };
        if needs_spawn {
            let app_for_cb = app.clone();
            let conn_id_for_cb = conn_id.clone();
            let cb: watcher::WatcherCallback = Box::new(move || {
                let _ = app_for_cb.emit(
                    "migrations:dir-changed",
                    json!({ "connId": conn_id_for_cb }),
                );
            });
            // Watcher spawn errors are non-fatal for `list` — log and
            // proceed; the user still sees the timeline.
            match watcher::spawn_watcher(std::path::PathBuf::from(dir), cb).await {
                Ok(handle) => {
                    let mut map = state.migration_watchers.write().await;
                    map.entry(conn_id.clone()).or_insert(handle);
                }
                Err(e) => {
                    tracing::warn!(                        conn_id,
                                            dir,
                                            error = %e,
                                            "could not auto-spawn migrations watcher",
                    );
                }
            }
        }
    }

    Ok(ListResult {
        migrations,
        tracking_table_missing,
        // surface persisted state so the panel can hydrate
        // its zustand store on first render after restart.
        migrations_dir: conn.migrations_dir.clone(),
        tracking_enabled: conn.migration_tracking_enabled,
        snapshots_enabled: conn.migration_snapshots_enabled,
    })
}

/// Helper: emit a `migrations:apply-progress` event. Failures are logged
/// (event delivery isn't load-bearing for correctness) so progress events
/// never short-circuit a successful migration.
/// Build the JSON payload for an apply/rollback progress event. `durationMs`
/// is included only when present so frontend listeners can `if (msg.durationMs)`
/// without spurious nulls.
fn progress_payload(
    conn_id: &str,
    version: &str,
    phase: &str,
    duration_ms: Option<i64>,
) -> serde_json::Value {
    let mut obj = json!({
        "connId": conn_id,
        "version": version,
        "phase": phase,
    });
    if let Some(ms) = duration_ms {
        obj["durationMs"] = json!(ms);
    }
    obj
}

fn emit_apply_progress(
    app: &AppHandle,
    conn_id: &str,
    version: &str,
    phase: &str,
    duration_ms: Option<i64>,
) {
    let payload = progress_payload(conn_id, version, phase, duration_ms);
    if let Err(e) = app.emit("migrations:apply-progress", payload) {
        tracing::warn!(error = %e, "failed to emit migrations:apply-progress");
    }
}

fn emit_rollback_progress(
    app: &AppHandle,
    conn_id: &str,
    version: &str,
    phase: &str,
    duration_ms: Option<i64>,
) {
    let payload = progress_payload(conn_id, version, phase, duration_ms);
    if let Err(e) = app.emit("migrations:rollback-progress", payload) {
        tracing::warn!(error = %e, "failed to emit migrations:rollback-progress");
    }
}

/// Build the slice of migrations to run for the given `mode`. Pulls from the
/// merged list + applies range/single filters per the spec.
fn select_for_apply<'a>(
    merged: &'a [Migration],
    mode: &ApplyMode,
) -> Result<Vec<&'a Migration>, MigrationsError> {
    // Pending = anything not in `Applied` status (Dirty rows still need user
    // attention, not auto-apply, so we exclude them too).
    let pending_versions: Vec<String> = merged
        .iter()
        .filter(|m| m.status == MigrationStatus::Pending && m.parse_error.is_none())
        .map(|m| m.version.clone())
        .collect();

    match mode {
        ApplyMode::Single { version } => {
            let m = merged
                .iter()
                .find(|m| m.version == *version)
                .ok_or_else(|| MigrationsError::NotFound(version.clone()))?;
            // refuse parse-error rows here (defense in depth;
            // executor::select_targets also checks). Gives a cleaner error
            // path than the executor for the orchestration layer.
            if let Some(err) = &m.parse_error {
                return Err(MigrationsError::HasParseError {
                    version: m.version.clone(),
                    error: err.clone(),
                });
            }
            Ok(vec![m])
        }
        ApplyMode::Range { from, to } => {
            if !discovery::is_contiguous_range(&pending_versions, from, to) {
                return Err(MigrationsError::RangeNonContiguous {
                    from: from.clone(),
                    to: to.clone(),
                });
            }
            let from_idx = pending_versions.iter().position(|v| v == from).unwrap();
            let to_idx = pending_versions.iter().position(|v| v == to).unwrap();
            let slice = &pending_versions[from_idx..=to_idx];
            Ok(merged
                .iter()
                .filter(|m| slice.contains(&m.version))
                .collect())
        }
        ApplyMode::AllPending => Ok(merged
            .iter()
            .filter(|m| pending_versions.contains(&m.version))
            .collect()),
    }
}

#[tauri::command]
pub async fn migrations_apply(
    state: State<'_, AppState>,
    app: AppHandle,
    conn_id: String,
    mode: ApplyMode,
) -> Result<ApplyResult, MigrationsError> {
    let conn = load_connection(&state, &conn_id).await?;
    let client = pool_client(&state, &conn_id).await?;

    let (merged, _missing) = list_with_ledger(&state, &conn_id).await?;
    let selected = select_for_apply(&merged, &mode)?;

    let mut applied_out: Vec<AppliedEntry> = Vec::new();
    let mut failed: Option<ApplyFailure> = None;

    for migration in selected {
        emit_apply_progress(&app, &conn_id, &migration.version, "running", None);

        // Run the executor for this single migration. Per the design notes,
        // we drive the per-migration loop here so progress events are easy to
        // sequence — the executor itself is purely a SQL/tx orchestrator.
        let one_slice: Vec<Migration> = vec![migration.clone()];
        let opts = executor::ApplyOptions {
            client: &client,
            tracking_enabled: conn.migration_tracking_enabled,
            migrations: &one_slice,
            mode: ApplyMode::Single {
                version: migration.version.clone(),
            },
        };
        let result = executor::apply(opts).await?;

        if let Some(failure) = result.failed {
            emit_apply_progress(&app, &conn_id, &failure.version, "failed", None);
            failed = Some(failure);
            break; // Stop on first failure (matches spec §6.2).
        }

        for entry in result.applied {
            emit_apply_progress(
                &app,
                &conn_id,
                &entry.version,
                "done",
                Some(entry.duration_ms),
            );

            // Capture schema snapshot if enabled. Per spec §6.1 step 5,
            // snapshot failures must NOT roll back the migration — log + skip.
            if conn.migration_snapshots_enabled {
                match snapshot::capture(&client).await {
                    Ok(blob) => {
                        if let Err(e) = tracking::set_snapshot(&client, &entry.version, &blob).await
                        {
                            tracing::warn!(                                version = entry.version,
                                                            error = %e,
                                                            "snapshot persist failed (migration applied successfully)",
                            );
                        }
                    }
                    Err(e) => tracing::warn!(                        version = entry.version,
                                            error = %e,
                                            "snapshot capture failed (migration applied successfully)",
                    ),
                }
            }

            applied_out.push(entry);
        }
    }

    Ok(ApplyResult {
        applied: applied_out,
        failed,
    })
}

#[tauri::command]
pub async fn migrations_rollback(
    state: State<'_, AppState>,
    app: AppHandle,
    conn_id: String,
    version: String,
) -> Result<RollbackResult, MigrationsError> {
    let conn = load_connection(&state, &conn_id).await?;
    let client = pool_client(&state, &conn_id).await?;

    let (merged, _missing) = list_with_ledger(&state, &conn_id).await?;
    let migration = merged
        .iter()
        .find(|m| m.version == version)
        .ok_or_else(|| MigrationsError::NotFound(version.clone()))?;

    if migration.down_path.is_none() {
        return Err(MigrationsError::RollbackFileMissing(version));
    }

    emit_rollback_progress(&app, &conn_id, &version, "running", None);

    let result = executor::rollback(&client, conn.migration_tracking_enabled, migration).await?;

    let phase = if result.error.is_some() {
        "failed"
    } else {
        "done"
    };
    // We don't have a duration_ms field on RollbackResult per the DTO, so
    // leave the `durationMs` field absent in the event.
    emit_rollback_progress(&app, &conn_id, &version, phase, None);

    Ok(result)
}

#[tauri::command]
pub async fn migrations_preview_up(
    state: State<'_, AppState>,
    conn_id: String,
    version: String,
) -> Result<SqlPreview, MigrationsError> {
    let conn = load_connection(&state, &conn_id).await?;
    let dir = conn
        .migrations_dir
        .as_deref()
        .ok_or(MigrationsError::DirNotSet)?;
    let disk = discovery::discover(Path::new(dir))?;
    let migration = disk
        .iter()
        .find(|m| m.version == version)
        .ok_or_else(|| MigrationsError::NotFound(version.clone()))?;
    if migration.up_path.is_empty() {
        return Err(MigrationsError::NotFound(version));
    }
    let sql = std::fs::read_to_string(&migration.up_path)
        .map_err(|e| MigrationsError::Io(e.to_string()))?;
    Ok(SqlPreview { sql })
}

#[tauri::command]
pub async fn migrations_preview_down(
    state: State<'_, AppState>,
    conn_id: String,
    version: String,
) -> Result<SqlPreview, MigrationsError> {
    let conn = load_connection(&state, &conn_id).await?;
    let dir = conn
        .migrations_dir
        .as_deref()
        .ok_or(MigrationsError::DirNotSet)?;
    let disk = discovery::discover(Path::new(dir))?;
    let migration = disk
        .iter()
        .find(|m| m.version == version)
        .ok_or_else(|| MigrationsError::NotFound(version.clone()))?;
    let down_path = migration
        .down_path
        .as_deref()
        .ok_or_else(|| MigrationsError::RollbackFileMissing(version.clone()))?;
    let sql = std::fs::read_to_string(down_path).map_err(|e| MigrationsError::Io(e.to_string()))?;
    Ok(SqlPreview { sql })
}

#[tauri::command]
pub async fn migrations_diff_snapshots(
    state: State<'_, AppState>,
    conn_id: String,
    from_version: String,
    to_version: String,
) -> Result<DiffResult, MigrationsError> {
    let conn = load_connection(&state, &conn_id).await?;
    if !conn.migration_snapshots_enabled {
        return Err(MigrationsError::SnapshotsDisabled);
    }
    let client = pool_client(&state, &conn_id).await?;

    let from_blob = tracking::get_snapshot(&client, &from_version)
        .await?
        .ok_or_else(|| MigrationsError::SnapshotMissing(from_version.clone()))?;
    let to_blob = tracking::get_snapshot(&client, &to_version)
        .await?
        .ok_or_else(|| MigrationsError::SnapshotMissing(to_version.clone()))?;

    let from_text = snapshot::decompress(&from_blob)?;
    let to_text = snapshot::decompress(&to_blob)?;

    Ok(DiffResult {
        unified_diff: snapshot::unified_diff(&from_text, &to_text),
    })
}

#[tauri::command]
pub async fn migrations_set_options(
    state: State<'_, AppState>,
    conn_id: String,
    tracking_enabled: bool,
    snapshots_enabled: bool,
) -> Result<(), MigrationsError> {
    {
        let store = state.store.lock().await;
        store
            .set_migration_tracking_enabled(&conn_id, tracking_enabled)
            .map_err(|e| MigrationsError::Storage(format!("{e}")))?;
        store
            .set_migration_snapshots_enabled(&conn_id, snapshots_enabled)
            .map_err(|e| MigrationsError::Storage(format!("{e}")))?;
    }
    Ok(())
}

// --- tests ----------------------------------------------------------------
//
// 4 happy-path integration tests that exercise the full command stack:
// set_dir + list, apply (single), rollback, diff snapshots. Each test sets up
// a fresh testcontainers Postgres, an in-memory keychain, a tempdir-backed
// SQLite store, and writes a tiny migration file to a tempdir — then drives
// the same async helpers the Tauri command bodies call.
//
// We don't go through `tauri::State` / `tauri::AppHandle`: those are runtime-
// owned wrappers we can't construct outside a real Tauri app. Instead we call
// the underlying logic via private helpers that take `&AppState` directly.
// See `test_apply`, `test_rollback`, and `test_diff` below for the
// AppHandle-free entry points used by tests.

#[cfg(test)]
async fn test_apply(
    state: &AppState,
    conn_id: &str,
    mode: ApplyMode,
) -> Result<ApplyResult, MigrationsError> {
    let conn = load_connection(state, conn_id).await?;
    let client = pool_client(state, conn_id).await?;
    let (merged, _missing) = list_with_ledger(state, conn_id).await?;
    let selected = select_for_apply(&merged, &mode)?;

    let mut applied_out: Vec<AppliedEntry> = Vec::new();
    let mut failed: Option<ApplyFailure> = None;

    for migration in selected {
        let one_slice: Vec<Migration> = vec![migration.clone()];
        let opts = executor::ApplyOptions {
            client: &client,
            tracking_enabled: conn.migration_tracking_enabled,
            migrations: &one_slice,
            mode: ApplyMode::Single {
                version: migration.version.clone(),
            },
        };
        let result = executor::apply(opts).await?;
        if let Some(f) = result.failed {
            failed = Some(f);
            break;
        }
        for entry in result.applied {
            if conn.migration_snapshots_enabled {
                if let Ok(blob) = snapshot::capture(&client).await {
                    let _ = tracking::set_snapshot(&client, &entry.version, &blob).await;
                }
            }
            applied_out.push(entry);
        }
    }

    Ok(ApplyResult {
        applied: applied_out,
        failed,
    })
}

#[cfg(test)]
async fn test_rollback(
    state: &AppState,
    conn_id: &str,
    version: &str,
) -> Result<RollbackResult, MigrationsError> {
    let conn = load_connection(state, conn_id).await?;
    let client = pool_client(state, conn_id).await?;
    let (merged, _missing) = list_with_ledger(state, conn_id).await?;
    let migration = merged
        .iter()
        .find(|m| m.version == version)
        .ok_or_else(|| MigrationsError::NotFound(version.into()))?;
    if migration.down_path.is_none() {
        return Err(MigrationsError::RollbackFileMissing(version.into()));
    }
    executor::rollback(&client, conn.migration_tracking_enabled, migration).await
}

#[cfg(test)]
async fn test_set_dir(state: &AppState, conn_id: &str, dir: &str) -> Result<(), MigrationsError> {
    let store = state.store.lock().await;
    store
        .set_migrations_dir(conn_id, Some(dir))
        .map_err(|e| MigrationsError::Storage(format!("{e}")))?;
    drop(store);
    // Test path: skip the watcher to keep the test surface deterministic
    // (the watcher itself is covered by `watcher.rs` unit tests). We still
    // install a stub handle so the AppState invariant "watchers map tracks
    // connections with a dir" is honored.
    let (tx, _rx) = tokio::sync::oneshot::channel::<()>();
    state
        .migration_watchers
        .write()
        .await
        .insert(conn_id.to_string(), WatcherHandle { stop: tx });
    Ok(())
}

#[cfg(test)]
async fn test_diff(
    state: &AppState,
    conn_id: &str,
    from_version: &str,
    to_version: &str,
) -> Result<DiffResult, MigrationsError> {
    let conn = load_connection(state, conn_id).await?;
    if !conn.migration_snapshots_enabled {
        return Err(MigrationsError::SnapshotsDisabled);
    }
    let client = pool_client(state, conn_id).await?;
    let from_blob = tracking::get_snapshot(&client, from_version)
        .await?
        .ok_or_else(|| MigrationsError::SnapshotMissing(from_version.into()))?;
    let to_blob = tracking::get_snapshot(&client, to_version)
        .await?
        .ok_or_else(|| MigrationsError::SnapshotMissing(to_version.into()))?;
    let from_text = snapshot::decompress(&from_blob)?;
    let to_text = snapshot::decompress(&to_blob)?;
    Ok(DiffResult {
        unified_diff: snapshot::unified_diff(&from_text, &to_text),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use tempfile::TempDir;
    use testcontainers::core::ImageExt;
    use testcontainers::runners::AsyncRunner;
    use testcontainers::ContainerAsync;
    use testcontainers_modules::postgres::Postgres;

    use crate::connection::keychain::MemoryKeychain;
    use crate::connection::types::{NewConnection, SslMode};
    use crate::connection::{PoolRegistry, Store};
    use crate::AppState;

    /// Build an `AppState` against a tempdir-backed `SQLite` store + memory
    /// keychain. Mirrors `tests/connection_integration.rs::build_state`.
    fn build_state(data_dir: &std::path::Path) -> AppState {
        let db_path = data_dir.join("store.db");
        let mut store = Store::open(&db_path).expect("open store");
        store.run_migrations().expect("migrations");
        AppState::new(
            store,
            Box::new(MemoryKeychain::new()),
            Arc::new(PoolRegistry::new()),
        )
    }

    /// Boot a PG testcontainer + return host port. `None` if Docker missing.
    async fn boot_pg() -> Option<(ContainerAsync<Postgres>, u16)> {
        match Postgres::default().with_tag("17-alpine").start().await {
            Ok(c) => {
                let port = c.get_host_port_ipv4(5432).await.expect("host port");
                Some((c, port))
            }
            Err(err) => {
                eprintln!("skipping commands test: docker unavailable ({err})");
                None
            }
        }
    }

    /// Register a connection in the `SQLite` store and open the pool. Returns
    /// the new connection id.
    async fn register_and_connect(state: &AppState, port: u16, snapshots_enabled: bool) -> String {
        let created = state
            .create_connection(NewConnection {
                name: "tc-pg".into(),
                host: "127.0.0.1".into(),
                port,
                database: "postgres".into(),
                username: "postgres".into(),
                password: Some("postgres".into()),
                ssl_mode: SslMode::Disable,
                exclude_from_history: false,
                exclude_from_recent_plans: false,
                environment: crate::connection::types::Environment::Local,
                read_only: false,
                slow_query_warning: false,
                confirm_destructive: false,
                migrations_dir: None,
                migration_tracking_enabled: true,
                migration_snapshots_enabled: snapshots_enabled,
                squawk_lint_enabled: true,
            })
            .await
            .expect("create connection");

        state
            .connection_connect(&created.id)
            .await
            .expect("connection_connect");

        created.id
    }

    /// Write a migration up/down pair into `dir`.
    fn write_migration(dir: &std::path::Path, version: &str, name: &str, up: &str, down: &str) {
        std::fs::write(dir.join(format!("{version}_{name}.up.sql")), up).expect("write up.sql");
        std::fs::write(dir.join(format!("{version}_{name}.down.sql")), down)
            .expect("write down.sql");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn happy_path_set_dir_then_list() {
        std::env::set_var("IDE99_KEYCHAIN_BACKEND", "memory");
        let data_dir = TempDir::new().unwrap();
        std::env::set_var("IDE99_DATA_DIR", data_dir.path());
        let Some((_pg, port)) = boot_pg().await else {
            return;
        };

        let state = build_state(data_dir.path());
        let conn_id = register_and_connect(&state, port, false).await;

        let mig_dir = TempDir::new().unwrap();
        write_migration(
            mig_dir.path(),
            "0001",
            "create_t",
            "CREATE TABLE t (id int);",
            "DROP TABLE t;",
        );

        test_set_dir(&state, &conn_id, mig_dir.path().to_str().unwrap())
            .await
            .expect("set_dir");

        // Re-load the connection — migrations_dir should now be populated.
        let conn = load_connection(&state, &conn_id).await.expect("reload");
        assert_eq!(
            conn.migrations_dir.as_deref(),
            Some(mig_dir.path().to_str().unwrap()),
        );

        let (migrations, missing) = list_with_ledger(&state, &conn_id).await.expect("list");
        assert_eq!(migrations.len(), 1);
        assert_eq!(migrations[0].version, "0001");
        assert_eq!(migrations[0].status, MigrationStatus::Pending);
        // Tracking enabled (default true) but table absent → flag.
        assert!(missing, "tracking_table_missing should be true on fresh DB");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn happy_path_apply_single() {
        std::env::set_var("IDE99_KEYCHAIN_BACKEND", "memory");
        let data_dir = TempDir::new().unwrap();
        std::env::set_var("IDE99_DATA_DIR", data_dir.path());
        let Some((_pg, port)) = boot_pg().await else {
            return;
        };

        let state = build_state(data_dir.path());
        let conn_id = register_and_connect(&state, port, false).await;

        let mig_dir = TempDir::new().unwrap();
        write_migration(
            mig_dir.path(),
            "0001",
            "create_users",
            "CREATE TABLE users (id serial primary key, name text not null);",
            "DROP TABLE users;",
        );

        test_set_dir(&state, &conn_id, mig_dir.path().to_str().unwrap())
            .await
            .expect("set_dir");

        let result = test_apply(
            &state,
            &conn_id,
            ApplyMode::Single {
                version: "0001".into(),
            },
        )
        .await
        .expect("apply");

        assert_eq!(result.applied.len(), 1, "expected 1 applied entry");
        assert_eq!(result.applied[0].version, "0001");
        assert!(result.failed.is_none());

        // Subsequent list should show status=Applied.
        let (merged, _) = list_with_ledger(&state, &conn_id).await.expect("relist");
        let entry = merged
            .iter()
            .find(|m| m.version == "0001")
            .expect("0001 present");
        assert_eq!(entry.status, MigrationStatus::Applied);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn happy_path_rollback() {
        std::env::set_var("IDE99_KEYCHAIN_BACKEND", "memory");
        let data_dir = TempDir::new().unwrap();
        std::env::set_var("IDE99_DATA_DIR", data_dir.path());
        let Some((_pg, port)) = boot_pg().await else {
            return;
        };

        let state = build_state(data_dir.path());
        let conn_id = register_and_connect(&state, port, false).await;

        let mig_dir = TempDir::new().unwrap();
        write_migration(
            mig_dir.path(),
            "0001",
            "create_widgets",
            "CREATE TABLE widgets (id int);",
            "DROP TABLE widgets;",
        );
        test_set_dir(&state, &conn_id, mig_dir.path().to_str().unwrap())
            .await
            .expect("set_dir");

        // Apply.
        test_apply(
            &state,
            &conn_id,
            ApplyMode::Single {
                version: "0001".into(),
            },
        )
        .await
        .expect("apply");

        // Rollback.
        let r = test_rollback(&state, &conn_id, "0001")
            .await
            .expect("rollback");
        assert_eq!(r.rolled_back, "0001");
        assert!(r.error.is_none(), "rollback should succeed: {:?}", r.error);

        // Status should be back to Pending.
        let (merged, _) = list_with_ledger(&state, &conn_id).await.expect("relist");
        let entry = merged
            .iter()
            .find(|m| m.version == "0001")
            .expect("0001 present");
        assert_eq!(entry.status, MigrationStatus::Pending);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn happy_path_diff_snapshots() {
        std::env::set_var("IDE99_KEYCHAIN_BACKEND", "memory");
        let data_dir = TempDir::new().unwrap();
        std::env::set_var("IDE99_DATA_DIR", data_dir.path());
        let Some((_pg, port)) = boot_pg().await else {
            return;
        };

        let state = build_state(data_dir.path());
        let conn_id = register_and_connect(&state, port, /* snapshots_enabled */ true).await;

        let mig_dir = TempDir::new().unwrap();
        write_migration(
            mig_dir.path(),
            "0001",
            "v1",
            "CREATE TABLE diff_t (id int);",
            "DROP TABLE diff_t;",
        );
        write_migration(
            mig_dir.path(),
            "0002",
            "v2",
            "ALTER TABLE diff_t ADD COLUMN name text;",
            "ALTER TABLE diff_t DROP COLUMN name;",
        );
        test_set_dir(&state, &conn_id, mig_dir.path().to_str().unwrap())
            .await
            .expect("set_dir");

        test_apply(&state, &conn_id, ApplyMode::AllPending)
            .await
            .expect("apply all");

        let diff = test_diff(&state, &conn_id, "0001", "0002")
            .await
            .expect("diff");

        // Snapshots include the table state at each point — the second has
        // the `name` column added, so the unified diff must be non-empty.
        assert!(
            !diff.unified_diff.is_empty(),
            "expected non-empty diff between 0001 and 0002, got empty",
        );
        assert!(
            diff.unified_diff.contains("name"),
            "expected diff to mention the new column 'name', got:\n{}",
            diff.unified_diff,
        );
    }
}
