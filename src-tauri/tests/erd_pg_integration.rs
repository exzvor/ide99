//! Sprint 18 — ERD `erd_get_schema_graph` integration test against a real
//! Postgres testcontainer. Mirrors the structure / Docker-skip pattern of
//! `health_pg_integration.rs`.
//!
//! Seeds three tables in a fresh `test_erd` schema, exercising:
//! - Single-column PRIMARY KEY (`users.id`, `orders.id`).
//! - Single-column FOREIGN KEY (`orders.user_id` → `users.id`).
//! - Composite PRIMARY KEY (`order_items (order_id, line)`).
//! - Composite FOREIGN KEY (`order_items (order_id, line)` →
//!   `orders (id, line)`) — requires a `UNIQUE(id, line)` on orders so
//!   the referenced columns form a unique key. This is the assertion that
//!   guards positional alignment between `source_columns` and
//!   `target_columns` in the returned payload.

#![allow(clippy::too_many_lines)]

use std::sync::Arc;

use ide99::connection::keychain::MemoryKeychain;
use ide99::connection::types::{Environment, NewConnection, SslMode};
use ide99::connection::{PoolRegistry, Store};
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
async fn erd_schema_graph_against_real_postgres() {
    std::env::set_var("IDE99_KEYCHAIN_BACKEND", "memory");
    let tmp = TempDir::new().expect("tempdir");
    std::env::set_var("IDE99_DATA_DIR", tmp.path());

    let container = match Postgres::default().with_tag("17-alpine").start().await {
        Ok(c) => c,
        Err(err) => {
            eprintln!("skipping erd_pg_integration: docker unavailable ({err})");
            return;
        }
    };
    let host_port = container
        .get_host_port_ipv4(5432)
        .await
        .expect("get host port");

    let state = build_state(tmp.path());
    let created = state
        .create_connection(NewConnection {
            name: "tc-pg-erd".into(),
            host: "127.0.0.1".into(),
            port: host_port,
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
        .expect("create");

    state
        .connection_connect(&created.id)
        .await
        .expect("connect");

    // -----------------------------------------------------------------------
    // Seed: 3 tables in a fresh schema, including a valid composite FK.
    //
    //   users(id PK, email)
    //   orders(id PK, user_id FK→users.id, total, note, line INT,
    //          UNIQUE(id, line))    ← exposes a 2-col unique key for the FK
    //   order_items(order_id, line, qty,
    //               PK(order_id, line),
    //               FK(order_id, line) → orders(id, line))   ← composite FK
    // -----------------------------------------------------------------------
    {
        let pool = state
            .pools
            .get(&created.id)
            .await
            .expect("pool present after connect");
        let client = pool.get().await.expect("client");
        client
            .batch_execute(
                "CREATE SCHEMA test_erd; \
                 CREATE TABLE test_erd.users ( \
                     id BIGINT PRIMARY KEY, \
                     email TEXT NOT NULL \
                 ); \
                 CREATE TABLE test_erd.orders ( \
                     id BIGINT PRIMARY KEY, \
                     user_id BIGINT REFERENCES test_erd.users(id) ON DELETE CASCADE, \
                     total NUMERIC, \
                     note TEXT, \
                     line INTEGER NOT NULL DEFAULT 1, \
                     UNIQUE(id, line) \
                 ); \
                 CREATE TABLE test_erd.order_items ( \
                     order_id BIGINT, \
                     line INTEGER, \
                     qty INTEGER, \
                     PRIMARY KEY (order_id, line), \
                     FOREIGN KEY (order_id, line) \
                         REFERENCES test_erd.orders(id, line) \
                 );",
            )
            .await
            .expect("seed schema");
    }

    // -----------------------------------------------------------------------
    // Call the command — restrict to the seeded schema so the assertions are
    // deterministic regardless of what else lives in the container.
    // -----------------------------------------------------------------------
    let graph = state
        .erd_get_schema_graph(&created.id, Some(&["test_erd".to_string()]))
        .await
        .expect("erd_get_schema_graph");

    // Three tables, in alphabetical order from the SQL `ORDER BY schema, name`.
    assert_eq!(
        graph.tables.len(),
        3,
        "expected 3 tables (users, orders, order_items), got {:?}",
        graph.tables.iter().map(|t| &t.name).collect::<Vec<_>>()
    );
    let names: Vec<&str> = graph.tables.iter().map(|t| t.name.as_str()).collect();
    assert!(names.contains(&"users"));
    assert!(names.contains(&"orders"));
    assert!(names.contains(&"order_items"));
    for t in &graph.tables {
        assert_eq!(t.schema, "test_erd", "every table is in test_erd");
        assert!(
            !t.columns.is_empty(),
            "table {} should have columns",
            t.name
        );
    }

    // PK column: users.id — is_primary_key=true, is_foreign_key=false.
    let users = graph
        .tables
        .iter()
        .find(|t| t.name == "users")
        .expect("users table");
    let id_col = users
        .columns
        .iter()
        .find(|c| c.name == "id")
        .expect("users.id column");
    assert!(id_col.is_primary_key, "users.id should be PK");
    assert!(!id_col.is_foreign_key, "users.id should not be FK on users");

    // FK column: orders.user_id — is_foreign_key=true.
    let orders = graph
        .tables
        .iter()
        .find(|t| t.name == "orders")
        .expect("orders table");
    let user_id_col = orders
        .columns
        .iter()
        .find(|c| c.name == "user_id")
        .expect("orders.user_id column");
    assert!(
        user_id_col.is_foreign_key,
        "orders.user_id should be flagged as FK"
    );
    assert!(
        !user_id_col.is_primary_key,
        "orders.user_id is not part of the PK"
    );

    // At least one FK exists; we expect 2 (orders→users, order_items→orders).
    assert!(
        !graph.foreign_keys.is_empty(),
        "expected ≥1 FK, got {}",
        graph.foreign_keys.len()
    );

    // Composite-FK alignment: find the FK whose source_columns has length > 1
    // and verify it matches target_columns positionally.
    let composite = graph
        .foreign_keys
        .iter()
        .find(|fk| fk.source_columns.len() > 1)
        .expect("expected composite FK from order_items to orders");
    assert_eq!(
        composite.source_columns.len(),
        composite.target_columns.len(),
        "composite FK source/target column counts must align: source={:?} target={:?}",
        composite.source_columns,
        composite.target_columns
    );
    assert_eq!(composite.source_schema, "test_erd");
    assert_eq!(composite.source_table, "order_items");
    assert_eq!(composite.target_schema, "test_erd");
    assert_eq!(composite.target_table, "orders");
    assert_eq!(
        composite.source_columns,
        vec!["order_id".to_string(), "line".to_string()],
        "composite FK source columns should be (order_id, line) in declaration order"
    );
    assert_eq!(
        composite.target_columns,
        vec!["id".to_string(), "line".to_string()],
        "composite FK target columns should be (id, line) in declaration order"
    );

    // fetched_in_ms is u64 (always ≥ 0) — assert the field is reachable + sane.
    let _ = graph.fetched_in_ms;
    assert!(
        graph.fetched_in_ms < 60_000,
        "ERD payload should materialize in well under 60s, got {}ms",
        graph.fetched_in_ms
    );

    state
        .connection_disconnect(&created.id)
        .await
        .expect("disconnect");

    std::env::remove_var("IDE99_KEYCHAIN_BACKEND");
    std::env::remove_var("IDE99_DATA_DIR");
}
