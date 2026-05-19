//! — Migration dry-run on disposable PG via testcontainers.
//!
//! Public surface: `run_dryrun_against` (test-friendly variant against an
//! already-running PG) and the Tauri command `migrations_dryrun` (full
//! container spinup + cleanup). DTOs (`DryRunReport`, `DryRunStep`,
//! `DryRunStepStatus`, `DryRunError`) are also re-exported.
//!
//! TODO(s35-instant-db): replace testcontainers spinup with InstantDB call when available.

#![allow(clippy::missing_errors_doc, clippy::missing_panics_doc)]
#![allow(clippy::needless_pass_by_value, clippy::unused_async)]

use std::time::{Duration, Instant};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tokio::time::timeout;
use tokio_postgres::NoTls;

use crate::lint::types::SquawkFinding;
use crate::migrations::executor::{apply, ApplyOptions};
use crate::migrations::tracking;
use crate::migrations::types::{ApplyMode, Migration, MigrationsError};
use crate::AppState;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DryRunStepStatus {
    Ok,
    Failed,
    Skipped,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DryRunStep {
    pub version: String,
    pub status: DryRunStepStatus,
    pub duration_ms: i64,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DryRunReport {
    pub success: bool,
    pub container_pull_ms: i64,
    pub container_start_ms: i64,
    pub steps: Vec<DryRunStep>,
    pub total_ms: i64,
    pub findings: Vec<SquawkFinding>,
    pub error: Option<DryRunError>,
}

#[derive(Debug, Clone, Serialize, Deserialize, thiserror::Error)]
#[serde(tag = "kind", content = "message", rename_all = "camelCase")]
pub enum DryRunError {
    #[error("Docker unavailable: {hint}")]
    DockerUnavailable { hint: String },
    #[error("Image pull failed: {error}")]
    ImagePullFailed { error: String },
    #[error("Container start failed: {error}")]
    ContainerStartFailed { error: String },
    #[error("Migration {version} failed: {error}")]
    MigrationFailed { version: String, error: String },
    #[error("Ledger seed failed: {error}")]
    LedgerSeedFailed { error: String },
    #[error("Internal error: {error}")]
    Internal { error: String },
    /// user closed the Apply dialog mid-flight.
    #[error("Dry-run cancelled")]
    Cancelled,
}

/// Pre-flight check: try to talk to Docker daemon. 2s budget.
///
/// Returns `Err(DockerUnavailable)` immediately if the daemon is unreachable.
/// We do this before the real testcontainers `start()` call so the user sees
/// a fast, actionable error instead of a 30s hang on macOS.
pub async fn check_docker_availability() -> Result<(), DryRunError> {
    let probe =
        tokio::task::spawn_blocking(|| std::process::Command::new("docker").arg("info").output());
    let result = timeout(Duration::from_secs(2), probe)
        .await
        .map_err(|_| DryRunError::DockerUnavailable {
            hint: "Docker daemon did not respond within 2s. Start Docker Desktop and retry.".into(),
        })?
        .map_err(|e| DryRunError::Internal {
            error: e.to_string(),
        })?;

    match result {
        Ok(o) if o.status.success() => Ok(()),
        Ok(o) => Err(DryRunError::DockerUnavailable {
            hint: format!("Docker info failed: {}", String::from_utf8_lossy(&o.stderr)),
        }),
        Err(e) => Err(DryRunError::DockerUnavailable {
            hint: format!("Docker not on PATH: {e}"),
        }),
    }
}

/// Seed row format used when the connection is currently connected and we
/// want the ephemeral ledger to mirror prod's "already-applied" set.
#[derive(Debug, Clone)]
pub struct SeedRow {
    pub version: String,
    pub name: String,
    pub checksum: String,
    pub applied_at: String,
    pub applied_by: String,
    pub duration_ms: i64,
}

/// Test-friendly variant: connect to an already-running PG and run the
/// dry-run sequence. The wrapping `migrations_dryrun` (Tauri command body)
/// handles container spinup + cleanup. Tests inject their own container.
pub async fn run_dryrun_against(
    host: String,
    port: u16,
    tracking_enabled: bool,
    seed: Vec<SeedRow>,
    migrations: &[Migration],
    mode: ApplyMode,
) -> DryRunReport {
    let total_start = Instant::now();
    let conn_str =
        format!("host={host} port={port} user=postgres password=postgres dbname=postgres");

    let (client, conn) = match tokio_postgres::connect(&conn_str, NoTls).await {
        Ok(pair) => pair,
        Err(e) => {
            return DryRunReport {
                success: false,
                container_pull_ms: 0,
                container_start_ms: 0,
                steps: Vec::new(),
                total_ms: i64::try_from(total_start.elapsed().as_millis()).unwrap_or(i64::MAX),
                findings: Vec::new(),
                error: Some(DryRunError::ContainerStartFailed {
                    error: e.to_string(),
                }),
            };
        }
    };
    tokio::spawn(async move {
        let _ = conn.await;
    });

    // Step 5: seed ledger
    if tracking_enabled {
        if let Err(e) = tracking::ensure_table(&client).await {
            return DryRunReport {
                success: false,
                container_pull_ms: 0,
                container_start_ms: 0,
                steps: Vec::new(),
                total_ms: i64::try_from(total_start.elapsed().as_millis()).unwrap_or(i64::MAX),
                findings: Vec::new(),
                error: Some(DryRunError::LedgerSeedFailed {
                    error: e.to_string(),
                }),
            };
        }
        for row in &seed {
            // duration_ms column is `integer` in the ledger schema.
            let duration_i32 = i32::try_from(row.duration_ms).unwrap_or(i32::MAX);
            // Parse RFC3339 -> chrono::DateTime<Utc> so tokio_postgres can
            // serialize it as a `timestamptz` directly. Falls back to
            // `now()` (`Utc::now()`) if the source string is malformed —
            // ledger data shouldn't ever be malformed but we don't want a
            // dry-run to die on a single bad row.
            let applied_at: DateTime<Utc> = DateTime::parse_from_rfc3339(&row.applied_at)
                .map(|d| d.with_timezone(&Utc))
                .unwrap_or_else(|_| Utc::now());
            let stmt = "INSERT INTO public.ide99_migrations \
                        (version, name, checksum, applied_at, applied_by, duration_ms) \
                        VALUES ($1, $2, $3, $4, $5, $6)";
            if let Err(e) = client
                .execute(
                    stmt,
                    &[
                        &row.version,
                        &row.name,
                        &row.checksum,
                        &applied_at,
                        &row.applied_by,
                        &duration_i32,
                    ],
                )
                .await
            {
                return DryRunReport {
                    success: false,
                    container_pull_ms: 0,
                    container_start_ms: 0,
                    steps: Vec::new(),
                    total_ms: i64::try_from(total_start.elapsed().as_millis()).unwrap_or(i64::MAX),
                    findings: Vec::new(),
                    error: Some(DryRunError::LedgerSeedFailed {
                        error: e.to_string(),
                    }),
                };
            }
        }
    }

    // Step 6: run migrations
    let opts = ApplyOptions {
        client: &client,
        tracking_enabled,
        migrations,
        mode,
    };
    let apply_result = apply(opts).await;

    let (steps, error, success) = match apply_result {
        Ok(r) => {
            let mut steps: Vec<DryRunStep> = r
                .applied
                .iter()
                .map(|e| DryRunStep {
                    version: e.version.clone(),
                    status: DryRunStepStatus::Ok,
                    duration_ms: e.duration_ms,
                    error: None,
                })
                .collect();
            if let Some(failure) = r.failed {
                steps.push(DryRunStep {
                    version: failure.version.clone(),
                    status: DryRunStepStatus::Failed,
                    duration_ms: 0,
                    error: Some(failure.error.clone()),
                });
                (
                    steps,
                    Some(DryRunError::MigrationFailed {
                        version: failure.version,
                        error: failure.error,
                    }),
                    false,
                )
            } else {
                (steps, None, true)
            }
        }
        Err(e) => (
            Vec::new(),
            Some(DryRunError::Internal {
                error: e.to_string(),
            }),
            false,
        ),
    };

    // Step 7: aggregate Squawk findings (per design §5.1.7 — visibility into
    // all-files matters even if apply hadn't reached every one).
    let mut findings = Vec::new();
    for migration in migrations.iter() {
        if let Ok(r) = crate::lint::runner::lint_path(&migration.up_path).await {
            findings.extend(r.findings);
        }
    }

    DryRunReport {
        success,
        container_pull_ms: 0,  // not measured here — caller fills in
        container_start_ms: 0, // not measured here — caller fills in
        steps,
        total_ms: i64::try_from(total_start.elapsed().as_millis()).unwrap_or(i64::MAX),
        findings,
        error,
    }
}

/// Tauri command that signals an in-flight `migrations_dryrun`
/// to abort. Frontend invokes this when the Apply dialog closes mid-flight
/// so the testcontainer is dropped immediately instead of waiting for the
/// natural end of the run (which can be minutes for image pulls).
#[tauri::command]
pub async fn migrations_dryrun_cancel(
    state: State<'_, AppState>,
    conn_id: String,
) -> Result<(), MigrationsError> {
    let mut map = state.dryrun_cancellers.write().await;
    if let Some(tx) = map.remove(&conn_id) {
        // Best-effort: if the receiver is already dropped (run completed
        // between user close and signal), we just no-op.
        let _ = tx.send(());
    }
    Ok(())
}

#[tauri::command]
pub async fn migrations_dryrun(
    app: AppHandle,
    state: State<'_, AppState>,
    conn_id: String,
    mode: ApplyMode,
) -> Result<DryRunReport, MigrationsError> {
    use serde_json::json;
    use testcontainers::core::ImageExt;
    use testcontainers::runners::AsyncRunner;
    use testcontainers_modules::postgres::Postgres;

    // register a cancellation oneshot keyed by connection.
    // We replace any prior entry to handle a "user retried" sequence.
    let (cancel_tx, mut cancel_rx) = tokio::sync::oneshot::channel::<()>();
    {
        let mut map = state.dryrun_cancellers.write().await;
        if let Some(prev) = map.insert(conn_id.clone(), cancel_tx) {
            // Stale registration from a previous (already-done?) run; drop it.
            let _ = prev.send(());
        }
    }

    /// Helper that drains the cancel registration so the next dry-run starts
    /// fresh. Called on every exit path of this fn.
    async fn unregister(state: &AppState, conn_id: &str) {
        let mut map = state.dryrun_cancellers.write().await;
        map.remove(conn_id);
    }

    /// Build a "Cancelled" report shell used on every cancel exit path so
    /// the FE renders the same message regardless of which phase was
    /// interrupted.
    fn cancelled_report() -> DryRunReport {
        DryRunReport {
            success: false,
            container_pull_ms: 0,
            container_start_ms: 0,
            steps: Vec::new(),
            total_ms: 0,
            findings: Vec::new(),
            error: Some(DryRunError::Cancelled),
        }
    }

    let _ = app.emit(
        "migrations:dryrun-progress",
        &json!({"connId": conn_id, "phase": "pulling"}),
    );

    // Step 2: pre-check Docker (raceable with cancel).
    let docker_check = tokio::select! {
            biased;
            _ = &mut cancel_rx => {
                let _ = app.emit(                "migrations:dryrun-progress",
                    &json!({"connId": conn_id, "phase": "failed"}),
    );
                unregister(&state, &conn_id).await;
                return Ok(cancelled_report());
            }
            r = check_docker_availability() => r,
        };
    if let Err(e) = docker_check {
        let _ = app.emit(
            "migrations:dryrun-progress",
            &json!({"connId": conn_id, "phase": "failed"}),
        );
        unregister(&state, &conn_id).await;
        return Ok(DryRunReport {
            success: false,
            container_pull_ms: 0,
            container_start_ms: 0,
            steps: Vec::new(),
            total_ms: 0,
            findings: Vec::new(),
            error: Some(e),
        });
    }

    // Step 1: load Connection + migrations
    let connection = {
        let store = state.store.lock().await;
        store
            .get_by_id(&conn_id)
            .map_err(|_| MigrationsError::ConnectionNotFound(conn_id.clone()))?
    };
    let dir = connection
        .migrations_dir
        .clone()
        .ok_or(MigrationsError::DirNotSet)?;
    let disk = crate::migrations::discovery::discover(std::path::Path::new(&dir))?;

    // Reconcile with ledger if connected
    let migrations: Vec<Migration> = if connection.migration_tracking_enabled {
        if let Some(pool) = state.pools.get(&conn_id).await {
            if let Ok(client) = pool.get().await {
                if let Ok(true) = crate::migrations::tracking::table_exists(&client).await {
                    if let Ok(ledger) = crate::migrations::tracking::list_applied(&client).await {
                        crate::migrations::tracking::join_with_ledger(disk, ledger)
                    } else {
                        disk
                    }
                } else {
                    disk
                }
            } else {
                disk
            }
        } else {
            disk
        }
    } else {
        disk
    };

    // Build seed (from connected DB's ledger, if reachable)
    let mut seed: Vec<SeedRow> = Vec::new();
    if connection.migration_tracking_enabled {
        if let Some(pool) = state.pools.get(&conn_id).await {
            if let Ok(client) = pool.get().await {
                if let Ok(ledger) = crate::migrations::tracking::list_applied(&client).await {
                    for e in ledger {
                        seed.push(SeedRow {
                            version: e.version,
                            name: e.name,
                            checksum: e.checksum,
                            applied_at: e.applied_at,
                            applied_by: e.applied_by,
                            duration_ms: e.duration_ms,
                        });
                    }
                }
            }
        }
    }

    // Step 3: pull + start container
    let pull_start = Instant::now();
    let _ = app.emit(
        "migrations:dryrun-progress",
        &json!({"connId": conn_id, "phase": "starting"}),
    );
    let container = tokio::select! {
            biased;
            _ = &mut cancel_rx => {
                let _ = app.emit(                "migrations:dryrun-progress",
                    &json!({"connId": conn_id, "phase": "failed"}),
    );
                unregister(&state, &conn_id).await;
                return Ok(cancelled_report());
            }
            r = Postgres::default().with_tag("17-alpine").start() => match r {
                Ok(c) => c,
                Err(e) => {
                    let _ = app.emit(                    "migrations:dryrun-progress",
                        &json!({"connId": conn_id, "phase": "failed"}),
    );
                    unregister(&state, &conn_id).await;
                    return Ok(DryRunReport {
                        success: false,
                        container_pull_ms: i64::try_from(pull_start.elapsed().as_millis())
                            .unwrap_or(i64::MAX),
                        container_start_ms: 0,
                        steps: Vec::new(),
                        total_ms: i64::try_from(pull_start.elapsed().as_millis()).unwrap_or(i64::MAX),
                        findings: Vec::new(),
                        error: Some(DryRunError::ImagePullFailed {
                            error: e.to_string(),
                        }),
                    });
                }
            },
        };
    let container_pull_ms = i64::try_from(pull_start.elapsed().as_millis()).unwrap_or(i64::MAX);

    let start_start = Instant::now();
    let host = match container.get_host().await {
        Ok(h) => h.to_string(),
        Err(e) => {
            let _ = app.emit(
                "migrations:dryrun-progress",
                &json!({"connId": conn_id, "phase": "failed"}),
            );
            unregister(&state, &conn_id).await;
            return Ok(DryRunReport {
                success: false,
                container_pull_ms,
                container_start_ms: 0,
                steps: Vec::new(),
                total_ms: i64::try_from(pull_start.elapsed().as_millis()).unwrap_or(i64::MAX),
                findings: Vec::new(),
                error: Some(DryRunError::ContainerStartFailed {
                    error: e.to_string(),
                }),
            });
        }
    };
    let port = match container.get_host_port_ipv4(5432).await {
        Ok(p) => p,
        Err(e) => {
            let _ = app.emit(
                "migrations:dryrun-progress",
                &json!({"connId": conn_id, "phase": "failed"}),
            );
            unregister(&state, &conn_id).await;
            return Ok(DryRunReport {
                success: false,
                container_pull_ms,
                container_start_ms: 0,
                steps: Vec::new(),
                total_ms: i64::try_from(pull_start.elapsed().as_millis()).unwrap_or(i64::MAX),
                findings: Vec::new(),
                error: Some(DryRunError::ContainerStartFailed {
                    error: e.to_string(),
                }),
            });
        }
    };
    let container_start_ms = i64::try_from(start_start.elapsed().as_millis()).unwrap_or(i64::MAX);

    // Step 4: emit `seeding` if tracking is enabled and we're about to
    // populate the ephemeral ledger. Skipped (silent) when tracking is off
    // since `run_dryrun_against` won't INSERT anything in that case.
    if connection.migration_tracking_enabled {
        let _ = app.emit(
            "migrations:dryrun-progress",
            &json!({"connId": conn_id, "phase": "seeding"}),
        );
    }

    // Steps 5-7: seed + run + lint (raceable with cancel).
    let _ = app.emit(
        "migrations:dryrun-progress",
        &json!({"connId": conn_id, "phase": "running"}),
    );
    let run_fut = run_dryrun_against(
        host,
        port,
        connection.migration_tracking_enabled,
        seed,
        &migrations,
        mode,
    );
    let mut report = tokio::select! {
            biased;
            _ = &mut cancel_rx => {
                let _ = app.emit(                "migrations:dryrun-progress",
                    &json!({"connId": conn_id, "phase": "failed"}),
    );
                unregister(&state, &conn_id).await;
                // Container handle goes out of scope here → testcontainers Drop
                // tears it down within ~1s (Bollard removes the container).
                drop(container);
                return Ok(cancelled_report());
            }
            r = run_fut => r,
        };
    report.container_pull_ms = container_pull_ms;
    report.container_start_ms = container_start_ms;

    let final_phase = if report.success { "done" } else { "failed" };
    let _ = app.emit(
        "migrations:dryrun-progress",
        &json!({"connId": conn_id, "phase": final_phase}),
    );

    drop(container); // explicit cleanup; testcontainers Drop handles it
    unregister(&state, &conn_id).await;

    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::migrations::types::{Migration, MigrationStatus};
    use tempfile::TempDir;
    use testcontainers::core::ImageExt;
    use testcontainers::runners::AsyncRunner;
    use testcontainers_modules::postgres::Postgres;

    async fn try_pg_container() -> Option<(testcontainers::ContainerAsync<Postgres>, String, u16)> {
        let c = Postgres::default()
            .with_tag("17-alpine")
            .start()
            .await
            .ok()?;
        let host = c.get_host().await.ok()?.to_string();
        let port = c.get_host_port_ipv4(5432).await.ok()?;
        Some((c, host, port))
    }

    fn make_migration(dir: &TempDir, version: &str, name: &str, up_sql: &str) -> Migration {
        let up_path = dir.path().join(format!("{}_{}.up.sql", version, name));
        std::fs::write(&up_path, up_sql).unwrap();
        Migration {
            version: version.to_string(),
            name: name.to_string(),
            up_path: up_path.to_string_lossy().to_string(),
            down_path: None,
            status: MigrationStatus::Pending,
            applied_at: None,
            applied_by: None,
            duration_ms: None,
            disk_checksum: crate::migrations::discovery::checksum_hex(up_sql.as_bytes()),
            applied_checksum: None,
            has_snapshot: false,
            parse_error: None,
        }
    }

    #[tokio::test]
    async fn dryrun_happy_path_three_migrations() {
        let Some((_container, host, port)) = try_pg_container().await else {
            eprintln!("[skip] docker / testcontainers not available");
            return;
        };
        let dir = TempDir::new().unwrap();
        let migrations = vec![
            make_migration(&dir, "0001", "a", "CREATE TABLE a (id serial PRIMARY KEY);"),
            make_migration(&dir, "0002", "b", "CREATE TABLE b (id serial PRIMARY KEY);"),
            make_migration(&dir, "0003", "c", "CREATE TABLE c (id serial PRIMARY KEY);"),
        ];

        let report = run_dryrun_against(
            host,
            port,
            /*tracking_enabled*/ true,
            /*seed_rows*/ Vec::new(),
            &migrations,
            ApplyMode::AllPending,
        )
        .await;

        assert!(report.success, "report: {report:?}");
        assert_eq!(report.steps.len(), 3);
        assert!(report
            .steps
            .iter()
            .all(|s| s.status == DryRunStepStatus::Ok));
    }

    #[tokio::test]
    async fn dryrun_failure_mid_run_stops_and_reports() {
        let Some((_container, host, port)) = try_pg_container().await else {
            eprintln!("[skip] docker / testcontainers not available");
            return;
        };
        let dir = TempDir::new().unwrap();
        let migrations = vec![
            make_migration(&dir, "0001", "a", "CREATE TABLE a (id serial PRIMARY KEY);"),
            make_migration(&dir, "0002", "broken", "INVALID SQL HERE;"),
            make_migration(&dir, "0003", "c", "CREATE TABLE c (id serial PRIMARY KEY);"),
        ];

        let report = run_dryrun_against(
            host,
            port,
            true,
            Vec::new(),
            &migrations,
            ApplyMode::AllPending,
        )
        .await;

        assert!(!report.success);
        match report.error {
            Some(DryRunError::MigrationFailed { ref version, .. }) => {
                assert_eq!(version, "0002");
            }
            other => panic!("expected MigrationFailed(0002), got {other:?}"),
        }
    }

    #[tokio::test]
    async fn dryrun_seeds_ledger_so_already_applied_dont_rerun() {
        let Some((_container, host, port)) = try_pg_container().await else {
            eprintln!("[skip] docker / testcontainers not available");
            return;
        };
        let dir = TempDir::new().unwrap();
        let migrations = vec![
            make_migration(&dir, "0001", "a", "CREATE TABLE a (id serial PRIMARY KEY);"),
            make_migration(&dir, "0002", "b", "CREATE TABLE b (id serial PRIMARY KEY);"),
        ];

        // Pretend 0001 is already applied on prod — pass it as a seed row.
        let seed = vec![SeedRow {
            version: "0001".into(),
            name: "a".into(),
            checksum: migrations[0].disk_checksum.clone(),
            applied_at: "2026-04-12T14:22:00Z".into(),
            applied_by: "alice".into(),
            duration_ms: 100,
        }];

        // Apply only 0002; 0001 is already in the ledger so it's skipped.
        let report = run_dryrun_against(
            host,
            port,
            true,
            seed,
            &migrations,
            ApplyMode::Single {
                version: "0002".into(),
            },
        )
        .await;

        assert!(report.success, "report: {report:?}");
        assert_eq!(report.steps.len(), 1);
        assert_eq!(report.steps[0].version, "0002");
    }

    #[tokio::test]
    async fn dryrun_docker_unavailable_returns_actionable_error() {
        // Force the docker check to fail by overriding DOCKER_HOST.
        // (This test runs even without Docker since we're testing the
        // pre-check error path, not the success path.)
        std::env::set_var("DOCKER_HOST", "tcp://127.0.0.1:1"); // closed port
        let result = check_docker_availability().await;
        std::env::remove_var("DOCKER_HOST");
        assert!(matches!(result, Err(DryRunError::DockerUnavailable { .. })));
    }
}
