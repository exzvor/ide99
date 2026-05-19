//! Sprint 16 — integration test for `stats_delta::fetch_table_stats`.
//!
//! Spins up its own PG 17 container; skips with stderr note when Docker
//! isn't available.

#![allow(clippy::unwrap_used)]

use deadpool_postgres::{Config, ManagerConfig, Pool, RecyclingMethod, Runtime};
use ide99::query::jsonb::inference::stats_delta::fetch_table_stats;
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

#[tokio::test]
async fn fetches_stats_for_real_table() {
    let Some(pg) = TestPg::try_start().await else {
        return;
    };
    pg.exec(
        "CREATE TABLE t (id int);
         INSERT INTO t SELECT generate_series(1, 100);
         ANALYZE t;",
    )
    .await;
    // The autovacuum daemon writes pg_stat_user_tables asynchronously;
    // ANALYZE is sufficient for our SELECTs to see *some* counters,
    // but n_tup_ins is updated by the stats collector with a small lag.
    // Poll for up to 2 seconds.
    let mut stats = None;
    for _ in 0..20 {
        if let Some(s) = fetch_table_stats(&pg.pool(), "public", "t").await.unwrap() {
            if s.n_tup_ins >= 100 {
                stats = Some(s);
                break;
            }
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    let stats = stats.expect("stats arrived within timeout");
    assert!(stats.n_tup_ins >= 100, "n_tup_ins was {}", stats.n_tup_ins);
    assert!(
        stats.n_live_tup >= 100,
        "n_live_tup was {}",
        stats.n_live_tup
    );
}

#[tokio::test]
async fn returns_none_for_nonexistent_table() {
    let Some(pg) = TestPg::try_start().await else {
        return;
    };
    let res = fetch_table_stats(&pg.pool(), "public", "no_such_table")
        .await
        .unwrap();
    assert!(res.is_none());
}

#[tokio::test]
async fn returns_none_for_view() {
    let Some(pg) = TestPg::try_start().await else {
        return;
    };
    pg.exec("CREATE VIEW v AS SELECT 1 AS x;").await;
    // pg_stat_user_tables does not include views.
    let res = fetch_table_stats(&pg.pool(), "public", "v").await.unwrap();
    assert!(res.is_none());
}
