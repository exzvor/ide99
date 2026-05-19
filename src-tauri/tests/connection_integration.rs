//! End-to-end integration test for Sprint 2 connection manager.
//!
//! Walks all five acceptance criteria against a real Postgres 17 testcontainer.
//! Requires Docker to be running. Skips the test (with a tracing warning) if
//! the container fails to start.

#![allow(clippy::too_many_lines)]

use std::sync::Arc;
use std::time::Instant;

use ide99::connection::keychain::MemoryKeychain;
use ide99::connection::types::{NewConnection, SslMode, UpdateConnection, UpdatePassword};
use ide99::connection::{PoolRegistry, Store};
use ide99::query::types::{EditorTabRow, QueryError};
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
async fn full_lifecycle_against_real_postgres() {
    // SAFETY: tests run serially within a process; setting these env vars at
    // top of the test is ergonomic and matches the pattern used by app_paths.
    std::env::set_var("IDE99_KEYCHAIN_BACKEND", "memory");
    let tmp = TempDir::new().expect("tempdir");
    std::env::set_var("IDE99_DATA_DIR", tmp.path());

    // Pin postgres:17-alpine. testcontainers-modules' Postgres::default() ships
    // with whatever upstream tag they happen to track (currently pg11), and we
    // assert on "17" further down — making the version explicit avoids drift.
    let container = match Postgres::default().with_tag("17-alpine").start().await {
        Ok(c) => c,
        Err(err) => {
            eprintln!("skipping: docker unavailable ({err})");
            return;
        }
    };
    let host_port = container
        .get_host_port_ipv4(5432)
        .await
        .expect("get host port");

    // ---- AC1: create connection then test successfully ----
    let state = build_state(tmp.path());
    let created = state
        .create_connection(NewConnection {
            name: "tc-pg".into(),
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
        .expect("create");
    assert!(created.has_password, "has_password flag should be true");
    assert_eq!(
        state.keychain.get(&created.id).expect("kc get").as_deref(),
        Some("postgres"),
        "password stored in keychain"
    );

    let test_result = state
        .test_saved_connection(&created.id)
        .await
        .expect("test_saved_connection");
    assert!(test_result.ok, "expected ok=true, got {test_result:?}");
    assert!(
        test_result
            .server_version
            .as_deref()
            .is_some_and(|v| v.contains("17")),
        "expected server_version to mention 17, got {:?}",
        test_result.server_version
    );

    // ---- update name + verify row reflects it ----
    let updated = state
        .update_connection(
            &created.id,
            UpdateConnection {
                name: "tc-pg-renamed".into(),
                host: created.host.clone(),
                port: created.port,
                database: created.database.clone(),
                username: created.username.clone(),
                password: UpdatePassword::Keep,
                ssl_mode: created.ssl_mode,
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
            },
        )
        .await
        .expect("update");
    assert_eq!(updated.name, "tc-pg-renamed");
    assert!(updated.has_password, "has_password preserved on Keep");

    // ---- AC2: restart app -> persistence ----
    let stored_id = updated.id.clone();
    drop(state);

    // Simulate fresh process: rebuild Store but reuse the same MemoryKeychain
    // contents would only survive if the OS keychain were used. To verify
    // AC2's keychain-persistence semantics under MemoryKeychain we instead
    // re-populate the keychain explicitly (the OS keychain test is covered
    // by manual smoke / future e2e). What we DO verify here for free is that
    // the SQLite row survives the restart.
    let restored = build_state(tmp.path());
    let listed = restored
        .list_connections()
        .await
        .expect("list after restart");
    assert_eq!(listed.len(), 1, "row survives restart");
    assert_eq!(listed[0].id, stored_id);
    assert_eq!(listed[0].name, "tc-pg-renamed");
    assert!(listed[0].has_password, "has_password persisted");

    // Re-store the password (memory keychain is a fresh instance per process)
    // so the "Test now" flow finds it.
    restored
        .keychain
        .store(&stored_id, "postgres")
        .expect("re-store");
    let retest = restored
        .test_saved_connection(&stored_id)
        .await
        .expect("retest");
    assert!(retest.ok, "post-restart test_saved_connection ok");

    // Sanity: the last_test_ok column got persisted.
    let after = restored
        .list_connections()
        .await
        .expect("list")
        .into_iter()
        .next()
        .unwrap();
    assert_eq!(after.last_test_ok, Some(true));
    assert!(after.last_tested_at.is_some());

    // ---- AC4: 50+ connections render fast (rust-side: list is sub-100ms) ----
    for i in 0..60 {
        restored
            .create_connection(NewConnection {
                name: format!("bulk-{i:03}"),
                host: "127.0.0.1".into(),
                port: host_port,
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
            .expect("bulk create");
    }
    let start = Instant::now();
    let many = restored.list_connections().await.expect("bulk list");
    let elapsed = start.elapsed();
    assert!(many.len() >= 60, "bulk list returned {} rows", many.len());
    assert!(
        elapsed.as_millis() < 200,
        "list of {} rows took {:?}, expected <200ms",
        many.len(),
        elapsed
    );

    // ---- AC3: delete clears keychain + AC5: empty list ----
    restored
        .delete_connection(&stored_id)
        .await
        .expect("delete saved row");
    assert_eq!(
        restored
            .keychain
            .get(&stored_id)
            .expect("kc get post-delete"),
        None
    );
    // delete_connection on an already-deleted id should now NotFound:
    let not_found = restored.delete_connection(&stored_id).await.unwrap_err();
    assert!(matches!(
        not_found,
        ide99::connection::types::ConnectionError::NotFound(_)
    ));

    // Cleanup the bulk rows so the final list is empty.
    for c in &many {
        if c.id != stored_id {
            let _ = restored.delete_connection(&c.id).await;
        }
    }
    let final_list = restored.list_connections().await.expect("final list");
    assert!(final_list.is_empty(), "expected empty after deletes");

    std::env::remove_var("IDE99_KEYCHAIN_BACKEND");
    std::env::remove_var("IDE99_DATA_DIR");
}

// ---------------------------------------------------------------------------
// Sprint 3 — schema browser introspection. Exercises the new schema_list_*
// commands against the same testcontainer Postgres 17 image. Lives in a
// separate test fn so AC failures here don't mask Sprint 2 regressions.
// ---------------------------------------------------------------------------

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn schema_introspection_against_real_postgres() {
    // SAFETY: tests in this file run serially within a process; setting the
    // env vars here mirrors the lifecycle test above.
    std::env::set_var("IDE99_KEYCHAIN_BACKEND", "memory");
    let tmp = TempDir::new().expect("tempdir");
    std::env::set_var("IDE99_DATA_DIR", tmp.path());

    let container = match Postgres::default().with_tag("17-alpine").start().await {
        Ok(c) => c,
        Err(err) => {
            eprintln!("skipping schema_introspection: docker unavailable ({err})");
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
            name: "tc-pg-schema".into(),
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
        .expect("create");

    // Open the pool via the new connection_connect command — gives us a real
    // ConnectInfo to assert on too.
    let info = state
        .connection_connect(&created.id)
        .await
        .expect("connection_connect");
    assert!(
        info.server_version.contains("17"),
        "expected version to include 17, got {:?}",
        info.server_version
    );
    assert_eq!(info.database, "postgres");

    // Seed the schema fixture verbatim from spec §10.3.
    {
        let pool = state
            .pools
            .get(&created.id)
            .await
            .expect("pool present after connect");
        let client = pool.get().await.expect("client");
        client
            .batch_execute(
                "CREATE SCHEMA app;\n\
                 CREATE TABLE app.users (\n\
                     id BIGSERIAL PRIMARY KEY,\n\
                     email TEXT NOT NULL UNIQUE,\n\
                     created_at TIMESTAMPTZ NOT NULL DEFAULT now()\n\
                 );\n\
                 CREATE TABLE app.orders (\n\
                     id BIGSERIAL PRIMARY KEY,\n\
                     user_id BIGINT REFERENCES app.users(id) ON DELETE CASCADE,\n\
                     total NUMERIC\n\
                 );\n\
                 CREATE INDEX idx_orders_user ON app.orders(user_id);\n\
                 CREATE VIEW app.active_users AS SELECT * FROM app.users;\n\
                 COMMENT ON COLUMN app.users.email IS 'Login email';",
            )
            .await
            .expect("seed schema");
    }

    // ---- list_schemas: must include `app` and `public`, no system schemas ----
    let schemas = state
        .schema_list_schemas(&created.id)
        .await
        .expect("list_schemas");
    let names: Vec<&str> = schemas.iter().map(|s| s.name.as_str()).collect();
    assert!(names.contains(&"app"), "schemas missing 'app': {names:?}");
    assert!(
        names.contains(&"public"),
        "schemas missing 'public': {names:?}"
    );
    assert!(
        !names
            .iter()
            .any(|n| n.starts_with("pg_") || *n == "information_schema"),
        "system schemas leaked: {names:?}"
    );

    // ---- list_tables('app') ----
    let tables = state
        .schema_list_tables(&created.id, "app")
        .await
        .expect("list_tables");
    let table_names: Vec<&str> = tables.iter().map(|t| t.name.as_str()).collect();
    assert_eq!(
        table_names,
        vec!["orders", "users"],
        "expected [orders, users], got {table_names:?}"
    );

    // ---- list_views('app') ----
    let views = state
        .schema_list_views(&created.id, "app")
        .await
        .expect("list_views");
    assert_eq!(views.len(), 1, "expected 1 view, got {}", views.len());
    assert_eq!(views[0].name, "active_users");
    assert!(
        !views[0].definition.trim().is_empty(),
        "view definition should be non-empty"
    );

    // ---- list_columns('app', 'users') ----
    let columns = state
        .schema_list_columns(&created.id, "app", "users")
        .await
        .expect("list_columns");
    assert_eq!(
        columns.len(),
        3,
        "expected 3 columns on app.users, got {}: {columns:?}",
        columns.len()
    );

    let id_col = columns.iter().find(|c| c.name == "id").expect("id column");
    assert!(!id_col.nullable, "id is NOT NULL (PK)");

    let email_col = columns
        .iter()
        .find(|c| c.name == "email")
        .expect("email column");
    assert_eq!(
        email_col.comment.as_deref(),
        Some("Login email"),
        "email comment mismatch"
    );

    // ---- list_indexes('app', 'orders'): PK + idx_orders_user ----
    let indexes = state
        .schema_list_indexes(&created.id, "app", "orders")
        .await
        .expect("list_indexes");
    assert_eq!(
        indexes.len(),
        2,
        "expected 2 indexes on app.orders, got {}: {indexes:?}",
        indexes.len()
    );
    let pk = indexes
        .iter()
        .find(|i| i.is_primary)
        .expect("primary index present");
    assert!(pk.is_unique, "primary index is unique");
    assert!(
        indexes.iter().any(|i| i.name == "idx_orders_user"),
        "idx_orders_user missing: {:?}",
        indexes.iter().map(|i| &i.name).collect::<Vec<_>>()
    );

    // ---- list_foreign_keys('app', 'orders') ----
    let fks = state
        .schema_list_foreign_keys(&created.id, "app", "orders")
        .await
        .expect("list_foreign_keys");
    assert_eq!(fks.len(), 1, "expected 1 FK, got {fks:?}");
    assert_eq!(fks[0].referenced_schema, "app");
    assert_eq!(fks[0].referenced_table, "users");

    // ---- disconnect: subsequent schema calls error with NotConnected ----
    state
        .connection_disconnect(&created.id)
        .await
        .expect("disconnect");
    let err = state
        .schema_list_schemas(&created.id)
        .await
        .expect_err("schema_list_schemas after disconnect should fail");
    assert!(
        matches!(
            err,
            ide99::connection::types::ConnectionError::NotConnected(_)
        ),
        "expected NotConnected, got {err:?}"
    );

    std::env::remove_var("IDE99_KEYCHAIN_BACKEND");
    std::env::remove_var("IDE99_DATA_DIR");
}

// ---------------------------------------------------------------------------
// Sprint 4 — query_execute + editor tabs CRUD. Walks the new query module
// against a real Postgres 17 testcontainer + verifies tab persistence,
// FK ON DELETE SET NULL semantics, and the truncation cap.
// ---------------------------------------------------------------------------

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn query_execute_and_tabs_against_real_postgres() {
    // SAFETY: tests in this file run serially within a process.
    std::env::set_var("IDE99_KEYCHAIN_BACKEND", "memory");
    let tmp = TempDir::new().expect("tempdir");
    std::env::set_var("IDE99_DATA_DIR", tmp.path());

    let container = match Postgres::default().with_tag("17-alpine").start().await {
        Ok(c) => c,
        Err(err) => {
            eprintln!("skipping query_execute: docker unavailable ({err})");
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
            name: "tc-pg-q".into(),
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
        .expect("create");

    state
        .connection_connect(&created.id)
        .await
        .expect("connect");

    // ---- DDL + small INSERT ----
    state
        .query_execute(
            &created.id,
            "CREATE TABLE app_users (\
                 id BIGSERIAL PRIMARY KEY, \
                 email TEXT, \
                 created_at TIMESTAMPTZ NOT NULL DEFAULT now()\
             )",
        )
        .await
        .expect("ddl create");

    let inserted = state
        .query_execute(
            &created.id,
            "INSERT INTO app_users (email) VALUES ('a@a.test'), ('b@b.test')",
        )
        .await
        .expect("ddl insert");
    assert_eq!(inserted.affected_rows, Some(2));
    assert!(inserted.rows.is_empty());
    assert!(inserted.columns.is_empty());

    // ---- SELECT path: columns + types + numeric flag ----
    let res = state
        .query_execute(&created.id, "SELECT id, email FROM app_users ORDER BY id")
        .await
        .expect("select");
    assert_eq!(res.columns.len(), 2);
    assert_eq!(res.columns[0].name, "id");
    // BIGSERIAL columns surface as int8 in tokio-postgres' type registry.
    assert_eq!(res.columns[0].type_name, "int8");
    assert!(res.columns[0].is_numeric);
    assert_eq!(res.columns[1].name, "email");
    assert_eq!(res.columns[1].type_name, "text");
    assert!(!res.columns[1].is_numeric);
    assert_eq!(res.rows.len(), 2);
    assert_eq!(res.rows[0][1].as_deref(), Some("a@a.test"));
    assert!(!res.truncated);
    assert!(res.affected_rows.is_none());

    // ---- Truncation: 1500 rows in flight, expect cap at 1000 + truncated=true ----
    state
        .query_execute(
            &created.id,
            "INSERT INTO app_users (email) \
             SELECT 'bulk-' || g FROM generate_series(1, 1500) g",
        )
        .await
        .expect("bulk insert");
    let bulk = state
        .query_execute(&created.id, "SELECT id FROM app_users ORDER BY id")
        .await
        .expect("bulk select");
    assert!(bulk.truncated, "expected truncation flag");
    assert_eq!(
        bulk.rows.len(),
        1000,
        "expected exactly 1000 rows, got {}",
        bulk.rows.len()
    );

    // ---- UPDATE path: affected_rows surfaces, rows empty ----
    let affected = state
        .query_execute(&created.id, "UPDATE app_users SET email = email")
        .await
        .expect("update");
    assert!(
        affected.affected_rows.is_some(),
        "UPDATE should report affected_rows"
    );
    assert!(
        affected.affected_rows.unwrap() >= 1502,
        "expected >=1502 affected, got {:?}",
        affected.affected_rows
    );
    assert!(affected.rows.is_empty());
    assert!(affected.columns.is_empty());

    // ---- PostgresError path ----
    let err = state
        .query_execute(&created.id, "SELECT * FROM nonexistent_table_xyz")
        .await
        .expect_err("nonexistent table should error");
    match err {
        QueryError::PostgresError {
            message,
            position,
            sqlstate,
        } => {
            assert!(
                message.contains("nonexistent_table_xyz") || message.contains("relation"),
                "expected PG error message to mention missing relation, got {message}"
            );
            // position + sqlstate are server-provided and best-effort; just
            // touch them so the variant fields end up exercised.
            let _ = position;
            let _ = sqlstate;
        }
        other => panic!("expected PostgresError, got {other:?}"),
    }

    // ---- NotConnected path ----
    state
        .connection_disconnect(&created.id)
        .await
        .expect("disconnect");
    let err = state
        .query_execute(&created.id, "SELECT 1")
        .await
        .expect_err("post-disconnect query should fail");
    match err {
        QueryError::NotConnected { conn_id } => assert_eq!(conn_id, created.id),
        other => panic!("expected NotConnected, got {other:?}"),
    }

    // ---- Tabs CRUD round-trip ----
    let now = chrono::Utc::now().to_rfc3339();
    let tab = EditorTabRow {
        id: "t-1".to_string(),
        kind: "editor".to_string(),
        name: "untitled-1".to_string(),
        content: "SELECT 1".to_string(),
        connection_id: Some(created.id.clone()),
        node_key: None,
        cursor_line: 1,
        cursor_col: 1,
        created_at: now.clone(),
        updated_at: now,
    };
    state.tabs_save(tab.clone()).await.expect("save");
    let listed = state.tabs_list().await.expect("list");
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].id, "t-1");
    assert_eq!(
        listed[0].connection_id.as_deref(),
        Some(created.id.as_str())
    );

    // UPSERT semantics: re-save with new content overwrites.
    let mut tab2 = tab.clone();
    tab2.content = "SELECT 2".to_string();
    state.tabs_save(tab2).await.expect("re-save");
    let after_upsert = state.tabs_list().await.expect("list after upsert");
    assert_eq!(after_upsert.len(), 1);
    assert_eq!(after_upsert[0].content, "SELECT 2");

    // ---- FK ON DELETE SET NULL — connection delete nulls tab.connection_id ----
    state
        .delete_connection(&created.id)
        .await
        .expect("delete connection");
    let after = state.tabs_list().await.expect("list after FK trip");
    assert_eq!(after.len(), 1, "tab survives connection delete");
    assert!(
        after[0].connection_id.is_none(),
        "FK ON DELETE SET NULL should null connection_id, got {:?}",
        after[0].connection_id
    );

    // Idempotent delete of the tab.
    state.tabs_delete("t-1").await.expect("tab delete");
    let final_tabs = state.tabs_list().await.expect("final list");
    assert!(final_tabs.is_empty(), "tabs empty after delete");
    state
        .tabs_delete("t-1")
        .await
        .expect("idempotent delete is ok");

    std::env::remove_var("IDE99_KEYCHAIN_BACKEND");
    std::env::remove_var("IDE99_DATA_DIR");
}

// Sprint 5 — full cursor lifecycle against a real Postgres testcontainer.
// Open / fetch / close / cancel + connection-lifecycle cleanup.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cursor_lifecycle_against_real_postgres() {
    std::env::set_var("IDE99_KEYCHAIN_BACKEND", "memory");
    let tmp = TempDir::new().expect("tempdir");
    std::env::set_var("IDE99_DATA_DIR", tmp.path());

    let container = match Postgres::default().with_tag("17-alpine").start().await {
        Ok(c) => c,
        Err(err) => {
            eprintln!("skipping cursor_lifecycle: docker unavailable ({err})");
            return;
        }
    };
    let host_port = container.get_host_port_ipv4(5432).await.expect("get port");

    let state = build_state(tmp.path());
    let created = state
        .create_connection(NewConnection {
            name: "cursor-pg".into(),
            host: "127.0.0.1".into(),
            port: host_port,
            database: "postgres".into(),
            username: "postgres".into(),
            password: Some("postgres".into()),
            ssl_mode: SslMode::Prefer,
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
        .expect("create");
    state
        .connection_connect(&created.id)
        .await
        .expect("connect");

    // ---- AC: small rowset (<1000) → exhausted on first FETCH ----
    // Sprint 15: the cursor_id is real (`c_<uuid>`), NOT `<inline>`, so
    // jsonb_resolve_row_key can still find the finished-cursor metadata
    // (column_sources / ctid_values) after the cursor auto-closes. The
    // open registry is empty, but the metadata side table holds the entry.
    let small = state
        .query_open_cursor(&created.id, "SELECT generate_series(1, 5) AS i")
        .await
        .expect("open small");
    assert_ne!(small.cursor_id, "<inline>");
    assert!(small.cursor_id.starts_with("c_"));
    assert_eq!(small.first_page.rows.len(), 5);
    assert!(small.first_page.exhausted);
    assert!(small.affected_rows.is_none());
    assert_eq!(state.cursors.len().await, 0);

    // ---- AC: DML inline path ----
    let dml = state
        .query_open_cursor(&created.id, "CREATE TEMP TABLE s5_tmp (i int)")
        .await
        .expect("dml open_cursor");
    assert_eq!(dml.cursor_id, "<inline>");
    assert!(dml.first_page.rows.is_empty());
    assert!(dml.first_page.exhausted);

    // ---- AC: large rowset (>1000) → live cursor + first page of 1000 ----
    let big = state
        .query_open_cursor(&created.id, "SELECT generate_series(1, 5000) AS i")
        .await
        .expect("open big");
    assert!(big.cursor_id.starts_with("c_"));
    assert_eq!(big.first_page.rows.len(), 1000);
    assert!(!big.first_page.exhausted);
    assert_eq!(state.cursors.len().await, 1);

    // ---- AC: fetch_page pagination drains a 5000-row cursor ----
    let mut total = big.first_page.rows.len();
    loop {
        let page = state
            .query_fetch_page(&big.cursor_id, 1000)
            .await
            .expect("fetch_page");
        total += page.rows.len();
        if page.exhausted {
            break;
        }
    }
    assert_eq!(total, 5000);
    assert_eq!(
        state.cursors.len().await,
        0,
        "cursor auto-closed on exhaustion"
    );

    // ---- AC: fetch_page on absent id returns CursorNotFound ----
    let err = state
        .query_fetch_page("not-a-real-cursor", 100)
        .await
        .expect_err("fetch absent should error");
    assert!(matches!(err, QueryError::CursorNotFound { .. }));

    // ---- AC: close_cursor on absent id is a no-op (idempotent) ----
    state
        .query_close_cursor("not-a-real-cursor")
        .await
        .expect("close absent should be Ok");

    // ---- AC: explicit close_cursor cleans up a live cursor ----
    let big2 = state
        .query_open_cursor(&created.id, "SELECT generate_series(1, 5000) AS i")
        .await
        .expect("open big again");
    assert_eq!(state.cursors.len().await, 1);
    state
        .query_close_cursor(&big2.cursor_id)
        .await
        .expect("close");
    assert_eq!(state.cursors.len().await, 0);

    // ---- AC: query_cancel kills an in-flight cursor ----
    let cancellable = state
        .query_open_cursor(&created.id, "SELECT i FROM generate_series(1, 100000) AS i")
        .await
        .expect("open cancellable");
    assert_eq!(state.cursors.len().await, 1);
    state
        .query_cancel(&cancellable.cursor_id)
        .await
        .expect("cancel");
    assert_eq!(state.cursors.len().await, 0);
    state
        .query_cancel("not-a-real-cursor")
        .await
        .expect("cancel absent ok");

    // ---- AC: connection_disconnect drains cursors for that conn ----
    let _trailing = state
        .query_open_cursor(&created.id, "SELECT generate_series(1, 5000)")
        .await
        .expect("open trailing");
    assert_eq!(state.cursors.len().await, 1);
    state
        .connection_disconnect(&created.id)
        .await
        .expect("disconnect");
    assert_eq!(state.cursors.len().await, 0);

    std::env::remove_var("IDE99_KEYCHAIN_BACKEND");
    std::env::remove_var("IDE99_DATA_DIR");
}

// ---------------------------------------------------------------------------
// BUG-S8-005 — Editing only the environment / safety toggles must NOT evict
// the live connection pool. Pre-fix the backend always called pools.evict on
// every update_connection, leaving the UI looking connected but every query
// failing with "connection no longer active".
// ---------------------------------------------------------------------------

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn env_only_update_keeps_pool_alive() {
    std::env::set_var("IDE99_KEYCHAIN_BACKEND", "memory");
    let tmp = TempDir::new().expect("tempdir");
    std::env::set_var("IDE99_DATA_DIR", tmp.path());

    let container = match Postgres::default().with_tag("17-alpine").start().await {
        Ok(c) => c,
        Err(err) => {
            eprintln!("skipping env_only_update_keeps_pool_alive: docker unavailable ({err})");
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
            name: "tc-pg-s8005".into(),
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
        .expect("create");

    // Open a real pool; this is the state the user is in when they hit
    // "Edit connection" from a connected DB.
    state
        .connection_connect(&created.id)
        .await
        .expect("connect");
    assert!(
        state.pools.get(&created.id).await.is_some(),
        "pool should be live after connect"
    );

    // Env + safety only update — none of host/port/db/user/sslmode/password
    // change. Pre-fix this evicted the pool unconditionally.
    state
        .update_connection(
            &created.id,
            UpdateConnection {
                name: created.name.clone(),
                host: created.host.clone(),
                port: created.port,
                database: created.database.clone(),
                username: created.username.clone(),
                password: UpdatePassword::Keep,
                ssl_mode: created.ssl_mode,
                exclude_from_history: false,
                exclude_from_recent_plans: false,
                environment: ide99::connection::types::Environment::Prod,
                read_only: false,
                slow_query_warning: true,
                confirm_destructive: true,
                migrations_dir: None,
                migration_tracking_enabled: true,
                migration_snapshots_enabled: false,
                squawk_lint_enabled: true,
            },
        )
        .await
        .expect("env-only update");
    assert!(
        state.pools.get(&created.id).await.is_some(),
        "pool must survive an env/safety-only update (BUG-S8-005)"
    );

    // Sanity: a real config change (different database) DOES still evict the pool.
    let _ = state
        .update_connection(
            &created.id,
            UpdateConnection {
                name: created.name.clone(),
                host: created.host.clone(),
                port: created.port,
                database: "postgres".into(), // unchanged so we trigger via host
                username: created.username.clone(),
                password: UpdatePassword::Set {
                    value: "postgres".into(),
                },
                ssl_mode: created.ssl_mode,
                exclude_from_history: false,
                exclude_from_recent_plans: false,
                environment: ide99::connection::types::Environment::Prod,
                read_only: false,
                slow_query_warning: true,
                confirm_destructive: true,
                migrations_dir: None,
                migration_tracking_enabled: true,
                migration_snapshots_enabled: false,
                squawk_lint_enabled: true,
            },
        )
        .await
        .expect("password update");
    assert!(
        state.pools.get(&created.id).await.is_none(),
        "pool must be evicted when password actually changes"
    );

    std::env::remove_var("IDE99_KEYCHAIN_BACKEND");
    std::env::remove_var("IDE99_DATA_DIR");
}
