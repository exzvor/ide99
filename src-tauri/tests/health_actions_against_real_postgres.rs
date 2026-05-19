//! Sprint 13 — real-postgres integration tests for action functions. Skipped
//! by default; opt in with `IDE99_PG_URL=postgres://… cargo test --test
//! health_actions_against_real_postgres -- --ignored`.

#![allow(clippy::unwrap_used)]

use std::time::Duration;

use deadpool_postgres::{Config, ManagerConfig, Pool, RecyclingMethod, Runtime};
use ide99::health::actions;
use ide99::health::types::{ActionError, ActionStatus};
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
async fn kill_pid_returns_not_found_for_unknown_pid() {
    let Some(pool) = pool() else {
        return;
    };
    let res = actions::do_kill_pid(&pool, 999_999_999, false)
        .await
        .unwrap();
    assert!(matches!(res.status, ActionStatus::NotFound));
}

#[tokio::test]
#[ignore = "requires IDE99_PG_URL — opt in with --ignored"]
async fn check_pid_returns_false_for_unknown_pid() {
    let Some(pool) = pool() else {
        return;
    };
    let alive = actions::check_pid(&pool, 999_999_999).await.unwrap();
    assert!(!alive);
}

#[tokio::test]
#[ignore = "requires IDE99_PG_URL — opt in with --ignored"]
async fn kill_pid_cancels_long_running_query() {
    let Some(pool) = pool() else {
        return;
    };
    let victim = pool.get().await.unwrap();
    let pid: i32 = victim
        .query_one("SELECT pg_backend_pid()", &[])
        .await
        .unwrap()
        .get(0);

    // Spawn the long-running query in a detached task; await its eventual
    // failure (cancelled by our action below).
    let victim_handle = tokio::spawn(async move {
        let r = victim.batch_execute("SELECT pg_sleep(60)").await;
        r.is_err()
    });

    // Give the sleep ~200ms to actually start before issuing cancel.
    tokio::time::sleep(Duration::from_millis(200)).await;
    let res = actions::do_kill_pid(&pool, pid, false).await.unwrap();
    assert!(matches!(res.status, ActionStatus::Completed));

    // The victim's batch_execute should now have returned an error (cancelled).
    let cancelled = tokio::time::timeout(Duration::from_secs(5), victim_handle)
        .await
        .unwrap()
        .unwrap();
    assert!(cancelled, "victim query should have been cancelled");
}

#[tokio::test]
#[ignore = "requires IDE99_PG_URL — opt in with --ignored"]
async fn kill_pid_with_terminate_returns_terminated_status() {
    let Some(pool) = pool() else {
        return;
    };
    let victim = pool.get().await.unwrap();
    let pid: i32 = victim
        .query_one("SELECT pg_backend_pid()", &[])
        .await
        .unwrap()
        .get(0);
    drop(victim); // release back to pool; terminating it ends that connection

    let res = actions::do_kill_pid(&pool, pid, true).await.unwrap();
    assert!(matches!(res.status, ActionStatus::Terminated));
}

#[tokio::test]
#[ignore = "requires IDE99_PG_URL — opt in with --ignored"]
async fn drop_index_concurrently_succeeds() {
    let Some(pool) = pool() else {
        return;
    };
    let client = pool.get().await.unwrap();
    let table = format!("s13_drop_test_{}", uuid::Uuid::new_v4().simple());
    let idx = format!("idx_{table}");
    client
        .batch_execute(&format!(
            "CREATE TABLE {table} (id SERIAL PRIMARY KEY, x INT);
             CREATE INDEX {idx} ON {table}(x);"
        ))
        .await
        .unwrap();

    let res = actions::do_drop_index(&pool, "public", &idx).await.unwrap();
    assert!(matches!(res.status, ActionStatus::Completed));

    // Index gone, table still there:
    let still_table: bool = client
        .query_one(
            "SELECT EXISTS(SELECT 1 FROM pg_class WHERE relname=$1)",
            &[&table],
        )
        .await
        .unwrap()
        .get(0);
    let index_exists: bool = client
        .query_one(
            "SELECT EXISTS(SELECT 1 FROM pg_class WHERE relname=$1)",
            &[&idx],
        )
        .await
        .unwrap()
        .get(0);
    assert!(still_table && !index_exists);

    client
        .batch_execute(&format!("DROP TABLE {table}"))
        .await
        .unwrap();
}

#[tokio::test]
#[ignore = "requires IDE99_PG_URL — opt in with --ignored"]
async fn analyze_completes_against_real_table() {
    let Some(pool) = pool() else {
        return;
    };
    let client = pool.get().await.unwrap();
    let table = format!("s13_analyze_test_{}", uuid::Uuid::new_v4().simple());
    client
        .batch_execute(&format!(
            "CREATE TABLE {table} (id SERIAL PRIMARY KEY, x INT);
             INSERT INTO {table}(x) SELECT generate_series(1, 100);"
        ))
        .await
        .unwrap();

    let res = actions::do_analyze(&pool, "public", &table).await.unwrap();
    assert!(matches!(res.status, ActionStatus::Completed));

    client
        .batch_execute(&format!("DROP TABLE {table}"))
        .await
        .unwrap();
}

#[tokio::test]
#[ignore = "requires IDE99_PG_URL — opt in with --ignored"]
async fn vacuum_completes_against_real_table() {
    use std::sync::Arc;
    let Some(pool) = pool() else {
        return;
    };
    let registry = Arc::new(actions::ActionRegistry::default());
    let client = pool.get().await.unwrap();
    let table = format!("s13_vacuum_test_{}", uuid::Uuid::new_v4().simple());
    client
        .batch_execute(&format!(
            "CREATE TABLE {table} (id SERIAL PRIMARY KEY, x INT);
             INSERT INTO {table}(x) SELECT generate_series(1, 1000);
             DELETE FROM {table} WHERE x % 2 = 0;"
        ))
        .await
        .unwrap();

    // Tauri AppHandle not available in test harness — call do_vacuum_inner.
    let res = actions::do_vacuum_inner(&pool, &registry, "public", &table)
        .await
        .unwrap();
    assert!(matches!(res.status, ActionStatus::Completed));
    assert!(res.duration_ms > 0);

    client
        .batch_execute(&format!("DROP TABLE {table}"))
        .await
        .unwrap();
}

#[tokio::test]
#[ignore = "requires IDE99_PG_URL — opt in with --ignored"]
async fn reindex_table_completes_against_real_table() {
    use std::sync::Arc;
    let Some(pool) = pool() else {
        return;
    };
    let registry = Arc::new(actions::ActionRegistry::default());
    let client = pool.get().await.unwrap();
    let table = format!("s13_reindex_test_{}", uuid::Uuid::new_v4().simple());
    client
        .batch_execute(&format!(
            "CREATE TABLE {table} (id SERIAL PRIMARY KEY, x INT);
             CREATE INDEX ON {table}(x);"
        ))
        .await
        .unwrap();

    let res = actions::do_reindex_table_inner(&pool, &registry, "public", &table)
        .await
        .unwrap();
    assert!(matches!(res.status, ActionStatus::Completed));

    client
        .batch_execute(&format!("DROP TABLE {table}"))
        .await
        .unwrap();
}

// Suppress unused import warning for ActionError when no test below references it.
#[allow(dead_code)]
fn _force_ref_action_error(_e: ActionError) {}
