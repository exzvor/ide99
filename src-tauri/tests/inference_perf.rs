//! Sprint 16 acceptance bench — JSONB schema inference p95 < 5s on 1M rows.
//!
//! Gated with `#[ignore]` so it doesn't run in normal `cargo test` flow
//! (1M-row seed + 20 inference runs takes ~3–5 minutes locally). Run via:
//!
//!     cargo test --test inference_perf -- --ignored
//!
//! Skipped silently with a stderr note when Docker isn't available.

#![allow(clippy::unwrap_used, clippy::too_many_lines)]

use std::time::{Duration, Instant};

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

fn fqn(table: &str, column: &str) -> FullyQualifiedColumn {
    FullyQualifiedColumn {
        schema: "public".into(),
        table: table.into(),
        column: column.into(),
    }
}

#[tokio::test]
#[ignore = "long-running 1M-row perf bench; run with --ignored"]
async fn inference_p95_under_5s() {
    let Some(pg) = TestPg::try_start().await else {
        return;
    };

    // Representative JSONB payload (5–10 keys, mix of types). Insert 1M rows.
    // Use generate_series to avoid 1M client roundtrips.
    eprintln!("seeding 1M rows...");
    pg.exec(
        "CREATE TABLE big (data jsonb);
         INSERT INTO big (data)
         SELECT jsonb_build_object(
                  'userId', g,
                  'event', CASE g % 3 WHEN 0 THEN 'login' WHEN 1 THEN 'logout' ELSE 'purchase' END,
                  'timestamp', 1714000000 + g,
                  'preferences', jsonb_build_object(
                      'theme', CASE g % 2 WHEN 0 THEN 'dark' ELSE 'light' END,
                      'language', CASE g % 4 WHEN 0 THEN 'en' WHEN 1 THEN 'ru' ELSE 'es' END
                  ),
                  'tags', CASE WHEN g % 5 = 0 THEN jsonb_build_array('premium', 'verified') ELSE jsonb_build_array() END,
                  'amount', (g * 1.7)::numeric
              )
         FROM generate_series(1, 1000000) g;
         ANALYZE big;",
    )
    .await;
    eprintln!("seed complete; running 20 inference samples...");

    let mut durations: Vec<u64> = Vec::with_capacity(20);
    for i in 0..20 {
        let t = Instant::now();
        let samples = sample_jsonb_column(&pg.pool(), &fqn("big", "data"))
            .await
            .expect("sample succeeded");
        let elapsed_ms = t.elapsed().as_millis() as u64;
        eprintln!(
            "iteration {}: {} ms, {} rows sampled",
            i + 1,
            elapsed_ms,
            samples.len()
        );
        durations.push(elapsed_ms);
        assert!(
            !samples.is_empty(),
            "iteration {} returned 0 samples",
            i + 1
        );
    }

    durations.sort_unstable();
    let p50_idx = durations.len() / 2;
    let p95_idx = (durations.len() as f64 * 0.95) as usize;
    let p99_idx = ((durations.len() as f64 * 0.99) as usize).min(durations.len() - 1);
    let p50 = durations[p50_idx];
    let p95 = durations[p95_idx];
    let p99 = durations[p99_idx];

    eprintln!(
        "durations p50={p50}ms p95={p95}ms p99={p99}ms (n={})",
        durations.len()
    );

    assert!(
        p95 < 5_000,
        "p95 {p95}ms exceeds 5_000ms acceptance threshold; full distribution: {durations:?}"
    );
}
