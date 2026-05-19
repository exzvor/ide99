//! — Migration apply / rollback executor.
//!
//! Single-purpose: read SQL from disk, execute against the target database
//! (with or without a `BEGIN/COMMIT` wrapper depending on the
//! `-- ide99:no-transaction` directive), and update the
//! `public.ide99_migrations` ledger via `tracking::insert` /
//! `tracking::delete`.
//!
//! Snapshot capture is **NOT** the executor's responsibility — it lives in
//! `commands.rs` (the orchestrator). This keeps executor failure modes simple:
//! "did the DDL run?" and "did the ledger row land?" are the only questions
//! it needs to answer. The original spec §6 mentioned `snapshots_enabled` on
//! `ApplyOptions`, but per the contract that field was dropped — the
//! orchestrator decides whether to capture a snapshot after a successful
//! apply.

#![allow(clippy::missing_errors_doc, clippy::missing_panics_doc)]

use std::fs;
use std::path::Path;
use std::time::Instant;

use tokio_postgres::Client;

use crate::migrations::types::{
    AppliedEntry, ApplyFailure, ApplyMode, ApplyResult, Migration, MigrationStatus,
    MigrationsError, RollbackResult,
};
use crate::migrations::{discovery, tracking};

/// Inputs to `apply`.
pub struct ApplyOptions<'a> {
    pub client: &'a Client,
    pub tracking_enabled: bool,
    /// Already-discovered + sorted set of migrations the orchestrator wants
    /// to consider. `mode` selects which subset to actually run.
    pub migrations: &'a [Migration],
    pub mode: ApplyMode,
}

/// Resolve `mode` against `all` into the ordered slice of migrations to run.
fn select_targets<'m>(    all: &'m [Migration],
    mode: &ApplyMode,
) -> Result<Vec<&'m Migration>, MigrationsError> {
    match mode {
        ApplyMode::Single { version } => {
            let m = all
                .iter()
                .find(|m| &m.version == version)
                .ok_or_else(|| MigrationsError::NotFound(version.clone()))?;
            // �� Single must refuse rows that discovery
            // flagged with a parse_error (duplicate version / orphan rollback
            // file / file missing). Range/AllPending already filter these out
            // via the `parse_error.is_none()` guard below, but Single goes
            // straight to a version lookup and previously skipped the check.
            if let Some(err) = &m.parse_error {
                return Err(MigrationsError::HasParseError {
                    version: m.version.clone(),
                    error: err.clone(),
                });
            }
            Ok(vec![m])
        }
        ApplyMode::Range { from, to } => {
            // Build the ordered "pending" list from `all` (skipping anything
            // with a parse_error). Spec: range must be a contiguous slice of
            // pending.
            let pending_versions: Vec<String> = all
                .iter()
                .filter(|m| m.parse_error.is_none() && m.status == MigrationStatus::Pending)
                .map(|m| m.version.clone())
                .collect();
            if !discovery::is_contiguous_range(&pending_versions, from, to) {
                return Err(MigrationsError::RangeNonContiguous {
                    from: from.clone(),
                    to: to.clone(),
                });
            }
            let from_idx = pending_versions
                .iter()
                .position(|v| v == from)
                .expect("checked");
            let to_idx = pending_versions
                .iter()
                .position(|v| v == to)
                .expect("checked");
            let slice = &pending_versions[from_idx..=to_idx];
            Ok(all
                .iter()
                .filter(|m| slice.iter().any(|v| v == &m.version))
                .collect())
        }
        ApplyMode::AllPending => Ok(all
            .iter()
            .filter(|m| m.parse_error.is_none() && m.status == MigrationStatus::Pending)
            .collect()),
    }
}

/// Run the up.sql for `migration` against `client`. Honors the
/// `-- ide99:no-transaction` directive: when present, executes raw via
/// `batch_execute`; otherwise wraps in `BEGIN; ... COMMIT;`.
async fn execute_sql(client: &Client, sql: &str) -> Result<(), tokio_postgres::Error> {
    if discovery::has_no_transaction_directive(sql) {
        client.batch_execute(sql).await
    } else {
        let wrapped = format!("BEGIN;\n{sql}\nCOMMIT;");
        client.batch_execute(&wrapped).await
    }
}

