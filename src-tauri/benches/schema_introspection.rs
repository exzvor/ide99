//! Schema-introspection criterion benchmark.
//!
//! Methodology (see spec §10.5):
//! - Spin up a single Postgres 17 testcontainer for the whole run.
//! - Seed schema `bench` with 1000 empty tables via `EXECUTE format(...)`.
//! - Time `state.schema_list_tables(&id, "bench")` per iteration.
//! - Linux CI: informational only — heavy DB queries through Xvfb soft-render
//!   are not representative; the bench self-skips when `CI` is set so CI minutes
//!   aren't burned.
//! - Local macOS: gate <3s per acceptance criterion §2.

#![allow(unknown_lints)]
#![allow(clippy::duration_suboptimal_units)]

use std::sync::Arc;
use std::time::Duration;

use criterion::{criterion_group, criterion_main, Criterion};
use ide99::connection::keychain::MemoryKeychain;
use ide99::connection::types::{NewConnection, SslMode};
use ide99::connection::{PoolRegistry, Store};
use ide99::AppState;
use tempfile::TempDir;
use testcontainers::core::ImageExt;
use testcontainers::runners::AsyncRunner;
use testcontainers_modules::postgres::Postgres;
use tokio::runtime::Runtime;

const TABLE_COUNT: usize = 1000;

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

fn bench_schema_introspection(c: &mut Criterion) {
    if std::env::var("CI").is_ok() {
        eprintln!("schema_introspection bench: CI set, skipping (informational on Linux)");
        return;
    }

    let runtime = Runtime::new().expect("tokio runtime");

    // One-time setup: container + state + seeded schema. Reused across all
    // criterion iterations to amortize the ~5s container boot.
    let setup = runtime.block_on(async {
        std::env::set_var("IDE99_KEYCHAIN_BACKEND", "memory");
        let tmp = TempDir::new().expect("tempdir");
        std::env::set_var("IDE99_DATA_DIR", tmp.path());

        let container = match Postgres::default().with_tag("17-alpine").start().await {
            Ok(c) => c,
            Err(err) => {
                eprintln!("schema_introspection bench: docker unavailable ({err}), skipping");
                return None;
            }
        };
        let host_port = container.get_host_port_ipv4(5432).await.expect("host port");

        let state = build_state(tmp.path());
        let created = state
            .create_connection(NewConnection {
                name: "bench-pg".into(),
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
            .expect("connect");

        // Seed via DO block — single round-trip beats N separate CREATE TABLE
        // statements for a 1000-table fixture.
        {
            let pool = state
                .pools
                .get(&created.id)
                .await
                .expect("pool registered after connect");
            let client = pool.get().await.expect("client");
            client
                .batch_execute(
                    "CREATE SCHEMA bench;\n\
                     DO $$\n\
                     DECLARE i int;\n\
                     BEGIN\n\
                       FOR i IN 1..1000 LOOP\n\
                         EXECUTE format('CREATE TABLE bench.t%s (id int)', i);\n\
                       END LOOP;\n\
                     END$$;",
                )
                .await
                .expect("seed bench schema");
        }

        Some((container, tmp, state, created.id))
    });

    let Some((_container, _tmp, state, conn_id)) = setup else {
        return;
    };

    {
        let mut group = c.benchmark_group("schema_introspection");
        group
            .sample_size(10)
            .warm_up_time(Duration::from_millis(500))
            .measurement_time(Duration::from_secs(10));

        group.bench_function("list_tables_1000", |b| {
            // Drive the async helper through the same tokio runtime used
            // for setup. We avoid criterion's `async_tokio` feature so we
            // don't have to widen the criterion dependency in `Cargo.toml`.
            b.iter(|| {
                let tables = runtime
                    .block_on(state.schema_list_tables(&conn_id, "bench"))
                    .expect("list_tables");
                assert_eq!(tables.len(), TABLE_COUNT, "fixture sanity");
            });
        });

        group.finish();
    }

    // Clean up env vars set during setup.
    std::env::remove_var("IDE99_KEYCHAIN_BACKEND");
    std::env::remove_var("IDE99_DATA_DIR");

    // Median visibility: criterion writes its own report; print a short
    // summary line so CI logs (when run locally) are self-explanatory.
    eprintln!("schema_introspection bench: completed list_tables_1000 group (rows={TABLE_COUNT})");
}

criterion_group!(benches, bench_schema_introspection);
criterion_main!(benches);
