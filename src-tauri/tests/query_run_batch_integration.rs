//! Post-S14 — `query_run_batch` integration tests against a real
//! Postgres 17 testcontainer.
//!
//! Mirrors the harness pattern used by `tests/query_history_recording.rs`
//! and `tests/connection_integration.rs` (Docker-spawned per-test
//! container, separate tempdirs, drive `AppState.*` helpers directly so
//! the Tauri runtime is not involved).
//!
//! Skips with a printed warning if Docker isn't reachable, matching the
//! convention of the neighbouring integration tests.

#![allow(clippy::too_many_lines)]

use std::sync::Arc;

use ide99::connection::keychain::MemoryKeychain;
use ide99::connection::types::{NewConnection, SslMode};
use ide99::connection::{PoolRegistry, Store};
use ide99::query::types::{QueryError, StatementResult};
use ide99::AppState;
use tempfile::TempDir;
use testcontainers::core::ImageExt;
use testcontainers::runners::AsyncRunner;
use testcontainers_modules::postgres::Postgres;

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

/// Boot a postgres:17-alpine testcontainer + create+connect a connection.
/// Returns the connected `AppState` and the new connection id, plus the
/// container guard so callers keep it alive until end of test.
async fn boot_state_with_connection(
    tmp: &TempDir,
) -> Option<(AppState, String, testcontainers::ContainerAsync<Postgres>)> {
    let container = match Postgres::default().with_tag("17-alpine").start().await {
        Ok(c) => c,
        Err(err) => {
            eprintln!("skipping query_run_batch_integration: docker unavailable ({err})");
            return None;
        }
    };
    let host_port = container
        .get_host_port_ipv4(5432)
        .await
        .expect("get host port");

    let state = build_state(tmp.path());
    let created = state
        .create_connection(NewConnection {
            name: "batch-pg".into(),
            host: "127.0.0.1".into(),
            port: host_port,
            database: "postgres".into(),
            username: "postgres".into(),
            password: Some("postgres".into()),
            ssl_mode: SslMode::Disable,
            exclude_from_history: false,
            exclude_from_recent_plans: false,
            environment: ide99::connection::types::Environment::Local,
            read_only: false,
            slow_query_warning: false,
            confirm_destructive: false,
            migrations_dir: None,
            migration_tracking_enabled: true,
            migration_snapshots_enabled: false,
            squawk_lint_enabled: true,
        })
        .await
        .expect("create connection");
    state
        .connection_connect(&created.id)
        .await
        .expect("connection_connect");
    Some((state, created.id, container))
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn batch_with_three_selects_returns_three_rowsets_only_last_has_cursor() {
    std::env::set_var("IDE99_KEYCHAIN_BACKEND", "memory");
    let tmp = TempDir::new().expect("tempdir");
    std::env::set_var("IDE99_DATA_DIR", tmp.path());

    let Some((state, conn_id, _container)) = boot_state_with_connection(&tmp).await else {
        return;
    };

    let result = state
        .query_run_batch(
            &conn_id,
            vec!["SELECT 1".into(), "SELECT 2".into(), "SELECT 3".into()],
            true,
        )
        .await
        .expect("run_batch");

    assert_eq!(result.failed_at, None, "no failure expected");
    assert_eq!(result.statements.len(), 3, "three statements completed");

    // Each result must be a Rowset; only the LAST may carry a cursor_id —
    // post-Sprint-15, exhausted single-page rowsets DO return a real
    // `c_<uuid>` id (so jsonb_resolve_row_key can find the metadata),
    // so the last entry's cursor_id may be Some(...) even when there's
    // nothing left to fetch. Intermediates always have None.
    for (i, s) in result.statements.iter().enumerate() {
        match s {
            StatementResult::Rowset { cursor_id, .. } => {
                if i + 1 == result.statements.len() {
                    // last — cursor_id may be None (inline) or Some (live cursor).
                } else {
                    assert!(
                        cursor_id.is_none(),
                        "intermediate rowset at index {i} must not carry a cursor_id, got {cursor_id:?}"
                    );
                }
            }
            other => panic!("expected Rowset at index {i}, got {other:?}"),
        }
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn explicit_begin_commit_persists_changes_across_statements() {
    std::env::set_var("IDE99_KEYCHAIN_BACKEND", "memory");
    let tmp = TempDir::new().expect("tempdir");
    std::env::set_var("IDE99_DATA_DIR", tmp.path());

    let Some((state, conn_id, _container)) = boot_state_with_connection(&tmp).await else {
        return;
    };

    // Seed a clean table. `query_execute` runs `batch_execute` for
    // multi-statement strings, so DROP + CREATE in one shot is fine.
    state
        .query_execute(&conn_id, "DROP TABLE IF EXISTS post_s14_batch_test")
        .await
        .expect("drop");
    state
        .query_execute(&conn_id, "CREATE TABLE post_s14_batch_test (i int)")
        .await
        .expect("create");

    // Drive the explicit transaction through the batch runner — this is
    // the headline correctness claim: same pooled client across BEGIN ..
    // COMMIT, so the inserts persist.
    let txn = state
        .query_run_batch(
            &conn_id,
            vec![
                "BEGIN".into(),
                "INSERT INTO post_s14_batch_test VALUES (1)".into(),
                "INSERT INTO post_s14_batch_test VALUES (2)".into(),
                "COMMIT".into(),
            ],
            false,
        )
        .await
        .expect("run_batch txn");
    assert_eq!(txn.failed_at, None, "transaction completed cleanly");
    assert_eq!(txn.statements.len(), 4);

    // Read back via the batch runner with cursor_for_last=true so we exercise
    // the cursor-deferral branch.
    let after = state
        .query_run_batch(
            &conn_id,
            vec!["SELECT count(*) FROM post_s14_batch_test".into()],
            true,
        )
        .await
        .expect("read-back");
    let StatementResult::Rowset { rows, .. } = &after.statements[0] else {
        panic!("expected rowset, got {:?}", after.statements[0]);
    };
    assert_eq!(
        rows[0][0].as_deref(),
        Some("2"),
        "both inserts should be persisted"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn batch_stops_on_first_error_and_marks_failed_at() {
    std::env::set_var("IDE99_KEYCHAIN_BACKEND", "memory");
    let tmp = TempDir::new().expect("tempdir");
    std::env::set_var("IDE99_DATA_DIR", tmp.path());

    let Some((state, conn_id, _container)) = boot_state_with_connection(&tmp).await else {
        return;
    };

    let result = state
        .query_run_batch(
            &conn_id,
            vec![
                "SELECT 1".into(),
                "SELECT * FROM nonexistent_table_xyz".into(),
                "SELECT 3".into(),
            ],
            true,
        )
        .await
        .expect("run_batch");

    assert_eq!(result.failed_at, Some(1), "second statement should fail");
    assert_eq!(
        result.statements.len(),
        2,
        "only first statement + the error are pushed; tail not executed"
    );
    assert!(
        matches!(&result.statements[0], StatementResult::Rowset { .. }),
        "first statement should be a successful rowset, got {:?}",
        result.statements[0]
    );
    match &result.statements[1] {
        StatementResult::Error { index, error, .. } => {
            assert_eq!(*index, 1);
            assert!(
                matches!(error, QueryError::PostgresError { .. }),
                "expected PostgresError variant, got {error:?}"
            );
        }
        other => panic!("expected Error at index 1, got {other:?}"),
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn batch_rollback_inside_explicit_txn_undoes_changes() {
    std::env::set_var("IDE99_KEYCHAIN_BACKEND", "memory");
    let tmp = TempDir::new().expect("tempdir");
    std::env::set_var("IDE99_DATA_DIR", tmp.path());

    let Some((state, conn_id, _container)) = boot_state_with_connection(&tmp).await else {
        return;
    };

    state
        .query_execute(&conn_id, "DROP TABLE IF EXISTS post_s14_rollback_test")
        .await
        .expect("drop");
    state
        .query_execute(&conn_id, "CREATE TABLE post_s14_rollback_test (i int)")
        .await
        .expect("create");

    let txn = state
        .query_run_batch(
            &conn_id,
            vec![
                "BEGIN".into(),
                "INSERT INTO post_s14_rollback_test VALUES (1)".into(),
                "ROLLBACK".into(),
            ],
            false,
        )
        .await
        .expect("run_batch rollback");
    assert_eq!(txn.failed_at, None, "explicit ROLLBACK is a clean exit");

    let after = state
        .query_run_batch(
            &conn_id,
            vec!["SELECT count(*) FROM post_s14_rollback_test".into()],
            true,
        )
        .await
        .expect("read-back");
    let StatementResult::Rowset { rows, .. } = &after.statements[0] else {
        panic!("expected rowset, got {:?}", after.statements[0]);
    };
    assert_eq!(
        rows[0][0].as_deref(),
        Some("0"),
        "row inserted inside ROLLBACK'd txn must NOT survive"
    );
}