/// Apply zero or more migrations per `opts.mode`.
///
/// Stops on the first failure. Already-applied migrations from earlier in the
/// batch stay applied (per spec §6.2 / Q3): only the failing migration's tx
/// rolls back.
pub async fn apply(opts: ApplyOptions<'_>) -> Result<ApplyResult, MigrationsError> {
    let ApplyOptions {
        client,
        tracking_enabled,
        migrations,
        mode,
    } = opts;

    let targets = select_targets(migrations, &mode)?;

    if tracking_enabled {
        tracking::ensure_table(client).await?;
    }

    let mut applied: Vec<AppliedEntry> = Vec::new();
    let mut failed: Option<ApplyFailure> = None;

    for migration in targets {
        // Read up SQL fresh from disk (checksum may have changed since
        // discovery; use disk truth at apply time).
        let up_path = Path::new(&migration.up_path);
        let up_bytes = match fs::read(up_path) {
            Ok(b) => b,
            Err(e) => {
                failed = Some(ApplyFailure {
                    version: migration.version.clone(),
                    error: format!("io: {e}"),
                });
                break;
            }
        };
        let up_sql = match String::from_utf8(up_bytes.clone()) {
            Ok(s) => s,
            Err(e) => {
                failed = Some(ApplyFailure {
                    version: migration.version.clone(),
                    error: format!("invalid utf-8 in up.sql: {e}"),
                });
                break;
            }
        };
        let checksum = discovery::checksum_hex(&up_bytes);

        // Already-applied check (only when tracking is on; without tracking,
        // we have no record so we run the SQL whether or not it's been run
        // before — the user opted out).
        if tracking_enabled {
            let ledger = match tracking::list_applied(client).await {
                Ok(l) => l,
                Err(e) => {
                    failed = Some(ApplyFailure {
                        version: migration.version.clone(),
                        error: format!("ledger read: {e}"),
                    });
                    break;
                }
            };
            if ledger.iter().any(|e| e.version == migration.version) {
                failed = Some(ApplyFailure {
                    version: migration.version.clone(),
                    error: format!("migration already applied: {}", migration.version),
                });
                break;
            }
        }

        let started = Instant::now();
        match execute_sql(client, &up_sql).await {
            Ok(()) => {
                let elapsed_ms = i64::try_from(started.elapsed().as_millis()).unwrap_or(i64::MAX);
                if tracking_enabled {
                    if let Err(e) = tracking::insert(                        client,
                        &migration.version,
                        &migration.name,
                        &checksum,
                        elapsed_ms,
)
                    .await
                    {
                        failed = Some(ApplyFailure {
                            version: migration.version.clone(),
                            error: format!("ledger insert: {e}"),
                        });
                        break;
                    }
                }
                applied.push(AppliedEntry {
                    version: migration.version.clone(),
                    duration_ms: elapsed_ms,
                });
            }
            Err(e) => {
                failed = Some(ApplyFailure {
                    version: migration.version.clone(),
                    error: format!("{e}"),
                });
                break;
            }
        }
    }

    Ok(ApplyResult { applied, failed })
}

