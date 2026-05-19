//! Sprint 16 — integration smoke test for the inference orchestration API.
//! Bypasses the Tauri runtime; the AppHandle parameter is NOT available here
//! because `tauri = { version = "2", features = [] }` does not enable the
//! `test` feature, so `tauri::test::mock_app()` is absent from this build.
//!
//! TODO(T21): wire up a proper AppHandle via the `test` feature once
//! acceptance-test infra is in place. The core orchestration logic (sampling,
//! cache write, background task, cache read) is already exercised at the lib
//! unit-test level; this integration test is #[ignore]d until the Tauri test
//! helper becomes available.

#![allow(clippy::unwrap_used, clippy::too_many_lines)]

use std::sync::Arc;
use std::time::Duration;

use deadpool_postgres::{Config, ManagerConfig, Pool, RecyclingMethod, Runtime};
use ide99::query::jsonb::inference;
use ide99::query::jsonb::inference::types::FullyQualifiedColumn;
use ide99::query::jsonb::inference::InferenceResponse;
use tempfile::TempDir;
use testcontainers::core::ImageExt;
use testcontainers::runners::AsyncRunner;
use testcontainers::ContainerAsync;
use testcontainers_modules::postgres::Postgres;
use tokio::sync::Mutex;
use tokio_postgres::NoTls;

struct TestPg {
    _container: ContainerAsync<Postgres>,
    pool: Pool,
}

impl TestPg {
    async fn try_start() -> Option<Self> {
        let container = match Postgres::default().with_tag("17-alpine").start().await {
            Ok(c) => c,
            Err(err) => {
                eprintln!("skipping: docker unavailable ({err})");
                return None;
            }
        };
        let host = container.get_host().await.expect("host");
        let port = container.get_host_port_ipv4(5432).await.expect("port");
        let mut cfg = Config::new();
        cfg.host = Some(host.to_string());
        cfg.port = Some(port);
        cfg.user = Some("postgres".into());
        cfg.password = Some("postgres".into());
        cfg.dbname = Some("postgres".into());
        cfg.manager = Some(ManagerConfig {
            recycling_method: RecyclingMethod::Fast,
        });
        let pool = cfg.create_pool(Some(Runtime::Tokio1), NoTls).unwrap();
        for _ in 0..30 {
            if pool.get().await.is_ok() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
        Some(Self {
            _container: container,
            pool,
        })
    }

    fn pool(&self) -> Pool {
        self.pool.clone()
    }

    async fn exec(&self, sql: &str) {
        let client = self.pool.get().await.expect("client");
        client.batch_execute(sql).await.expect("exec");
    }
}

fn open_test_store(tmp: &TempDir) -> Arc<Mutex<ide99::connection::Store>> {
    let db_path = tmp.path().join("store.db");
    let mut store = ide99::connection::Store::open(&db_path).expect("open store");
    store.run_migrations().expect("migrations");
    Arc::new(Mutex::new(store))
}

fn fqn(table: &str, column: &str) -> FullyQualifiedColumn {
    FullyQualifiedColumn {
        schema: "public".into(),
        table: table.into(),
        column: column.into(),
    }
}

/// Smoke test: first call → Pending, background task populates cache, second
/// call → Ready { schema }.
///
/// Requires Docker + a real Tauri AppHandle (tauri "test" feature). Ignored
/// until T21 acceptance-test infra enables `tauri/test` in Cargo.toml.
#[tokio::test]
#[ignore = "requires tauri/test feature for AppHandle; re-enable in T21 acceptance infra"]
async fn first_request_returns_pending_then_event_populates_cache() {
    let Some(pg) = TestPg::try_start().await else {
        return;
    };
    pg.exec(
        "CREATE TABLE events (data jsonb);
         INSERT INTO events SELECT jsonb_build_object('userId', g, 'event', 'login') FROM generate_series(1, 50) g;
         ANALYZE events;",
    )
    .await;

    let tmp = TempDir::new().expect("tempdir");
    // store and inference_state are constructed here; they are used in the
    // dead-code block below which documents the intended T21 flow.
    let store = open_test_store(&tmp);
    let inference_state = Arc::new(inference::InferenceState::new());

    // tauri::test::mock_app() is not available without the `test` feature.
    // When T21 wires it up, replace the `return` below with:
    //   let app = tauri::test::mock_app().handle().clone();
    // and remove the #[ignore] attribute above.
    eprintln!(
        "TODO(T21): create AppHandle via tauri::test::mock_app() once the \
         `test` feature is enabled in src-tauri/Cargo.toml"
    );

    // Suppress unused-variable warnings — the variables ARE used in the
    // unreachable block below which type-checks the intended T21 flow.
    let _ = (&store, &inference_state);
    return;

    #[allow(unreachable_code, unused_variables)]
    {
        // This block is dead code until T21; it documents the intended flow.
        // It type-checks so that refactors to the inference API surface are
        // caught at compile time even before T21 re-enables the test.
        #[allow(clippy::diverging_sub_expression)]
        let app: tauri::AppHandle = unreachable!("AppHandle not available without tauri/test");

        // First call: cache empty → expect Pending and the spawn to begin.
        let res = inference::request_schema(
            inference_state.clone(),
            app.clone(),
            pg.pool(),
            store.clone(),
            "c1".into(),
            fqn("events", "data"),
        )
        .await
        .unwrap();
        assert!(matches!(res, InferenceResponse::Pending));

        // Wait for the background task to populate the cache. Up to 8s should
        // be ample for a 50-row sample.
        let mut populated = false;
        for _ in 0..40 {
            let s = store.lock().await;
            if let Some(_entry) =
                ide99::query::jsonb::inference::cache::read(s.conn(), "c1", &fqn("events", "data"))
                    .unwrap()
            {
                populated = true;
                break;
            }
            drop(s);
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
        assert!(populated, "cache was not populated within 8s");

        // Second call: should return Ready with the schema.
        let res = inference::request_schema(
            inference_state,
            app,
            pg.pool(),
            store,
            "c1".into(),
            fqn("events", "data"),
        )
        .await
        .unwrap();
        match res {
            InferenceResponse::Ready { schema } => {
                assert!(!schema.nodes.is_empty(), "expected non-empty schema");
            }
            other => panic!("expected Ready, got {other:?}"),
        }
    }
}
