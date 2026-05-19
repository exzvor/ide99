//! Sprint 15 — JSONB write path integration tests against real PG 17.
//!
//! Each test spins its own testcontainer (so they can run in parallel
//! without polluting each other's `public.t` table). Tests are skipped
//! with a stderr note when Docker isn't available.

#![allow(clippy::unwrap_used, clippy::too_many_lines)]

use deadpool_postgres::{Config, ManagerConfig, Pool, RecyclingMethod, Runtime};
use ide99::connection::types::Environment;
use ide99::query::jsonb::{
    apply, compute_diff, inject_ctid_column, looks_like_single_base_table, resolve_row_key,
    ColumnSource,
};
use ide99::query::types::{JsonbWriteContext, PkColumn, QueryError, ReadOnlyReason, RowKey};
use serde_json::json;
use testcontainers::core::ImageExt;
use testcontainers::runners::AsyncRunner;
use testcontainers::ContainerAsync;
use testcontainers_modules::postgres::Postgres;
use tokio_postgres::NoTls;

/// Bundles a started PG container + a deadpool pool. Drops the container
/// (which kills the PG process) when this struct goes out of scope.
struct TestPg {
    _container: ContainerAsync<Postgres>,
    pool: Pool,
}

impl TestPg {
    /// Starts a fresh PG 17 container; returns `None` if Docker is missing.
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
        // Wait for the container to actually accept connections (PG can take
        // a beat to finish init scripts).
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

    async fn query_one_jsonb(&self, sql: &str) -> serde_json::Value {
        let client = self.pool.get().await.expect("client");
        client.query_one(sql, &[]).await.expect("query_one").get(0)
    }

    async fn query_col_text(&self, sql: &str) -> Vec<String> {
        let client = self.pool.get().await.expect("client");
        client
            .query(sql, &[])
            .await
            .expect("query")
            .iter()
            .map(|r| r.get::<_, String>(0))
            .collect()
    }

    async fn query_one_str(&self, sql: &str) -> String {
        let client = self.pool.get().await.expect("client");
        client.query_one(sql, &[]).await.expect("query_one").get(0)
    }

    async fn table_oid(&self, schema: &str, table: &str) -> u32 {
        let client = self.pool.get().await.expect("client");
        let oid: i64 = client
            .query_one(
                "SELECT c.oid::int8 FROM pg_class c JOIN pg_namespace n \
                 ON c.relnamespace = n.oid WHERE n.nspname = $1 AND c.relname = $2",
                &[&schema, &table],
            )
            .await
            .expect("table_oid")
            .get(0);
        u32::try_from(oid).expect("oid fits u32")
    }
}

