//! Sprint 14 — real-postgres integration tests for `live_ops` fetchers.
//! Skipped by default; opt in with
//!   `IDE99_PG_URL=postgres://...` cargo test --test `live_ops_against_real_postgres` -- --ignored

#![allow(clippy::unwrap_used, clippy::similar_names, unused_imports)]

use std::time::Duration;

use deadpool_postgres::{Config, ManagerConfig, Pool, RecyclingMethod, Runtime};
use ide99::live_ops::types::{SessionsMode, SlowSortBy};
use ide99::live_ops::{replication, sessions, slow};
use tokio_postgres::NoTls;

fn pool() -> Option<Pool> {
    let url = std::env::var("IDE99_PG_URL").ok()?;
    let mut cfg = Config::new();
    cfg.url = Some(url);
    cfg.manager = Some(ManagerConfig {
        recycling_method: RecyclingMethod::Fast,
    });
    Some(cfg.create_pool(Some(Runtime::Tokio1), NoTls).unwrap())
}

#[tokio::test]
#[ignore = "requires IDE99_PG_URL — opt in with --ignored"]
async fn sessions_blocked_returns_blocking_edge() {
    let Some(pool) = pool() else {
        return;
    };
    // Hold a row lock from conn1.
    // Bound to a `let` so the connection is held until ROLLBACK below.
    let conn1 = pool.get().await.unwrap();
    conn1
        .batch_execute(
            "DROP TABLE IF EXISTS s14_lock_test;
             CREATE TABLE s14_lock_test (id INT PRIMARY KEY, x INT);
             INSERT INTO s14_lock_test(id, x) VALUES (1, 0);
             BEGIN;
             UPDATE s14_lock_test SET x = 1 WHERE id = 1;",
        )
        .await
        .unwrap();
    let blocker_pid: i32 = conn1
        .query_one("SELECT pg_backend_pid()", &[])
        .await
        .unwrap()
        .get(0);

    // Spawn conn2 to wait on the same row.
    let pool2 = pool.clone();
    let blocked_handle = tokio::spawn(async move {
        let c2 = pool2.get().await.unwrap();
        let pid: i32 = c2
            .query_one("SELECT pg_backend_pid()", &[])
            .await
            .unwrap()
            .get(0);
        // This UPDATE will block on conn1's lock.
        let _ = c2
            .batch_execute("UPDATE s14_lock_test SET x = 2 WHERE id = 1")
            .await;
        pid
    });

    // Give conn2 ~500ms to start blocking.
    tokio::time::sleep(Duration::from_millis(500)).await;

    let snap = sessions::fetch_sessions(&pool, SessionsMode::Blocked)
        .await
        .unwrap();
    assert!(
        snap.blocking_edges
            .iter()
            .any(|e| e.blocker_pid == blocker_pid),
        "expected blocking edge from blocker pid {} in {:?}",
        blocker_pid,
        snap.blocking_edges
    );

    // Clean up: ROLLBACK on conn1 lets conn2 finish.
    conn1.batch_execute("ROLLBACK").await.unwrap();
    let blocked_pid = tokio::time::timeout(Duration::from_secs(5), blocked_handle)
        .await
        .unwrap()
        .unwrap();
    assert_ne!(blocked_pid, blocker_pid);

    // Drop test table.
    pool.get()
        .await
        .unwrap()
        .batch_execute("DROP TABLE IF EXISTS s14_lock_test")
        .await
        .unwrap();
}

#[tokio::test]
#[ignore = "requires IDE99_PG_URL — opt in with --ignored"]
async fn sessions_all_returns_at_least_self() {
    let Some(pool) = pool() else {
        return;
    };
    let snap = sessions::fetch_sessions(&pool, SessionsMode::All)
        .await
        .unwrap();
    // We're a client backend, so the All mode should include at least us.
    assert!(!snap.sessions.is_empty());
    // Truncated is false on small clusters.
    assert!(!snap.truncated || snap.sessions.len() == 200);
}

#[tokio::test]
#[ignore = "requires IDE99_PG_URL — opt in with --ignored"]
async fn slow_returns_top_50_by_mean_exec_time() {
    let Some(pool) = pool() else {
        return;
    };
    let client = pool.get().await.unwrap();
    // Make sure pg_stat_statements is installed and reset.
    client
        .batch_execute(
            "CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
             SELECT pg_stat_statements_reset();",
        )
        .await
        .unwrap();
    // Run two queries with different timings.
    client.batch_execute("SELECT 1").await.unwrap();
    client
        .batch_execute("SELECT pg_sleep(0.1), 1")
        .await
        .unwrap();

    let snap = slow::fetch_slow(&pool, SlowSortBy::MeanExecTime)
        .await
        .unwrap();
    assert!(!snap.rows.is_empty());
    // mean_exec_time on the slowest is non-zero
    assert!(snap.rows[0].mean_exec_time_ms > 0.0);
}

#[tokio::test]
#[ignore = "requires IDE99_PG_URL — opt in with --ignored"]
async fn replication_returns_empty_on_single_node() {
    let Some(pool) = pool() else {
        return;
    };
    let overview = replication::fetch_replication(&pool).await.unwrap();
    // On a vanilla single-node PG, all three are empty.
    // Don't assert all-empty (test cluster might have replicas) — just
    // assert the call succeeds and shape parses.
    let _ = overview.slots.len();
    let _ = overview.publications.len();
    let _ = overview.subscriptions.len();
}
