//! Integration test for #24 `list_databases` against a real Postgres
//! testcontainer. Requires Docker; skips (with a note) if the container fails
//! to start, matching the pattern in `connection_integration.rs`.

use ide99::connection::types::{SslMode, TestInput};
use ide99::connection::PoolRegistry;
use testcontainers::core::ImageExt;
use testcontainers::runners::AsyncRunner;
use testcontainers_modules::postgres::Postgres;

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn list_databases_works_with_wrong_typed_db_and_excludes_templates() {
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

    let pools = PoolRegistry::new();

    // The typed `database` is deliberately a nonexistent name: the whole point
    // of #24 is that listing succeeds anyway, because it connects to a
    // maintenance DB (postgres/template1), not the typed one.
    let dbs = pools
        .list_databases(TestInput {
            host: "127.0.0.1".into(),
            port: host_port,
            database: "this_database_does_not_exist".into(),
            username: "postgres".into(),
            password: Some("postgres".into()),
            ssl_mode: SslMode::Disable,
        })
        .await
        .expect("list_databases should succeed via the maintenance DB despite a wrong typed db");

    assert!(
        dbs.contains(&"postgres".to_string()),
        "expected 'postgres' in {dbs:?}",
    );
    assert!(
        !dbs.iter().any(|d| d == "template0" || d == "template1"),
        "template databases must be excluded, got {dbs:?}",
    );
    // Results are ORDER BY datname — assert ascending order.
    let mut sorted = dbs.clone();
    sorted.sort();
    assert_eq!(dbs, sorted, "database list must be sorted, got {dbs:?}");
}