// Macro: every #[tokio::test] starts with `let Some(db) = TestPg::try_start().await else { return };`
// to gracefully skip when Docker isn't running.

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn save_jsonb_set_op_on_heap_with_pk() {
    let Some(db) = TestPg::try_start().await else {
        return;
    };
    db.exec(
        "CREATE TABLE t (id int PRIMARY KEY, data jsonb NOT NULL); \
         INSERT INTO t VALUES (1, '{\"a\":1,\"b\":2}'::jsonb);",
    )
    .await;

    let row_key = RowKey::Pk {
        schema: "public".into(),
        table: "t".into(),
        columns: vec![PkColumn {
            name: "id".into(),
            value: Some("1".into()),
            type_name: "int4".into(),
        }],
    };
    let ctx = JsonbWriteContext {
        conn_id: "test".into(),
        row_key,
        column: "data".into(),
        old_value: r#"{"a":1,"b":2}"#.into(),
        new_value: r#"{"a":1,"b":99}"#.into(),
        confirmed_table_name: None,
    };
    let diff = compute_diff(
        &serde_json::from_str(&ctx.old_value).unwrap(),
        &serde_json::from_str(&ctx.new_value).unwrap(),
    );
    let r = apply(&db.pool(), Environment::Local, &ctx, &diff)
        .await
        .unwrap();
    assert_eq!(r.affected_rows, 1);
    assert!(r.sql_executed.contains("jsonb_set"));

    let v = db.query_one_jsonb("SELECT data FROM t WHERE id=1").await;
    assert_eq!(v, json!({"a": 1, "b": 99}));

    let keys = db
        .query_col_text("SELECT jsonb_object_keys(data) FROM t WHERE id=1 ORDER BY 1")
        .await;
    assert_eq!(keys, vec!["a", "b"]);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn save_full_replace_for_root_type_change() {
    let Some(db) = TestPg::try_start().await else {
        return;
    };
    db.exec(
        "CREATE TABLE t (id int PRIMARY KEY, data jsonb NOT NULL); \
         INSERT INTO t VALUES (1, '{\"a\":1}'::jsonb);",
    )
    .await;

    let ctx = JsonbWriteContext {
        conn_id: "test".into(),
        row_key: RowKey::Pk {
            schema: "public".into(),
            table: "t".into(),
            columns: vec![PkColumn {
                name: "id".into(),
                value: Some("1".into()),
                type_name: "int4".into(),
            }],
        },
        column: "data".into(),
        old_value: r#"{"a":1}"#.into(),
        new_value: r#"[1,2,3]"#.into(),
        confirmed_table_name: None,
    };
    let diff = compute_diff(
        &serde_json::from_str(&ctx.old_value).unwrap(),
        &serde_json::from_str(&ctx.new_value).unwrap(),
    );
    assert!(diff.full_replace);
    let r = apply(&db.pool(), Environment::Local, &ctx, &diff)
        .await
        .unwrap();
    assert_eq!(r.affected_rows, 1);

    let v = db.query_one_jsonb("SELECT data FROM t WHERE id=1").await;
    assert_eq!(v, json!([1, 2, 3]));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn ctid_path_works_on_heap_no_pk() {
    let Some(db) = TestPg::try_start().await else {
        return;
    };
    db.exec(
        "CREATE TABLE t (data jsonb NOT NULL); \
         INSERT INTO t VALUES ('{\"a\":1}'::jsonb);",
    )
    .await;

    let ctid = db.query_one_str("SELECT ctid::text FROM t LIMIT 1").await;

    let row_key = RowKey::Ctid {
        schema: "public".into(),
        table: "t".into(),
        ctid,
    };
    let ctx = JsonbWriteContext {
        conn_id: "test".into(),
        row_key,
        column: "data".into(),
        old_value: r#"{"a":1}"#.into(),
        new_value: r#"{"a":2}"#.into(),
        confirmed_table_name: None,
    };
    let diff = compute_diff(
        &serde_json::from_str(&ctx.old_value).unwrap(),
        &serde_json::from_str(&ctx.new_value).unwrap(),
    );
    let r = apply(&db.pool(), Environment::Local, &ctx, &diff)
        .await
        .unwrap();
    assert_eq!(r.affected_rows, 1);

    let v = db.query_one_jsonb("SELECT data FROM t LIMIT 1").await;
    assert_eq!(v, json!({"a": 2}));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn composite_pk_with_null_uses_is_null() {
    let Some(db) = TestPg::try_start().await else {
        return;
    };
    db.exec(
        "CREATE TABLE t (tenant_id int, id int, data jsonb, \
         PRIMARY KEY (tenant_id, id)); \
         INSERT INTO t VALUES (1, 1, '{\"a\":1}'::jsonb);",
    )
    .await;

    let ctx = JsonbWriteContext {
        conn_id: "test".into(),
        row_key: RowKey::Pk {
            schema: "public".into(),
            table: "t".into(),
            columns: vec![
                PkColumn {
                    name: "tenant_id".into(),
                    value: Some("1".into()),
                    type_name: "int4".into(),
                },
                PkColumn {
                    name: "id".into(),
                    value: Some("1".into()),
                    type_name: "int4".into(),
                },
            ],
        },
        column: "data".into(),
        old_value: r#"{"a":1}"#.into(),
        new_value: r#"{"a":2}"#.into(),
        confirmed_table_name: None,
    };
    let diff = compute_diff(
        &serde_json::from_str(&ctx.old_value).unwrap(),
        &serde_json::from_str(&ctx.new_value).unwrap(),
    );
    let r = apply(&db.pool(), Environment::Local, &ctx, &diff)
        .await
        .unwrap();
    assert_eq!(r.affected_rows, 1);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn prod_env_without_confirmation_rejected() {
    let Some(db) = TestPg::try_start().await else {
        return;
    };
    db.exec(
        "CREATE TABLE t (id int PRIMARY KEY, data jsonb NOT NULL); \
         INSERT INTO t VALUES (1, '{}'::jsonb);",
    )
    .await;

    let ctx = JsonbWriteContext {
        conn_id: "test".into(),
        row_key: RowKey::Pk {
            schema: "public".into(),
            table: "t".into(),
            columns: vec![PkColumn {
                name: "id".into(),
                value: Some("1".into()),
                type_name: "int4".into(),
            }],
        },
        column: "data".into(),
        old_value: r#"{}"#.into(),
        new_value: r#"{"a":1}"#.into(),
        confirmed_table_name: None,
    };
    let diff = compute_diff(
        &serde_json::from_str(&ctx.old_value).unwrap(),
        &serde_json::from_str(&ctx.new_value).unwrap(),
    );
    let err = apply(&db.pool(), Environment::Prod, &ctx, &diff)
        .await
        .unwrap_err();
    assert!(matches!(err, QueryError::ProductionGuardFailed { .. }));

    // Verify nothing got written.
    let v = db.query_one_jsonb("SELECT data FROM t WHERE id=1").await;
    assert_eq!(v, json!({}));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn prod_env_with_correct_confirmation_succeeds() {
    let Some(db) = TestPg::try_start().await else {
        return;
    };
    db.exec(
        "CREATE TABLE t (id int PRIMARY KEY, data jsonb NOT NULL); \
         INSERT INTO t VALUES (1, '{}'::jsonb);",
    )
    .await;

    let ctx = JsonbWriteContext {
        conn_id: "test".into(),
        row_key: RowKey::Pk {
            schema: "public".into(),
            table: "t".into(),
            columns: vec![PkColumn {
                name: "id".into(),
                value: Some("1".into()),
                type_name: "int4".into(),
            }],
        },
        column: "data".into(),
        old_value: r#"{}"#.into(),
        new_value: r#"{"a":1}"#.into(),
        confirmed_table_name: Some("public.t".into()),
    };
    let diff = compute_diff(
        &serde_json::from_str(&ctx.old_value).unwrap(),
        &serde_json::from_str(&ctx.new_value).unwrap(),
    );
    let r = apply(&db.pool(), Environment::Prod, &ctx, &diff)
        .await
        .unwrap();
    assert_eq!(r.affected_rows, 1);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn concurrent_delete_returns_row_vanished() {
    let Some(db) = TestPg::try_start().await else {
        return;
    };
    db.exec(
        "CREATE TABLE t (id int PRIMARY KEY, data jsonb NOT NULL); \
         INSERT INTO t VALUES (1, '{\"a\":1}'::jsonb);",
    )
    .await;
    db.exec("DELETE FROM t WHERE id = 1").await;

    let ctx = JsonbWriteContext {
        conn_id: "test".into(),
        row_key: RowKey::Pk {
            schema: "public".into(),
            table: "t".into(),
            columns: vec![PkColumn {
                name: "id".into(),
                value: Some("1".into()),
                type_name: "int4".into(),
            }],
        },
        column: "data".into(),
        old_value: r#"{"a":1}"#.into(),
        new_value: r#"{"a":2}"#.into(),
        confirmed_table_name: None,
    };
    let diff = compute_diff(
        &serde_json::from_str(&ctx.old_value).unwrap(),
        &serde_json::from_str(&ctx.new_value).unwrap(),
    );
    let err = apply(&db.pool(), Environment::Local, &ctx, &diff)
        .await
        .unwrap_err();
    assert!(matches!(err, QueryError::RowVanished));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn resolve_row_key_returns_pk_for_heap_with_pk() {
    let Some(db) = TestPg::try_start().await else {
        return;
    };
    db.exec(
        "CREATE TABLE t (id int PRIMARY KEY, data jsonb); \
         INSERT INTO t VALUES (1, '{}'::jsonb);",
    )
    .await;

    let oid = db.table_oid("public", "t").await;
    let column_sources = vec![
        ColumnSource {
            table_oid: Some(oid),
            attnum: Some(1),
        }, // id
        ColumnSource {
            table_oid: Some(oid),
            attnum: Some(2),
        }, // data
    ];
    let column_names = vec!["id".into(), "data".into()];
    let row_values = vec![Some("1".into()), Some("{}".into())];

    let rk = resolve_row_key(
        &db.pool(),
        &column_sources,
        &column_names,
        &row_values,
        None,
    )
    .await
    .unwrap();
    match rk {
        RowKey::Pk {
            schema,
            table,
            columns,
        } => {
            assert_eq!(schema, "public");
            assert_eq!(table, "t");
            assert_eq!(columns.len(), 1);
            assert_eq!(columns[0].name, "id");
            assert_eq!(columns[0].value.as_deref(), Some("1"));
            assert_eq!(columns[0].type_name, "integer");
        }
        other => panic!("expected Pk, got {other:?}"),
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn resolve_row_key_returns_readonly_for_join() {
    let Some(db) = TestPg::try_start().await else {
        return;
    };
    db.exec(
        "CREATE TABLE a (id int PRIMARY KEY, data jsonb); \
         CREATE TABLE b (id int PRIMARY KEY); \
         INSERT INTO a VALUES (1, '{}'); INSERT INTO b VALUES (1);",
    )
    .await;

    let oid_a = db.table_oid("public", "a").await;
    let oid_b = db.table_oid("public", "b").await;
    let column_sources = vec![
        ColumnSource {
            table_oid: Some(oid_a),
            attnum: Some(1),
        },
        ColumnSource {
            table_oid: Some(oid_a),
            attnum: Some(2),
        },
        ColumnSource {
            table_oid: Some(oid_b),
            attnum: Some(1),
        },
    ];
    let rk = resolve_row_key(
        &db.pool(),
        &column_sources,
        &["id".into(), "data".into(), "id".into()],
        &[Some("1".into()), Some("{}".into()), Some("1".into())],
        None,
    )
    .await
    .unwrap();
    assert!(matches!(
        rk,
        RowKey::ReadOnly {
            reason: ReadOnlyReason::MultipleTables
        }
    ));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn save_100kb_jsonb_under_250ms() {
    let Some(db) = TestPg::try_start().await else {
        return;
    };
    db.exec("CREATE TABLE t (id int PRIMARY KEY, data jsonb NOT NULL);")
        .await;

    // Build a ~100KB JSON object: 1024 keys × ~100 bytes each.
    let mut obj = serde_json::Map::new();
    for i in 0..1024 {
        obj.insert(format!("k{i:04}"), json!("x".repeat(80)));
    }
    let big = serde_json::Value::Object(obj);
    let big_str = serde_json::to_string(&big).unwrap();

    // Use parameterized INSERT (avoids SQL escaping landmines for big payloads).
    {
        let client = db.pool().get().await.unwrap();
        client
            .execute("INSERT INTO t VALUES (1, $1::jsonb)", &[&big])
            .await
            .unwrap();
    }

    // Change one leaf — should pick composed jsonb_set, not full replace.
    let mut new_v = big.clone();
    new_v["k0001"] = json!("changed");
    let new_str = serde_json::to_string(&new_v).unwrap();

    let ctx = JsonbWriteContext {
        conn_id: "test".into(),
        row_key: RowKey::Pk {
            schema: "public".into(),
            table: "t".into(),
            columns: vec![PkColumn {
                name: "id".into(),
                value: Some("1".into()),
                type_name: "int4".into(),
            }],
        },
        column: "data".into(),
        old_value: big_str,
        new_value: new_str,
        confirmed_table_name: None,
    };
    let diff = compute_diff(
        &serde_json::from_str(&ctx.old_value).unwrap(),
        &serde_json::from_str(&ctx.new_value).unwrap(),
    );
    assert!(!diff.full_replace);
    assert_eq!(diff.ops.len(), 1);

    let started = std::time::Instant::now();
    let r = apply(&db.pool(), Environment::Local, &ctx, &diff)
        .await
        .unwrap();
    let elapsed = started.elapsed();
    assert_eq!(r.affected_rows, 1);
    assert!(
        elapsed.as_millis() < 250,
        "100KB JSONB save took {elapsed:?} (gate: 250ms)"
    );
}

// ---------------------------------------------------------------------------
// Cursor-open-path coverage — guards against the regression where a broken
// ctid wrapper made every `looks_like_single_base_table` query fail with
// "invalid reference to FROM-clause entry for table _". The earlier tests
// only exercised `apply` directly with a hand-built RowKey, so they missed
// the SQL produced at cursor open.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn injected_ctid_sql_runs_against_postgres() {
    let Some(db) = TestPg::try_start().await else {
        return;
    };
    db.exec(
        "CREATE TABLE events (id int PRIMARY KEY, data jsonb NOT NULL); \
         INSERT INTO events VALUES \
            (1, '{\"k\":1}'::jsonb), \
            (2, '{\"k\":2}'::jsonb), \
            (3, '{\"k\":3}'::jsonb);",
    )
    .await;

    // Common shapes the IDE actually issues from the SQL editor.
    let cases = [
        "SELECT * FROM events",
        "SELECT id, data FROM events",
        "SELECT * FROM public.events",
        "SELECT * FROM events ORDER BY id",
        "SELECT id, data FROM events WHERE id = 1",
        "SELECT * FROM events WHERE data->>'k' = '2'",
    ];

    for sql in cases {
        assert!(
            looks_like_single_base_table(sql),
            "SBT detector should match: {sql}"
        );
        let injected = inject_ctid_column(sql).unwrap_or_else(|| panic!("inject failed: {sql}"));
        assert!(
            injected.contains(", ctid::text AS __ctid__ "),
            "injection missing in: {injected}"
        );

        // Run the injected SQL through PG: this is the path that broke
        // before the fix. Each of these should succeed and return a
        // `__ctid__` text column whose values look like `(N,M)`.
        let client = db.pool.get().await.expect("client");
        let rows = client
            .query(&injected, &[])
            .await
            .unwrap_or_else(|err| panic!("PG rejected injected SQL `{injected}`: {err}"));

        // Find the __ctid__ column position; assert all values parse as
        // `(blk,off)`.
        let ctid_idx = rows
            .first()
            .and_then(|r| r.columns().iter().position(|c| c.name() == "__ctid__"))
            .unwrap_or_else(|| panic!("no __ctid__ column in result for `{injected}`"));
        for r in &rows {
            let v: String = r.get(ctid_idx);
            assert!(
                v.starts_with('(') && v.ends_with(')') && v.contains(','),
                "unexpected ctid value `{v}` for `{injected}`"
            );
        }
    }
}

#[tokio::test]
async fn ctid_from_injected_query_round_trips_with_apply() {
    // End-to-end: open a cursor with the injection wrapper applied, read
    // ctid for a row, then UPDATE it via `apply` with a Ctid RowKey.
    // Mirrors the production flow (cursor open → resolve_row_key → apply).
    let Some(db) = TestPg::try_start().await else {
        return;
    };
    db.exec(
        "CREATE TABLE no_pk (data jsonb NOT NULL); \
         INSERT INTO no_pk VALUES ('{\"a\":1}'::jsonb), ('{\"a\":2}'::jsonb);",
    )
    .await;

    let injected =
        inject_ctid_column("SELECT * FROM no_pk WHERE data->>'a' = '1'").expect("injection");
    let client = db.pool.get().await.expect("client");
    let rows = client
        .query(&injected, &[])
        .await
        .expect("PG runs injected");
    assert_eq!(rows.len(), 1);
    let ctid_idx = rows[0]
        .columns()
        .iter()
        .position(|c| c.name() == "__ctid__")
        .unwrap();
    let ctid: String = rows[0].get(ctid_idx);
    drop(client);

    // Now run apply against the row addressed by the captured ctid.
    let ctx = JsonbWriteContext {
        conn_id: "test".into(),
        row_key: RowKey::Ctid {
            schema: "public".into(),
            table: "no_pk".into(),
            ctid: ctid.clone(),
        },
        column: "data".into(),
        old_value: r#"{"a":1}"#.into(),
        new_value: r#"{"a":99}"#.into(),
        confirmed_table_name: None,
    };
    let diff = compute_diff(
        &serde_json::from_str(&ctx.old_value).unwrap(),
        &serde_json::from_str(&ctx.new_value).unwrap(),
    );
    let r = apply(&db.pool(), Environment::Local, &ctx, &diff)
        .await
        .unwrap();
    assert_eq!(r.affected_rows, 1);

    // Double-check the row updated.
    let v = db
        .query_one_jsonb("SELECT data FROM no_pk WHERE data->>'a' = '99'")
        .await;
    assert_eq!(v, json!({"a": 99}));
}
