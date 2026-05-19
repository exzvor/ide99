//! Sprint 6 — Query history recording integration tests.
//!
//! Exercises the wire from `query_execute` / `query_open_cursor` /
//! `query_cancel` into `query::history::record` against a real Postgres
//! 17 testcontainer. Mirrors the setup pattern in
//! `tests/connection_integration.rs`: spin the container, build `AppState`
//! manually, drive the high-level `state.*` helpers (no Tauri runtime).
//!
//! Each `#[tokio::test]` is independent — separate tempdirs + separate
//! containers — so a failure in one scenario doesn't poison the others
//! and (more importantly) the History table starts empty for every assert.
//!
//! Skips with a printed warning if Docker isn't reachable; matches the
//! convention used by `connection_integration.rs`.

#![allow(clippy::too_many_lines)]

use std::sync::Arc;

use ide99::connection::keychain::MemoryKeychain;
use ide99::connection::types::{NewConnection, SslMode};
use ide99::connection::{PoolRegistry, Store};
use ide99::query::types::{HistorySearchFilter, HistoryStatus};
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
            eprintln!("skipping query_history_recording: docker unavailable ({err})");
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
            name: "history-pg".into(),
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
async fn select_records_ok() {
    std::env::set_var("IDE99_KEYCHAIN_BACKEND", "memory");
    let tmp = TempDir::new().expect("tempdir");
    std::env::set_var("IDE99_DATA_DIR", tmp.path());

    let Some((state, conn_id, _container)) = boot_state_with_connection(&tmp).await else {
        return;
    };

    state
        .query_execute(&conn_id, "SELECT 1")
        .await
        .expect("SELECT 1");

    let result = state
        .history_search(&HistorySearchFilter::default())
        .await
        .expect("history_search");
    assert_eq!(result.rows.len(), 1, "expected exactly one history row");
    let row = &result.rows[0];
    assert_eq!(row.status, HistoryStatus::Ok);
    assert_eq!(
        row.rows_returned,
        Some(1),
        "SELECT 1 should report 1 row returned"
    );
    assert!(row.error_message.is_none(), "no error on success");
    assert!(!row.truncated, "single-row SELECT is not truncated");

    std::env::remove_var("IDE99_KEYCHAIN_BACKEND");
    std::env::remove_var("IDE99_DATA_DIR");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn dml_records_with_rows_affected() {
    std::env::set_var("IDE99_KEYCHAIN_BACKEND", "memory");
    let tmp = TempDir::new().expect("tempdir");
    std::env::set_var("IDE99_DATA_DIR", tmp.path());

    let Some((state, conn_id, _container)) = boot_state_with_connection(&tmp).await else {
        return;
    };

    state
        .query_execute(&conn_id, "CREATE TABLE history_dml (x int)")
        .await
        .expect("CREATE TABLE");
    state
        .query_execute(&conn_id, "INSERT INTO history_dml VALUES (1)")
        .await
        .expect("INSERT");

    let result = state
        .history_search(&HistorySearchFilter::default())
        .await
        .expect("history_search");
    assert_eq!(result.rows.len(), 2, "expected two history rows");

    // Default search ordering is `executed_at DESC`, so the INSERT (most
    // recent) lands at index 0. Pick by SQL prefix to make the assertion
    // robust to a future ordering tweak.
    let insert_row = result
        .rows
        .iter()
        .find(|r| r.sql.starts_with("INSERT"))
        .expect("INSERT row present");
    assert_eq!(insert_row.status, HistoryStatus::Ok);
    assert_eq!(insert_row.rows_affected, Some(1), "INSERT affected one row");
    assert_eq!(
        insert_row.rows_returned, None,
        "DML rows_returned should be None"
    );

    std::env::remove_var("IDE99_KEYCHAIN_BACKEND");
    std::env::remove_var("IDE99_DATA_DIR");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn failing_query_records_error() {
    std::env::set_var("IDE99_KEYCHAIN_BACKEND", "memory");
    let tmp = TempDir::new().expect("tempdir");
    std::env::set_var("IDE99_DATA_DIR", tmp.path());

    let Some((state, conn_id, _container)) = boot_state_with_connection(&tmp).await else {
        return;
    };

    let err = state
        .query_execute(&conn_id, "SELECT bad_syntax_xyz_no_such_column")
        .await
        .expect_err("nonexistent column should error");
    drop(err);

    let result = state
        .history_search(&HistorySearchFilter::default())
        .await
        .expect("history_search");
    assert_eq!(result.rows.len(), 1, "failed query still records a row");
    let row = &result.rows[0];
    assert_eq!(row.status, HistoryStatus::Error);
    assert!(
        row.error_message.as_deref().is_some_and(|m| !m.is_empty()),
        "errorMessage must be non-empty, got {:?}",
        row.error_message
    );
    assert_eq!(row.rows_returned, None);
    assert_eq!(row.rows_affected, None);

    std::env::remove_var("IDE99_KEYCHAIN_BACKEND");
    std::env::remove_var("IDE99_DATA_DIR");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn excluded_connection_skips_recording() {
    std::env::set_var("IDE99_KEYCHAIN_BACKEND", "memory");
    let tmp = TempDir::new().expect("tempdir");
    std::env::set_var("IDE99_DATA_DIR", tmp.path());

    let Some((state, conn_id, _container)) = boot_state_with_connection(&tmp).await else {
        return;
    };

    state
        .connection_set_exclude_from_history(&conn_id, true)
        .await
        .expect("set exclude_from_history");

    state
        .query_execute(&conn_id, "SELECT 1")
        .await
        .expect("SELECT after exclude");

    let result = state
        .history_search(&HistorySearchFilter::default())
        .await
        .expect("history_search");
    assert!(
        result.rows.is_empty(),
        "excluded connection should not write history rows, got {} rows",
        result.rows.len()
    );

    std::env::remove_var("IDE99_KEYCHAIN_BACKEND");
    std::env::remove_var("IDE99_DATA_DIR");
}

/// Cancel a live cursor and verify the History row carries
/// `status=Cancelled` + the recognized `error_message`.
///
/// Strategy note: `query_open_cursor` is BEGIN + DECLARE + FETCH 1000.
/// On a 100M-row `generate_series`, the first FETCH returns 1000 rows
/// immediately, so the open call completes fast — we get the `cursor_id`,
/// then trigger `query_cancel` against the live registry entry. That
/// path snapshots `conn_id`+`sql`+`started_at` from `CursorState` and
/// records a Cancelled history row regardless of whether subsequent
/// `FETCHes` would have errored.
///
/// Tried-and-rejected alternative: a `pg_sleep(2)` query in a tokio
/// task with a 250ms cancel kick. There's no way to grab the `cursor_id`
/// while the `open_cursor` future is still inside the first FETCH —
/// `CursorRegistry` only inserts after the FETCH returns — so the cancel
/// would race the open and either no-op or hit the inline path.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cancelled_query_records_cancelled_status() {
    std::env::set_var("IDE99_KEYCHAIN_BACKEND", "memory");
    let tmp = TempDir::new().expect("tempdir");
    std::env::set_var("IDE99_DATA_DIR", tmp.path());

    let Some((state, conn_id, _container)) = boot_state_with_connection(&tmp).await else {
        return;
    };

    // Strategy: open_cursor on a 100M-row stream. The first FETCH 1000
    // returns immediately so we get the cursor_id, then call query_cancel
    // — that snapshots conn_id+sql+started_at and writes a Cancelled row.
    let opened = state
        .query_open_cursor(&conn_id, "SELECT i FROM generate_series(1, 100000000) AS i")
        .await
        .expect("open_cursor");
    assert!(
        opened.cursor_id.starts_with("c_"),
        "expected live cursor, got {:?}",
        opened.cursor_id
    );

    state
        .query_cancel(&opened.cursor_id)
        .await
        .expect("query_cancel");

    let result = state
        .history_search(&HistorySearchFilter::default())
        .await
        .expect("history_search");
    // Open writes one Ok row, cancel writes one Cancelled row.
    let cancelled_rows: Vec<_> = result
        .rows
        .iter()
        .filter(|r| r.status == HistoryStatus::Cancelled)
        .collect();
    assert_eq!(
        cancelled_rows.len(),
        1,
        "expected exactly one cancelled history row, got {} (all rows: {:?})",
        cancelled_rows.len(),
        result.rows
    );
    let cancelled = cancelled_rows[0];
    assert!(
        cancelled.sql.contains("generate_series"),
        "cancelled row should preserve original SQL, got {:?}",
        cancelled.sql
    );
    assert_eq!(
        cancelled.error_message.as_deref(),
        Some("Query cancelled by user"),
        "cancelled row should carry a recognizable message"
    );

    std::env::remove_var("IDE99_KEYCHAIN_BACKEND");
    std::env::remove_var("IDE99_DATA_DIR");
}
