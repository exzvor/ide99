//! Sprint 6 — Query history export performance & shape.
//!
//! Seeds 1000 synthetic rows directly into the `SQLite` store via
//! `query::history::record`, then drives `AppState::history_export` and
//! asserts:
//!
//! * `count == 1000`
//! * file size on disk == `result.bytes`
//! * top-level JSON shape: `version=1`, `kind="history"`, `queries.len()=1000`
//! * elapsed <1 second (spec §6.2 acceptance criterion)
//!
//! Does NOT need testcontainers — bypasses the Postgres path entirely by
//! constructing `AppState` from a tempfile-backed Store, a `MemoryKeychain`,
//! and an empty `PoolRegistry`. The export pipeline only touches the `SQLite`
//! handle, so a real PG would just slow the test down without exercising anything new.

#![allow(clippy::too_many_lines)]

use std::sync::Arc;
use std::time::{Duration, Instant};

use ide99::connection::keychain::MemoryKeychain;
use ide99::connection::types::{NewConnection, SslMode};
use ide99::connection::{PoolRegistry, Store};
use ide99::query::history;
use ide99::query::types::{HistorySearchFilter, HistoryStatus, NewHistoryRecord};
use ide99::AppState;
use serde_json::Value;
use tempfile::TempDir;

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

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn export_thousand_rows_under_one_second() {
    // SAFETY: tests run serially within a process; setting these env vars at
    // top of the test mirrors the established connection_integration pattern.
    std::env::set_var("IDE99_KEYCHAIN_BACKEND", "memory");
    let tmp = TempDir::new().expect("tempdir");
    std::env::set_var("IDE99_DATA_DIR", tmp.path());

    let state = build_state(tmp.path());

    // Need a real connection row so `_record_history` (and the export path,
    // which has no exclude check itself) keep their FK shape consistent —
    // also lets us write 1000 rows referencing a stable connection_id.
    let connection = state
        .create_connection(NewConnection {
            name: "export-fixture".into(),
            host: "127.0.0.1".into(),
            port: 5432,
            database: "postgres".into(),
            username: "postgres".into(),
            password: None,
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
        .expect("create connection fixture");

    // Seed 1000 history rows directly via the DAO. Going through
    // `state.query_execute` would require a live PG; the export pipeline
    // doesn't care how rows got there, only that they're indexable.
    {
        let store = state.store.lock().await;
        for i in 0u64..1000u64 {
            let input = NewHistoryRecord {
                connection_id: connection.id.clone(),
                connection_name: connection.name.clone(),
                sql: format!("SELECT {i} AS export_row"),
                executed_at: chrono::Utc::now().to_rfc3339(),
                duration_ms: i % 100,
                status: HistoryStatus::Ok,
                rows_affected: None,
                rows_returned: Some(1),
                truncated: false,
                error_message: None,
            };
            history::record(store.conn(), &input).expect("seed history row");
        }
    }

    let out_path = tmp.path().join("history_export.json");
    let out_path_str = out_path.to_str().expect("utf-8 path").to_string();

    let started = Instant::now();
    let result = state
        .history_export(&HistorySearchFilter::default(), &out_path_str)
        .await
        .expect("history_export");
    let elapsed = started.elapsed();

    assert_eq!(result.count, 1000, "expected 1000 rows in export");
    assert!(
        out_path.exists(),
        "export file should exist at {out_path_str}"
    );
    let on_disk = std::fs::metadata(&out_path).expect("metadata").len();
    assert_eq!(
        on_disk, result.bytes,
        "result.bytes should match on-disk size"
    );
    assert!(on_disk > 0, "export must not be empty");
    assert!(
        elapsed < Duration::from_secs(1),
        "1000-row export took {elapsed:?}, spec budget is <1s",
    );

    // Parse + verify shape.
    let raw = std::fs::read_to_string(&out_path).expect("read export");
    let json: Value = serde_json::from_str(&raw).expect("parse JSON");
    assert_eq!(
        json["version"], 1,
        "top-level version must be 1, got {:?}",
        json["version"]
    );
    assert_eq!(
        json["kind"], "history",
        "top-level kind must be \"history\", got {:?}",
        json["kind"]
    );
    let queries = json["queries"].as_array().expect("queries is array");
    assert_eq!(
        queries.len(),
        1000,
        "queries length should match count, got {}",
        queries.len()
    );
    // Spot-check a row's camelCase fields.
    let first = &queries[0];
    assert!(first["id"].is_string(), "row.id should be string");
    assert!(
        first["connectionId"].is_string(),
        "row.connectionId should be string"
    );
    assert!(first["sql"].is_string(), "row.sql should be string");
    assert_eq!(first["status"], "ok");

    std::env::remove_var("IDE99_KEYCHAIN_BACKEND");
    std::env::remove_var("IDE99_DATA_DIR");
}
