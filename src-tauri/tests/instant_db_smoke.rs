//! Live smoke against the spg99 Instant Beta VM (Phase 2 wedge proof).
//!
//! Runs the *exact* code path the IDE button will take: ensures a device id
//! on disk, signs an HMAC, POSTs to the control service, parses the response,
//! connects to postgres as the provisioned role, runs `SELECT 1`, then cleans
//! up via the DELETE endpoint.
//!
//! Marked `#[ignore]` so the test stays out of `cargo test` defaults — kick
//! it off with `cargo test --test instant_db_smoke -- --ignored --nocapture`.

use std::time::Instant;

use ide99::instant_db::client;
use tempfile::TempDir;
use tokio_postgres::NoTls;

#[tokio::test(flavor = "current_thread")]
#[ignore]
async fn create_connect_select_delete() {
    let tmp = TempDir::new().expect("tempdir");

    let t0 = Instant::now();
    let created = client::create(tmp.path(), "ru-RU")
        .await
        .expect("instant_db_create against live VM");
    let t_create = t0.elapsed();
    println!(
        "create ok: db_id={} host={}:{} db={} user={} (latency: {:.0}ms)",
        created.db_id,
        created.host,
        created.port,
        created.database,
        created.username,
        t_create.as_secs_f64() * 1000.0
    );
    assert!(created.connection_string.starts_with("postgresql://"));
    assert_eq!(created.ttl_seconds, 3600);

    let t1 = Instant::now();
    let (pg, conn) = tokio_postgres::connect(&created.connection_string, NoTls)
        .await
        .expect("connect to provisioned DB");
    let conn_handle = tokio::spawn(async move {
        let _ = conn.await;
    });
    let rows = pg
        .query(
            "SELECT 1 AS ok, current_database() db, current_user usr",
            &[],
        )
        .await
        .expect("SELECT 1");
    let t_select = t1.elapsed();
    assert_eq!(rows.len(), 1);
    let ok: i32 = rows[0].get("ok");
    let db: String = rows[0].get("db");
    let usr: String = rows[0].get("usr");
    println!(
        "select ok: ok={} db={} usr={} (cold connect+SELECT: {:.0}ms)",
        ok,
        db,
        usr,
        t_select.as_secs_f64() * 1000.0
    );
    assert_eq!(ok, 1);
    assert_eq!(db, created.database);
    assert_eq!(usr, created.username);

    drop(pg);
    let _ = conn_handle.await;

    client::delete(tmp.path(), "ru-RU", &created.db_id)
        .await
        .expect("delete");
    println!(
        "delete ok. total e2e latency: {:.0}ms",
        t0.elapsed().as_secs_f64() * 1000.0
    );
}

#[tokio::test(flavor = "current_thread")]
#[ignore]
async fn per_device_quota_enforced() {
    let tmp = TempDir::new().expect("tempdir");
    let first = client::create(tmp.path(), "ru-RU")
        .await
        .expect("first instant_db_create");

    let second = client::create(tmp.path(), "ru-RU").await;
    assert!(
        matches!(
            second,
            Err(client::InstantDbError::Server { status: 429, .. })
        ),
        "second create from same device_id must 429, got: {second:?}"
    );

    client::delete(tmp.path(), "ru-RU", &first.db_id)
        .await
        .expect("cleanup");
}
