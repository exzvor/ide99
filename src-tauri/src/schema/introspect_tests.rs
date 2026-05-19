//! — testcontainers-driven integration tests for
//! `schema::introspect`. Each test spins its own ephemeral PG container so
//! catalog state is hermetic.
//!
//! All tests gracefully `[skip]` if Docker is unavailable on the host —
//! mirrors the pattern in `migrations::dryrun::tests`.

#![allow(clippy::missing_panics_doc)]

use deadpool_postgres::{Manager, ManagerConfig, Pool, RecyclingMethod, Runtime};
use testcontainers::core::ImageExt;
use testcontainers::runners::AsyncRunner;
use testcontainers::ContainerAsync;
use testcontainers_modules::postgres::Postgres;
use tokio_postgres::{Config, NoTls};

use crate::schema::introspect;

/// Spin a fresh `postgres:17-alpine` container, return (container, pool).
/// `None` if Docker is unavailable so the test can `[skip]` cleanly.
async fn try_pg_pool() -> Option<(ContainerAsync<Postgres>, Pool)> {
    let container = Postgres::default()
        .with_tag("17-alpine")
        .start()
        .await
        .ok()?;
    let host = container.get_host().await.ok()?.to_string();
    let port = container.get_host_port_ipv4(5432).await.ok()?;
    let mut cfg = Config::new();
    cfg.host(&host)
        .port(port)
        .dbname("postgres")
        .user("postgres")
        .password("postgres");
    let mgr = Manager::from_config(
        cfg,
        NoTls,
        ManagerConfig {
            recycling_method: RecyclingMethod::Fast,
        },
    );
    let pool = Pool::builder(mgr)
        .max_size(4)
        .runtime(Runtime::Tokio1)
        .build()
        .ok()?;
    // Sanity-check the pool is usable (waits for the container's pg_ctl boot).
    let client = pool.get().await.ok()?;
    client.simple_query("SELECT 1").await.ok()?;
    Some((container, pool))
}

/// Run a `;`-separated DDL script as a single simple-query batch.
async fn exec_setup(pool: &Pool, sql: &str) {
    let client = pool.get().await.expect("pool client");
    client.batch_execute(sql).await.expect("setup ddl");
}

#[tokio::test]
async fn roundtrip_basic_table() {
    let Some((_c, pool)) = try_pg_pool().await else {
        eprintln!("[skip] docker / testcontainers not available");
        return;
    };
    exec_setup(
        &pool,
        "CREATE TABLE t (id int PRIMARY KEY, name text NOT NULL DEFAULT 'x', email text);",
    )
    .await;

    let def = introspect::get_table_definition(&pool, "public", "t")
        .await
        .expect("fetch");
    assert_eq!(def.schema, "public");
    assert_eq!(def.name, "t");
    assert_eq!(
        def.columns.len(),
        3,
        "expected 3 cols, got {:?}",
        def.columns
    );
    assert_eq!(def.columns[0].name, "id");
    assert_eq!(def.columns[1].name, "name");
    assert!(!def.columns[1].nullable, "name is NOT NULL");
    let default = def.columns[1].default.as_deref().unwrap_or("");
    assert!(
        default.contains("'x'"),
        "default should mention 'x', got {default:?}"
    );
    assert_eq!(def.constraints.len(), 1, "exactly one PK constraint");
    assert_eq!(def.constraints[0].kind, "pk");
    assert_eq!(def.constraints[0].columns, vec!["id".to_string()]);
    // The PK fabricates an implicit unique index — surfaces in `indexes`.
    assert!(!def.indexes.is_empty(), "PK creates an index");
    assert!(
        def.indexes.iter().any(|i| i.primary),
        "one index is primary"
    );
    assert!(!def.rls_enabled);
    assert!(def.partition.is_none());
}

#[tokio::test]
async fn roundtrip_table_with_generated_columns() {
    let Some((_c, pool)) = try_pg_pool().await else {
        eprintln!("[skip] docker / testcontainers not available");
        return;
    };
    exec_setup(
        &pool,
        "CREATE TABLE t (a int, b int GENERATED ALWAYS AS (a*2) STORED);",
    )
    .await;

    let def = introspect::get_table_definition(&pool, "public", "t")
        .await
        .expect("fetch");
    assert_eq!(def.columns.len(), 2);
    let b = &def.columns[1];
    let g = b.generated.as_ref().expect("b has generated metadata");
    assert_eq!(g.kind, "stored");
    // PG normalizes `a*2` to `(a * 2)`; assert on the operands rather than
    // exact whitespace.
    assert!(
        g.expression.contains('a') && g.expression.contains('2') && g.expression.contains('*'),
        "expression should reference a*2, got {:?}",
        g.expression
    );
    // Generated columns must NOT have `default` set (the expression text
    // belongs to `generated`).
    assert!(
        b.default.is_none(),
        "generated col should have no separate default, got {:?}",
        b.default
    );
}

#[tokio::test]
async fn roundtrip_table_with_rls() {
    let Some((_c, pool)) = try_pg_pool().await else {
        eprintln!("[skip] docker / testcontainers not available");
        return;
    };
    exec_setup(
        &pool,
        "CREATE TABLE t (id int); ALTER TABLE t ENABLE ROW LEVEL SECURITY;",
    )
    .await;

    let def = introspect::get_table_definition(&pool, "public", "t")
        .await
        .expect("fetch");
    assert!(def.rls_enabled, "rls_enabled should be true");
}

