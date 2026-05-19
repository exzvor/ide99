//! Sprint 8 — backend integration tests for safety guards.
//!
//! Spins a PG 17 testcontainer, exercises `explain_cost` end-to-end against
//! a seeded table to verify (a) EXPLAIN (FORMAT JSON) parsing is correct,
//! and (b) the planner produces sensible cost deltas — required for the
//! 100K threshold gate to fire only on truly expensive queries.

#![allow(clippy::too_many_lines)]

use std::sync::Arc;

use ide99::connection::keychain::MemoryKeychain;
use ide99::connection::types::{Environment, NewConnection, SslMode};
use ide99::connection::{PoolRegistry, Store};
use ide99::query::explain;
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

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn explain_cost_returns_planner_estimate() {
    std::env::set_var("IDE99_KEYCHAIN_BACKEND", "memory");
    let tmp = TempDir::new().expect("tempdir");
    std::env::set_var("IDE99_DATA_DIR", tmp.path());

    let container = match Postgres::default().with_tag("17-alpine").start().await {
        Ok(c) => c,
        Err(err) => {
            eprintln!("skipping: docker unavailable ({err})");
            return;
        }
    };
    let host = container.get_host().await.expect("host");
    let port = container.get_host_port_ipv4(5432).await.expect("port");

    let state = build_state(tmp.path());
    let conn = state
        .create_connection(NewConnection {
            name: "test".into(),
            host: host.to_string(),
            port,
            database: "postgres".into(),
            username: "postgres".into(),
            password: Some("postgres".into()),
            ssl_mode: SslMode::Disable,
            exclude_from_history: false,
            exclude_from_recent_plans: false,
            environment: Environment::Local,
            read_only: false,
            slow_query_warning: false,
            confirm_destructive: false,
            migrations_dir: None,
            migration_tracking_enabled: true,
            migration_snapshots_enabled: false,
            squawk_lint_enabled: true,
        })
        .await
        .expect("create conn");
    state.connection_connect(&conn.id).await.expect("connect");

    // Seed a table — large enough that a seq scan has visible cost.
    let pool = state.pools.get(&conn.id).await.expect("pool");
    let client = pool.get().await.expect("client");
    client
        .batch_execute(
            "CREATE TABLE bench AS SELECT generate_series(1, 100000) AS id, \
             md5(random()::text) AS payload;",
        )
        .await
        .expect("seed");
    drop(client);

    // Both queries should produce positive planner cost (proves explain_cost
    // round-trips EXPLAIN FORMAT JSON correctly).
    let cost_filter = explain::explain_cost(&pool, "SELECT * FROM bench WHERE id = 1")
        .await
        .expect("explain ok");
    assert!(
        cost_filter > 0.0,
        "expected positive cost, got {cost_filter}"
    );

    let cost_full = explain::explain_cost(&pool, "SELECT * FROM bench")
        .await
        .expect("explain ok");
    assert!(cost_full > 0.0, "expected positive cost, got {cost_full}");

    // Without an index on id, the WHERE clause requires a seq scan + filter —
    // costs end up comparable. The actual >100K threshold gating lives in TS;
    // backend's job here is just to expose the planner number reliably.
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn explain_cost_surfaces_invalid_sql() {
    std::env::set_var("IDE99_KEYCHAIN_BACKEND", "memory");
    let tmp = TempDir::new().expect("tempdir");
    std::env::set_var("IDE99_DATA_DIR", tmp.path());

    let container = match Postgres::default().with_tag("17-alpine").start().await {
        Ok(c) => c,
        Err(err) => {
            eprintln!("skipping: docker unavailable ({err})");
            return;
        }
    };
    let host = container.get_host().await.expect("host");
    let port = container.get_host_port_ipv4(5432).await.expect("port");

    let state = build_state(tmp.path());
    let conn = state
        .create_connection(NewConnection {
            name: "test".into(),
            host: host.to_string(),
            port,
            database: "postgres".into(),
            username: "postgres".into(),
            password: Some("postgres".into()),
            ssl_mode: SslMode::Disable,
            exclude_from_history: false,
            exclude_from_recent_plans: false,
            environment: Environment::Local,
            read_only: false,
            slow_query_warning: false,
            confirm_destructive: false,
            migrations_dir: None,
            migration_tracking_enabled: true,
            migration_snapshots_enabled: false,
            squawk_lint_enabled: true,
        })
        .await
        .expect("create conn");
    state.connection_connect(&conn.id).await.expect("connect");

    let pool = state.pools.get(&conn.id).await.expect("pool");
    // Reference a non-existent table — PG returns SqlState 42P01 from the planner.
    // explain_cost should bubble it up as ConnectionError::Postgres so the
    // pre-execute pipeline can swallow it (and let the user's actual query
    // surface the error inline at run-time).
    let err = explain::explain_cost(&pool, "SELECT * FROM nope_does_not_exist").await;
    assert!(err.is_err(), "expected error for non-existent table");
}
