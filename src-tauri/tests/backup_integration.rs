//! Sprint 34 — end-to-end backup → restore integration against real PG.
//!
//! Skip-conditions (must be silent):
//!   * `pg_dump` / `pg_restore` not on PATH (CI без PG-client tools).
//!   * `pg_dump` major version < server version (e.g. PG14 client on
//!     a PG17 server — the GH-hosted ubuntu-22.04 default). pg_dump
//!     refuses to dump a newer server, so this is environment, not
//!     a regression.
//!   * Docker / testcontainers unavailable.
//!
//! Скрипт:
//!   1. Поднимаем PG 17 testcontainer.
//!   2. Создаём sourceDB + table `t (id int, name text)` + 3 rows.
//!   3. `runner::run_backup` → custom-format dump в tempfile.
//!   4. Создаём targetDB на том же контейнере, restore'им туда dump'ом.
//!   5. Verify: SELECT * FROM t в targetDB вернёт те же 3 rows.

#![allow(clippy::too_many_lines)]

use std::sync::Arc;

use ide99::backup::runner;
use ide99::backup::types::{BackupOptions, DumpFormat, DumpScope, RestoreOptions};
use ide99::connection::keychain::MemoryKeychain;
use ide99::connection::types::{NewConnection, SslMode};
use ide99::connection::{PoolRegistry, Store};
use ide99::AppState;
use tempfile::TempDir;
use testcontainers::core::ImageExt;
use testcontainers::runners::AsyncRunner;
use testcontainers_modules::postgres::Postgres;
use tokio_postgres::NoTls;

fn build_state(data_dir: &std::path::Path) -> AppState {
    let db_path = data_dir.join("store.db");
    let mut store = Store::open(&db_path).expect("open store");
    store.run_migrations().expect("migrations");
    AppState::with_data_dir(
        store,
        Box::new(MemoryKeychain::new()),
        Arc::new(PoolRegistry::new()),
        data_dir.to_path_buf(),
    )
}

async fn execute(host: &str, port: u16, dbname: &str, sql: &str) {
    let conn_str =
        format!("host={host} port={port} user=postgres password=postgres dbname={dbname}");
    let (client, conn) = tokio_postgres::connect(&conn_str, NoTls)
        .await
        .expect("connect");
    tokio::spawn(async move {
        let _ = conn.await;
    });
    client.batch_execute(sql).await.expect("execute");
}

async fn count(host: &str, port: u16, dbname: &str, table: &str) -> i64 {
    let conn_str =
        format!("host={host} port={port} user=postgres password=postgres dbname={dbname}");
    let (client, conn) = tokio_postgres::connect(&conn_str, NoTls)
        .await
        .expect("connect");
    tokio::spawn(async move {
        let _ = conn.await;
    });
    let row = client
        .query_one(&format!("SELECT count(*) FROM {table}"), &[])
        .await
        .expect("count");
    row.get::<_, i64>(0)
}