#[tokio::test]
async fn roundtrip_partitioned_table() {
    let Some((_c, pool)) = try_pg_pool().await else {
        eprintln!("[skip] docker / testcontainers not available");
        return;
    };
    exec_setup(
        &pool,
        "CREATE TABLE p (id int, c text) PARTITION BY RANGE (id);",
    )
    .await;

    let def = introspect::get_table_definition(&pool, "public", "p")
        .await
        .expect("fetch");
    let part = def.partition.as_ref().expect("partition info");
    assert_eq!(part.strategy, "range");
    assert!(!part.key.is_empty(), "partition key should be non-empty");
}

#[tokio::test]
async fn roundtrip_view() {
    let Some((_c, pool)) = try_pg_pool().await else {
        eprintln!("[skip] docker / testcontainers not available");
        return;
    };
    exec_setup(&pool, "CREATE VIEW v AS SELECT 1 AS x;").await;

    let def = introspect::get_view_definition(&pool, "public", "v")
        .await
        .expect("fetch");
    assert_eq!(def.name, "v");
    assert!(!def.body.trim().is_empty(), "body should be non-empty");
    assert!(def.body.contains('1'), "body should reference SELECT 1");
}

#[tokio::test]
async fn roundtrip_matview_unpopulated() {
    let Some((_c, pool)) = try_pg_pool().await else {
        eprintln!("[skip] docker / testcontainers not available");
        return;
    };
    exec_setup(
        &pool,
        "CREATE MATERIALIZED VIEW m AS SELECT 1 AS x WITH NO DATA;",
    )
    .await;

    let def = introspect::get_matview_definition(&pool, "public", "m")
        .await
        .expect("fetch");
    assert_eq!(def.name, "m");
    assert!(
        !def.populated,
        "matview created WITH NO DATA is unpopulated"
    );
    assert!(!def.body.trim().is_empty());
}

#[tokio::test]
async fn roundtrip_partial_unique_include() {
    let Some((_c, pool)) = try_pg_pool().await else {
        eprintln!("[skip] docker / testcontainers not available");
        return;
    };
    exec_setup(
        &pool,
        "CREATE TABLE t (a int, b int, c int); \
         CREATE UNIQUE INDEX i ON t (a) INCLUDE (b) WHERE c IS NOT NULL;",
    )
    .await;

    let def = introspect::get_index_definition(&pool, "public", "i")
        .await
        .expect("fetch");
    assert_eq!(def.name, "i");
    assert_eq!(def.table, "t");
    assert!(def.unique, "should be UNIQUE");
    assert!(!def.primary);
    assert_eq!(def.columns, vec!["a".to_string()]);
    assert_eq!(def.include, vec!["b".to_string()]);
    assert!(def.predicate.is_some(), "partial WHERE clause must surface");
    assert!(
        def.definition
            .to_uppercase()
            .contains("CREATE UNIQUE INDEX"),
        "verbatim DDL should round-trip, got {:?}",
        def.definition
    );
}

#[tokio::test]
async fn reads_full_sequence_options() {
    let Some((_c, pool)) = try_pg_pool().await else {
        eprintln!("[skip] docker / testcontainers not available");
        return;
    };
    exec_setup(
        &pool,
        "CREATE SEQUENCE s START 100 INCREMENT 5 MINVALUE 50 MAXVALUE 1000 CACHE 10 CYCLE;",
    )
    .await;

    let def = introspect::get_sequence_definition(&pool, "public", "s")
        .await
        .expect("fetch");
    assert_eq!(def.name, "s");
    assert_eq!(def.start, 100);
    assert_eq!(def.increment, 5);
    assert_eq!(def.min_value, 50);
    assert_eq!(def.max_value, 1000);
    assert_eq!(def.cache, 10);
    assert!(def.cycle);
    assert!(def.owned_by.is_none(), "standalone sequence has no owner");
    assert_eq!(def.data_type, "bigint", "default sequence data_type");
}

#[tokio::test]
async fn list_matviews_returns_only_matviews() {
    let Some((_c, pool)) = try_pg_pool().await else {
        eprintln!("[skip] docker / testcontainers not available");
        return;
    };
    exec_setup(
        &pool,
        "CREATE TABLE plain (id int); \
         CREATE VIEW v AS SELECT 1 AS x; \
         CREATE MATERIALIZED VIEW m AS SELECT 1 AS x;",
    )
    .await;

    let mvs = introspect::list_matviews(&pool, "public")
        .await
        .expect("fetch");
    assert_eq!(mvs.len(), 1, "only `m` should appear, got {mvs:?}");
    assert_eq!(mvs[0].name, "m");
    assert!(mvs[0].populated, "default matview is populated");
}

#[tokio::test]
async fn list_sequences_excludes_serial_implicit() {
    let Some((_c, pool)) = try_pg_pool().await else {
        eprintln!("[skip] docker / testcontainers not available");
        return;
    };
    exec_setup(&pool, "CREATE TABLE t (id serial); CREATE SEQUENCE s;").await;

    let seqs = introspect::list_sequences(&pool, "public")
        .await
        .expect("fetch");
    let names: Vec<&str> = seqs.iter().map(|s| s.name.as_str()).collect();
    assert_eq!(
        names,
        vec!["s"],
        "implicit `t_id_seq` must be hidden, only `s` listed"
    );
}
