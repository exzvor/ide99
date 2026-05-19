//! — testcontainers-driven integration tests for function /
//! procedure / trigger introspection. Each test spins its own ephemeral PG
//! container so catalog state is hermetic. Mirrors the pattern in
//! `introspect_tests.rs` (Docker-unavailable hosts `[skip]` cleanly).

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
    let mgr = Manager::from_config(        cfg,
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
async fn roundtrip_simple_sql_function() {
    let Some((_c, pool)) = try_pg_pool().await else {
        eprintln!("[skip] docker / testcontainers not available");
        return;
    };
    exec_setup(        &pool,
        "CREATE FUNCTION public.add(a integer, b integer) RETURNS integer \
         LANGUAGE sql AS 'SELECT a + b';",
)
    .await;

    let def = introspect::get_function_definition(&pool, "public", "add", "a integer, b integer")
        .await
        .expect("fetch");
    assert_eq!(def.name, "add");
    assert_eq!(def.language, "sql");
    assert_eq!(def.parameters.len(), 2, "params: {:?}", def.parameters);
    assert_eq!(def.parameters[0].name, "a");
    assert_eq!(def.parameters[0].mode, "in");
    assert_eq!(def.parameters[0].type_text, "integer");
    assert_eq!(def.parameters[1].name, "b");
    assert_eq!(def.return_kind, "scalar");
    assert_eq!(def.return_type.as_deref(), Some("integer"));
    assert_eq!(def.volatility, "volatile", "PG default volatility");
    assert!(!def.security_definer);
    assert!(        def.estimated_rows.is_none(),
        "scalar fn has no rows estimate"
);
}

#[tokio::test]
async fn roundtrip_plpgsql_function() {
    let Some((_c, pool)) = try_pg_pool().await else {
        eprintln!("[skip] docker / testcontainers not available");
        return;
    };
    exec_setup(        &pool,
        "CREATE FUNCTION public.greet(name text) RETURNS text LANGUAGE plpgsql AS \
         $$ BEGIN RETURN 'hello ' || name; END; $$;",
)
    .await;

    let def = introspect::get_function_definition(&pool, "public", "greet", "name text")
        .await
        .expect("fetch");
    assert_eq!(def.language, "plpgsql");
    assert_eq!(def.parameters.len(), 1);
    assert_eq!(def.parameters[0].name, "name");
    assert!(        def.body.contains("RETURN"),
        "body should contain RETURN, got {:?}",
        def.body
);
}

#[tokio::test]
async fn roundtrip_function_with_default_param() {
    let Some((_c, pool)) = try_pg_pool().await else {
        eprintln!("[skip] docker / testcontainers not available");
        return;
    };
    exec_setup(        &pool,
        "CREATE FUNCTION public.f(a integer DEFAULT 5) RETURNS integer \
         LANGUAGE sql AS 'SELECT a';",
)
    .await;

    let def = introspect::get_function_definition(&pool, "public", "f", "a integer DEFAULT 5")
        .await
        .expect("fetch");
    assert_eq!(def.parameters.len(), 1);
    assert_eq!(        def.parameters[0].default.as_deref(),
        Some("5"),
        "default should be '5', got {:?}",
        def.parameters[0].default
);
}

#[tokio::test]
async fn roundtrip_setof_function() {
    let Some((_c, pool)) = try_pg_pool().await else {
        eprintln!("[skip] docker / testcontainers not available");
        return;
    };
    exec_setup(        &pool,
        "CREATE FUNCTION public.f() RETURNS SETOF integer LANGUAGE sql AS 'SELECT 1';",
)
    .await;

    let def = introspect::get_function_definition(&pool, "public", "f", "")
        .await
        .expect("fetch");
    assert_eq!(def.return_kind, "setof");
    assert_eq!(def.return_type.as_deref(), Some("integer"));
}

#[tokio::test]
async fn roundtrip_function_immutable_security_definer() {
    let Some((_c, pool)) = try_pg_pool().await else {
        eprintln!("[skip] docker / testcontainers not available");
        return;
    };
    exec_setup(        &pool,
        "CREATE FUNCTION public.f() RETURNS integer LANGUAGE sql \
         IMMUTABLE SECURITY DEFINER AS 'SELECT 1';",
)
    .await;

    let def = introspect::get_function_definition(&pool, "public", "f", "")
        .await
        .expect("fetch");
    assert_eq!(def.volatility, "immutable");
    assert!(def.security_definer);
}

#[tokio::test]
async fn roundtrip_procedure_simple() {
    let Some((_c, pool)) = try_pg_pool().await else {
        eprintln!("[skip] docker / testcontainers not available");
        return;
    };
    exec_setup(        &pool,
        "CREATE PROCEDURE public.do_nothing() LANGUAGE plpgsql AS \
         $$ BEGIN NULL; END; $$;",
)
    .await;

    let def = introspect::get_procedure_definition(&pool, "public", "do_nothing", "")
        .await
        .expect("fetch");
    assert_eq!(def.name, "do_nothing");
    assert_eq!(def.language, "plpgsql");
    assert!(        def.parameters.is_empty(),
        "no params, got {:?}",
        def.parameters
);
    assert!(        def.body.contains("NULL;"),
        "body should contain NULL;, got {:?}",
        def.body
);
}

#[tokio::test]
async fn roundtrip_trigger_before_insert_for_each_row() {
    let Some((_c, pool)) = try_pg_pool().await else {
        eprintln!("[skip] docker / testcontainers not available");
        return;
    };
    exec_setup(        &pool,
        "CREATE TABLE public.t (id integer); \
         CREATE FUNCTION public.my_trg_fn() RETURNS TRIGGER LANGUAGE plpgsql AS \
         $$ BEGIN RETURN NEW; END; $$; \
         CREATE TRIGGER my_trigger BEFORE INSERT ON public.t \
         FOR EACH ROW EXECUTE FUNCTION public.my_trg_fn();",
)
    .await;

    let def = introspect::get_trigger_definition(&pool, "public", "t", "my_trigger")
        .await
        .expect("fetch");
    assert_eq!(def.name, "my_trigger");
    assert_eq!(def.timing, "before");
    assert!(def.events.insert);
    assert!(!def.events.update);
    assert!(!def.events.delete);
    assert!(!def.events.truncate);
    assert_eq!(def.for_each, "row");
    assert_eq!(def.function_name, "my_trg_fn");
    assert_eq!(def.function_schema, "public");
    assert!(def.enabled, "default trigger is enabled");
    assert!(def.update_columns.is_empty(), "no UPDATE OF cols");
    assert!(def.when_clause.is_none(), "no WHEN clause");
}

#[tokio::test]
async fn list_functions_excludes_internal_functions() {
    let Some((_c, pool)) = try_pg_pool().await else {
        eprintln!("[skip] docker / testcontainers not available");
        return;
    };
    exec_setup(        &pool,
        "CREATE FUNCTION public.only_user_fn() RETURNS integer LANGUAGE sql AS 'SELECT 1';",
)
    .await;

    let fns = introspect::list_functions(&pool, "public", false)
        .await
        .expect("fetch");
    let names: Vec<&str> = fns.iter().map(|f| f.name.as_str()).collect();
    assert_eq!(        names,
        vec!["only_user_fn"],
        "schema-scoped query must hide pg_catalog fns, got {names:?}"
);
    assert_eq!(fns[0].return_kind, "scalar");
    assert_eq!(fns[0].return_type.as_deref(), Some("integer"));
}

#[tokio::test]
async fn list_functions_trigger_only_returns_only_trigger_returning() {
    let Some((_c, pool)) = try_pg_pool().await else {
        eprintln!("[skip] docker / testcontainers not available");
        return;
    };
    exec_setup(        &pool,
        "CREATE FUNCTION public.normal_fn() RETURNS integer LANGUAGE sql AS 'SELECT 1'; \
         CREATE FUNCTION public.trg_fn() RETURNS TRIGGER LANGUAGE plpgsql AS \
         $$ BEGIN RETURN NEW; END; $$;",
)
    .await;

    let fns = introspect::list_functions(&pool, "public", true)
        .await
        .expect("fetch");
    let names: Vec<&str> = fns.iter().map(|f| f.name.as_str()).collect();
    assert_eq!(names, vec!["trg_fn"], "trigger_only filter, got {names:?}");
    assert_eq!(fns[0].return_kind, "trigger");
    assert!(        fns[0].return_type.is_none(),
        "trigger-returning fn has no surfaced return_type"
);
}