/// Returns the major version pg_dump reports (e.g. 14 for "pg_dump (PostgreSQL) 14.18 (Ubuntu …)").
/// `None` if the binary is missing or its output is unparseable.
fn pg_dump_major_version() -> Option<u32> {
    let out = std::process::Command::new("pg_dump")
        .arg("--version")
        .output()
        .ok()?;
    let s = String::from_utf8_lossy(&out.stdout);
    // "pg_dump (PostgreSQL) 17.2 (…)" → split on whitespace, take the third
    // field, then take the integer prefix before the first '.'.
    let ver = s.split_whitespace().nth(2)?;
    ver.split('.').next()?.parse::<u32>().ok()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn dump_then_restore_roundtrip() {
    if which::which("pg_dump").is_err() || which::which("pg_restore").is_err() {
        eprintln!(
            "[skip] backup_integration: pg_dump/pg_restore not on PATH \
             (install Postgres client tools to enable this test)"
        );
        return;
    }

    // Server is pinned to PG17 (Postgres::default().with_tag("17-alpine")
    // below). pg_dump refuses to dump a server newer than itself with a
    // hard error. Default ubuntu-22.04 ships PG14, so skip cleanly when
    // the runner doesn't have PG17 client tools.
    const SERVER_MAJOR: u32 = 17;
    match pg_dump_major_version() {
        Some(v) if v >= SERVER_MAJOR => {}
        Some(v) => {
            eprintln!(
                "[skip] backup_integration: pg_dump v{v} < server v{SERVER_MAJOR} \
                 (install postgresql-client-17 to enable this test)"
            );
            return;
        }
        None => {
            eprintln!("[skip] backup_integration: cannot parse pg_dump --version");
            return;
        }
    }

    std::env::set_var("IDE99_KEYCHAIN_BACKEND", "memory");
    let tmp = TempDir::new().expect("tempdir");
    std::env::set_var("IDE99_DATA_DIR", tmp.path());

    let container = match Postgres::default().with_tag("17-alpine").start().await {
        Ok(c) => c,
        Err(err) => {
            eprintln!("[skip] backup_integration: docker unavailable ({err})");
            return;
        }
    };
    let host_port = container
        .get_host_port_ipv4(5432)
        .await
        .expect("get host port");

    // 1. Создаём source + target databases.
    execute(
        "127.0.0.1",
        host_port,
        "postgres",
        "CREATE DATABASE backup_src;",
    )
    .await;
    execute(
        "127.0.0.1",
        host_port,
        "postgres",
        "CREATE DATABASE backup_tgt;",
    )
    .await;

    // 2. Seed source.
    execute(
        "127.0.0.1",
        host_port,
        "backup_src",
        "CREATE TABLE t (id int PRIMARY KEY, name text); \
         INSERT INTO t VALUES (1,'a'),(2,'b'),(3,'c');",
    )
    .await;

    // 3. Build state + register connections.
    let state = build_state(tmp.path());
    let src_conn = state
        .create_connection(NewConnection {
            name: "src".into(),
            host: "127.0.0.1".into(),
            port: host_port,
            database: "backup_src".into(),
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
            migration_tracking_enabled: false,
            migration_snapshots_enabled: false,
            squawk_lint_enabled: false,
        })
        .await
        .expect("create src");
    let tgt_conn = state
        .create_connection(NewConnection {
            name: "tgt".into(),
            host: "127.0.0.1".into(),
            port: host_port,
            database: "backup_tgt".into(),
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
            migration_tracking_enabled: false,
            migration_snapshots_enabled: false,
            squawk_lint_enabled: false,
        })
        .await
        .expect("create tgt");

    // 4. Run pg_dump через sink-variant (integration tests не могут
    // сконструировать AppHandle без `test`-feature на tauri crate).
    let sink = runner::NoopSink;
    let dump_path = tmp.path().join("src.dump");
    let backup_opts = BackupOptions {
        connection_id: src_conn.id.clone(),
        format: DumpFormat::Custom,
        scope: DumpScope::Both,
        include_schemas: vec![],
        include_tables: vec![],
        exclude_table_data: vec![],
        compress_level: 5,
        parallel_jobs: None,
        output_path: dump_path.to_string_lossy().to_string(),
        include_create_db: false,
        no_owner: true,
    };
    runner::run_backup_with_sink(&sink, &state, "job-dump", backup_opts)
        .await
        .expect("pg_dump succeeded");
    assert!(dump_path.exists(), "dump file not created");
    let dump_size = std::fs::metadata(&dump_path).expect("metadata").len();
    assert!(dump_size > 0, "dump file is empty");

    // 5. Run pg_restore against target DB.
    let restore_opts = RestoreOptions {
        connection_id: tgt_conn.id.clone(),
        source_path: dump_path.to_string_lossy().to_string(),
        clean_before_restore: false,
        create_database: false,
        no_owner: true,
        parallel_jobs: None,
        selected_objects: vec![],
    };
    runner::run_restore_with_sink(&sink, &state, "job-restore", restore_opts)
        .await
        .expect("pg_restore succeeded");

    // 6. Verify row count в target DB.
    let n = count("127.0.0.1", host_port, "backup_tgt", "t").await;
    assert_eq!(n, 3, "expected 3 rows after restore");
}