/// Roll back a single migration.
pub async fn rollback(    client: &Client,
    tracking_enabled: bool,
    migration: &Migration,
) -> Result<RollbackResult, MigrationsError> {
    // 1. If tracking is enabled, verify the ledger row exists.
    if tracking_enabled {
        let ledger = tracking::list_applied(client).await?;
        if !ledger.iter().any(|e| e.version == migration.version) {
            return Err(MigrationsError::NotApplied(migration.version.clone()));
        }
    }

    // 2. Verify the .down.sql path exists.
    let Some(down_path) = migration.down_path.as_ref() else {
        return Err(MigrationsError::RollbackFileMissing(            migration.version.clone(),
));
    };

    // 3. Read down SQL.
    let down_bytes = fs::read(down_path).map_err(|e| MigrationsError::Io(format!("{e}")))?;
    let down_sql = String::from_utf8(down_bytes)
        .map_err(|e| MigrationsError::Io(format!("invalid utf-8 in down.sql: {e}")))?;

    // 4. Execute (magic-comment aware).
    execute_sql(client, &down_sql)
        .await
        .map_err(|e| MigrationsError::Postgres(format!("{e}")))?;

    // 5. Remove ledger row.
    if tracking_enabled {
        tracking::delete(client, &migration.version).await?;
    }

    Ok(RollbackResult {
        rolled_back: migration.version.clone(),
        error: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::migrations::types::MigrationStatus;
    use std::fs;
    use tempfile::TempDir;
    use testcontainers::runners::AsyncRunner;
    use testcontainers::ContainerAsync;
    use testcontainers_modules::postgres::Postgres;
    use tokio_postgres::NoTls;

    /// Build a Migration with `up_path`/`down_path` rooted in `dir`. Writes
    /// both files unless `down_body` is `None`. Returns the Migration struct.
    fn write_migration(        dir: &TempDir,
        version: &str,
        name: &str,
        up_body: &str,
        down_body: Option<&str>,
) -> Migration {
        let up_path = dir.path().join(format!("{version}_{name}.up.sql"));
        fs::write(&up_path, up_body).unwrap();
        let up_str = up_path.to_string_lossy().to_string();
        let disk_checksum = discovery::checksum_hex(up_body.as_bytes());
        let down_str = down_body.map(|body| {
            let p = dir.path().join(format!("{version}_{name}.down.sql"));
            fs::write(&p, body).unwrap();
            p.to_string_lossy().to_string()
        });
        Migration {
            version: version.into(),
            name: name.into(),
            up_path: up_str,
            down_path: down_str,
            status: MigrationStatus::Pending,
            applied_at: None,
            applied_by: None,
            duration_ms: None,
            disk_checksum,
            applied_checksum: None,
            has_snapshot: false,
            parse_error: None,
        }
    }

    async fn make_client() -> Option<(ContainerAsync<Postgres>, Client)> {
        let container = match Postgres::default().start().await {
            Ok(c) => c,
            Err(err) => {
                eprintln!("skipping executor test: docker unavailable ({err})");
                return None;
            }
        };
        let host_port = container.get_host_port_ipv4(5432).await.ok()?;
        let mut cfg = tokio_postgres::Config::new();
        cfg.host("127.0.0.1")
            .port(host_port)
            .dbname("postgres")
            .user("postgres")
            .password("postgres");
        let (client, conn) = cfg.connect(NoTls).await.ok()?;
        tokio::spawn(conn);
        Some((container, client))
    }

    #[tokio::test]
    async fn apply_single_creates_table_and_inserts_ledger() {
        let Some((_c, client)) = make_client().await else {
            return;
        };
        let dir = TempDir::new().unwrap();
        let m = write_migration(            &dir,
            "0001",
            "create_users",
            "CREATE TABLE users(id int);",
            Some("DROP TABLE users;"),
);

        let res = apply(ApplyOptions {
            client: &client,
            tracking_enabled: true,
            migrations: &[m.clone()],
            mode: ApplyMode::Single {
                version: "0001".into(),
            },
        })
        .await
        .unwrap();

        assert!(res.failed.is_none());
        assert_eq!(res.applied.len(), 1);
        assert_eq!(res.applied[0].version, "0001");

        // Ledger row present.
        let ledger = tracking::list_applied(&client).await.unwrap();
        assert_eq!(ledger.len(), 1);
        assert_eq!(ledger[0].version, "0001");
        assert_eq!(ledger[0].name, "create_users");

        // Table exists.
        let row = client
            .query_one(                "SELECT count(*) AS c FROM information_schema.tables \
                  WHERE table_schema='public' AND table_name='users'",
                &[],
)
            .await
            .unwrap();
        assert_eq!(row.get::<_, i64>("c"), 1);
    }

    #[tokio::test]
    async fn apply_failed_sql_rolls_back_no_ledger_row() {
        let Some((_c, client)) = make_client().await else {
            return;
        };
        let dir = TempDir::new().unwrap();
        // First statement succeeds, second fails — wrapped in BEGIN/COMMIT
        // so the entire migration tx rolls back.
        let m = write_migration(            &dir,
            "0001",
            "broken",
            "CREATE TABLE foo (id int);\nTHIS_IS_NOT_SQL;",
            None,
);

        let res = apply(ApplyOptions {
            client: &client,
            tracking_enabled: true,
            migrations: &[m.clone()],
            mode: ApplyMode::Single {
                version: "0001".into(),
            },
        })
        .await
        .unwrap();

        assert!(res.failed.is_some(), "expected failure, got {res:?}");
        assert_eq!(res.applied.len(), 0);

        // foo table should NOT exist (tx rolled back).
        let row = client
            .query_one(                "SELECT count(*) AS c FROM information_schema.tables \
                  WHERE table_schema='public' AND table_name='foo'",
                &[],
)
            .await
            .unwrap();
        assert_eq!(row.get::<_, i64>("c"), 0);

        // Ledger should be empty.
        let ledger = tracking::list_applied(&client).await.unwrap();
        assert!(ledger.is_empty());
    }

    #[tokio::test]
    async fn apply_with_no_transaction_directive_runs_unwrapped() {
        let Some((_c, client)) = make_client().await else {
            return;
        };
        // Pre-create a target table (CREATE INDEX CONCURRENTLY needs an
        // existing table).
        client
            .batch_execute("CREATE TABLE concur_t (id int, val text);")
            .await
            .unwrap();

        let dir = TempDir::new().unwrap();
        let m = write_migration(            &dir,
            "0001",
            "concurrent_index",
            "-- ide99:no-transaction\nCREATE INDEX CONCURRENTLY concur_idx ON concur_t (val);",
            None,
);

        let res = apply(ApplyOptions {
            client: &client,
            tracking_enabled: true,
            migrations: &[m.clone()],
            mode: ApplyMode::Single {
                version: "0001".into(),
            },
        })
        .await
        .unwrap();

        assert!(res.failed.is_none(), "got {res:?}");
        assert_eq!(res.applied.len(), 1);
        // Index must exist.
        let row = client
            .query_one(                "SELECT count(*) AS c FROM pg_indexes \
                  WHERE schemaname='public' AND indexname='concur_idx'",
                &[],
)
            .await
            .unwrap();
        assert_eq!(row.get::<_, i64>("c"), 1);
    }

    /// �� `Single` apply must refuse a row that
    /// `discovery` flagged with a `parse_error` (duplicate version, orphan
    /// rollback, file missing). Pure unit test — no PG container needed
    /// since `select_targets` is checked before any DB calls.
    #[tokio::test]
    async fn apply_single_rejects_parse_error_row() {
        let Some((_c, client)) = make_client().await else {
            return;
        };
        let dir = TempDir::new().unwrap();
        let mut m = write_migration(&dir, "0001", "dup", "SELECT 1;", None);
        m.parse_error = Some("duplicate version".into());

        let err = apply(ApplyOptions {
            client: &client,
            tracking_enabled: false,
            migrations: &[m],
            mode: ApplyMode::Single {
                version: "0001".into(),
            },
        })
        .await
        .expect_err("apply must refuse parse-error row");
        match err {
            MigrationsError::HasParseError { version, error } => {
                assert_eq!(version, "0001");
                assert_eq!(error, "duplicate version");
            }
            other => panic!("expected HasParseError, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn apply_already_applied_returns_already_applied_error() {
        let Some((_c, client)) = make_client().await else {
            return;
        };
        let dir = TempDir::new().unwrap();
        let m = write_migration(&dir, "0001", "noop", "SELECT 1;", None);

        // First apply succeeds.
        let res1 = apply(ApplyOptions {
            client: &client,
            tracking_enabled: true,
            migrations: &[m.clone()],
            mode: ApplyMode::Single {
                version: "0001".into(),
            },
        })
        .await
        .unwrap();
        assert!(res1.failed.is_none());

        // Second apply should fail with "already applied".
        let res2 = apply(ApplyOptions {
            client: &client,
            tracking_enabled: true,
            migrations: &[m.clone()],
            mode: ApplyMode::Single {
                version: "0001".into(),
            },
        })
        .await
        .unwrap();
        let failure = res2.failed.expect("failed");
        assert_eq!(failure.version, "0001");
        assert!(            failure.error.contains("already applied"),
            "expected already-applied error, got {}",
            failure.error
);
    }

    #[tokio::test]
    async fn rollback_executes_down_and_deletes_ledger() {
        let Some((_c, client)) = make_client().await else {
            return;
        };
        let dir = TempDir::new().unwrap();
        let m = write_migration(            &dir,
            "0001",
            "create_users",
            "CREATE TABLE users(id int);",
            Some("DROP TABLE users;"),
);

        // Apply first.
        apply(ApplyOptions {
            client: &client,
            tracking_enabled: true,
            migrations: &[m.clone()],
            mode: ApplyMode::Single {
                version: "0001".into(),
            },
        })
        .await
        .unwrap();

        // Rollback.
        let res = rollback(&client, true, &m).await.unwrap();
        assert_eq!(res.rolled_back, "0001");
        assert!(res.error.is_none());

        // Table must be gone.
        let row = client
            .query_one(                "SELECT count(*) AS c FROM information_schema.tables \
                  WHERE table_schema='public' AND table_name='users'",
                &[],
)
            .await
            .unwrap();
        assert_eq!(row.get::<_, i64>("c"), 0);

        // Ledger must be empty.
        let ledger = tracking::list_applied(&client).await.unwrap();
        assert!(ledger.is_empty());
    }

    #[tokio::test]
    async fn rollback_missing_down_file_returns_error() {
        let Some((_c, client)) = make_client().await else {
            return;
        };
        let dir = TempDir::new().unwrap();
        let m = write_migration(&dir, "0001", "no_down", "CREATE TABLE x(id int);", None);

        // Apply first so the ledger row exists.
        apply(ApplyOptions {
            client: &client,
            tracking_enabled: true,
            migrations: &[m.clone()],
            mode: ApplyMode::Single {
                version: "0001".into(),
            },
        })
        .await
        .unwrap();

        let err = rollback(&client, true, &m).await.unwrap_err();
        match err {
            MigrationsError::RollbackFileMissing(v) => assert_eq!(v, "0001"),
            other => panic!("expected RollbackFileMissing, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn rollback_not_applied_returns_error() {
        let Some((_c, client)) = make_client().await else {
            return;
        };
        let dir = TempDir::new().unwrap();
        let m = write_migration(&dir, "0001", "phantom", "SELECT 1;", Some("SELECT 1;"));

        // Ensure the ledger table exists (to mimic real flow) but skip apply.
        tracking::ensure_table(&client).await.unwrap();

        let err = rollback(&client, true, &m).await.unwrap_err();
        match err {
            MigrationsError::NotApplied(v) => assert_eq!(v, "0001"),
            other => panic!("expected NotApplied, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn apply_range_stops_on_first_failure() {
        let Some((_c, client)) = make_client().await else {
            return;
        };
        let dir = TempDir::new().unwrap();
        let m1 = write_migration(            &dir,
            "0001",
            "ok1",
            "CREATE TABLE t1(id int);",
            Some("DROP TABLE t1;"),
);
        let m2 = write_migration(            &dir,
            "0002",
            "broken",
            "CREATE TABLE t2(id int);\nNOT_A_STATEMENT;",
            None,
);
        let m3 = write_migration(            &dir,
            "0003",
            "ok3",
            "CREATE TABLE t3(id int);",
            Some("DROP TABLE t3;"),
);

        let res = apply(ApplyOptions {
            client: &client,
            tracking_enabled: true,
            migrations: &[m1.clone(), m2.clone(), m3.clone()],
            mode: ApplyMode::AllPending,
        })
        .await
        .unwrap();

        assert_eq!(res.applied.len(), 1);
        assert_eq!(res.applied[0].version, "0001");
        let failed = res.failed.expect("failed");
        assert_eq!(failed.version, "0002");

        // t1 exists, t2 does not, t3 does not.
        async fn table_count(client: &Client, name: &str) -> i64 {
            let row = client
                .query_one(                    "SELECT count(*) AS c FROM information_schema.tables \
                      WHERE table_schema='public' AND table_name=$1",
                    &[&name],
)
                .await
                .unwrap();
            row.get::<_, i64>("c")
        }
        assert_eq!(table_count(&client, "t1").await, 1);
        assert_eq!(table_count(&client, "t2").await, 0);
        assert_eq!(table_count(&client, "t3").await, 0);

        // Ledger should have only 0001.
        let ledger = tracking::list_applied(&client).await.unwrap();
        assert_eq!(ledger.len(), 1);
        assert_eq!(ledger[0].version, "0001");
    }
}
