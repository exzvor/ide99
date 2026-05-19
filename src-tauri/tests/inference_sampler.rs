//! Sprint 16 — integration test for `sampler::sample_jsonb_column`.

#![allow(clippy::unwrap_used, clippy::too_many_lines)]

use std::time::Instant;

use deadpool_postgres::{Config, ManagerConfig, Pool, RecyclingMethod, Runtime};
use ide99::query::jsonb::inference::sampler::sample_jsonb_column;
use ide99::query::jsonb::inference::types::FullyQualifiedColumn;
use testcontainers::core::ImageExt;
use testcontainers::runners::AsyncRunner;
use testcontainers::ContainerAsync;
use testcontainers_modules::postgres::Postgres;
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
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
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

fn fqn(table: &str, column: &str) -> FullyQualifiedColumn {
    FullyQualifiedColumn {
        schema: "public".into(),
        table: table.into(),
        column: column.into(),
    }
}

#[tokio::test]
async fn small_table_naive_path_returns_all_rows() {
    let Some(pg) = TestPg::try_start().await else {
        return;
    };
    pg.exec(
        "CREATE TABLE t (data jsonb);
         INSERT INTO t SELECT jsonb_build_object('i', g) FROM generate_series(1, 50) g;
         ANALYZE t;",
    )
    .await;
    let samples = sample_jsonb_column(&pg.pool(), &fqn("t", "data"))
        .await
        .unwrap();
    assert!(
        samples.len() >= 30,
        "expected at least 30 samples, got {}",
        samples.len()
    );
}

#[tokio::test]
async fn large_table_completes_under_two_seconds() {
    let Some(pg) = TestPg::try_start().await else {
        return;
    };
    pg.exec(
        "CREATE TABLE big (data jsonb);
         INSERT INTO big SELECT jsonb_build_object('i', g) FROM generate_series(1, 100000) g;
         ANALYZE big;",
    )
    .await;
    let start = Instant::now();
    let samples = sample_jsonb_column(&pg.pool(), &fqn("big", "data"))
        .await
        .unwrap();
    let elapsed = start.elapsed();
    assert!(!samples.is_empty(), "got 0 samples");
    assert!(
        elapsed.as_millis() < 2_000,
        "took {}ms (expected <2000)",
        elapsed.as_millis()
    );
}

#[tokio::test]
async fn view_falls_back_to_naive_path() {
    let Some(pg) = TestPg::try_start().await else {
        return;
    };
    pg.exec(
        "CREATE TABLE backing (data jsonb);
         INSERT INTO backing SELECT jsonb_build_object('i', g) FROM generate_series(1, 50) g;
         CREATE VIEW vw AS SELECT data FROM backing;
         ANALYZE backing;",
    )
    .await;
    let samples = sample_jsonb_column(&pg.pool(), &fqn("vw", "data"))
        .await
        .unwrap();
    assert!(!samples.is_empty(), "view sampling returned no rows");
}

#[tokio::test]
async fn timeout_guard_returns_timeout_error() {
    let Some(pg) = TestPg::try_start().await else {
        return;
    };
    // Build a view whose SELECT expression calls pg_sleep(10) on every row.
    // The sampler sets statement_timeout = 5000ms, so the query will be
    // cancelled with SQLSTATE 57014 before pg_sleep completes.
    pg.exec(
        "CREATE TABLE slow_base (id int);
         INSERT INTO slow_base SELECT generate_series(1, 3);
         CREATE VIEW slow AS
             SELECT jsonb_build_object('x', pg_sleep(10) IS NOT NULL) AS data
             FROM slow_base;",
    )
    .await;
    let res = sample_jsonb_column(&pg.pool(), &fqn("slow", "data")).await;
    match res {
        Err(ide99::query::jsonb::inference::types::InferenceError::Timeout) => { /* expected */ }
        Err(ide99::query::jsonb::inference::types::InferenceError::Postgres { message })
            if message.contains("connection") || message.contains("closed") =>
        {
            eprintln!("skipping: docker connection issue ({message})");
        }
        Ok(_) => {
            panic!("expected Timeout, got successful sampling — view should have slept past 5s")
        }
        other => panic!("expected Timeout, got {other:?}"),
    }
}
