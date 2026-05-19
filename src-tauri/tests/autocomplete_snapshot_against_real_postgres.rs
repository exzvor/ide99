//! End-to-end integration test for Sprint 7 autocomplete snapshot.
//!
//! Spins a real Postgres 17 testcontainer, creates two schemas with a mix of
//! tables / views / Cyrillic columns, sets `search_path`, calls
//! `AppState::schema_get_autocomplete_snapshot`, and asserts the returned
//! shape matches what we created.

#![allow(clippy::too_many_lines)]

use std::sync::Arc;

use ide99::connection::keychain::MemoryKeychain;
use ide99::connection::types::{NewConnection, SslMode};
use ide99::connection::{PoolRegistry, Store};
use ide99::schema::types::AutocompleteRelKind;
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
async fn snapshot_against_real_postgres() {
    // SAFETY: tests run serially within a process; setting these env vars at
    // top of the test is ergonomic and matches the pattern used by app_paths.
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
    let port = container
        .get_host_port_ipv4(5432)
        .await
        .expect("host port 5432");

    let state = build_state(tmp.path());
    let conn = state
        .create_connection(NewConnection {
            name: "test-pg17".into(),
            host: host.to_string(),
            port,
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
    state.connection_connect(&conn.id).await.expect("connect");

    // Provision schemas / tables / views / Cyrillic columns.
    let pool = state.pools.get(&conn.id).await.expect("pool");
    let client = pool.get().await.expect("client");
    client
        .batch_execute(
            r#"
            CREATE SCHEMA app;
            CREATE TABLE public.users (
                id BIGSERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                email TEXT
            );
            CREATE VIEW public.user_emails AS
                SELECT id, email FROM public.users;
            CREATE TABLE app.orders (
                id BIGSERIAL PRIMARY KEY,
                user_id BIGINT NOT NULL,
                total NUMERIC(10,2) NOT NULL
            );
            CREATE TABLE app."Заказы" (
                "ИД" BIGSERIAL PRIMARY KEY,
                "Дата" TIMESTAMPTZ NOT NULL
            );
            CREATE MATERIALIZED VIEW app.order_totals AS
                SELECT user_id, SUM(total) AS total FROM app.orders GROUP BY user_id;
            ALTER DATABASE postgres SET search_path TO app, public;
            "#,
        )
        .await
        .expect("seed schema");
    drop(client);

    // Reconnect so the new ALTER DATABASE search_path is picked up.
    state
        .connection_disconnect(&conn.id)
        .await
        .expect("disconnect");
    state.connection_connect(&conn.id).await.expect("reconnect");

    let snapshot = state
        .schema_get_autocomplete_snapshot(&conn.id)
        .await
        .expect("snapshot");

    assert_eq!(
        snapshot.search_path,
        vec!["app".to_string(), "public".to_string()]
    );

    let users = snapshot
        .relations
        .iter()
        .find(|r| r.schema == "public" && r.name == "users")
        .expect("public.users present");
    assert_eq!(users.kind, AutocompleteRelKind::Table);
    let users_cols: Vec<&str> = users.columns.iter().map(|c| c.name.as_str()).collect();
    assert_eq!(users_cols, vec!["id", "name", "email"]);

    let view = snapshot
        .relations
        .iter()
        .find(|r| r.schema == "public" && r.name == "user_emails")
        .expect("public.user_emails present");
    assert_eq!(view.kind, AutocompleteRelKind::View);

    let matview = snapshot
        .relations
        .iter()
        .find(|r| r.schema == "app" && r.name == "order_totals")
        .expect("app.order_totals present");
    assert_eq!(matview.kind, AutocompleteRelKind::Matview);

    let cyr = snapshot
        .relations
        .iter()
        .find(|r| r.schema == "app" && r.name == "Заказы")
        .expect("Cyrillic table present");
    let cyr_cols: Vec<&str> = cyr.columns.iter().map(|c| c.name.as_str()).collect();
    assert_eq!(cyr_cols, vec!["ИД", "Дата"]);
}
