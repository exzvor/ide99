//! Sprint 12 — Health Screen integration test against a real Postgres
//! testcontainer. Exercises every one of the 10 card handlers + the
//! snapshots roundtrip through `AppState`.
//!
//! Skips gracefully if Docker is not available (mirrors the pattern in
//! `connection_integration.rs` and `safety_against_real_postgres.rs`).

#![allow(clippy::too_many_lines)]

use std::sync::Arc;

use ide99::connection::keychain::MemoryKeychain;
use ide99::connection::types::{Environment, NewConnection, SslMode};
use ide99::connection::{PoolRegistry, Store};
use ide99::health::{CardError, ReplicationState};
use ide99::AppState;
use tempfile::TempDir;
use testcontainers::core::ImageExt;
use testcontainers::runners::AsyncRunner;
use testcontainers_modules::postgres::Postgres;

fn build_state(data_dir: &std::path::Path) -> AppState {
    let db_path = data_dir.join("store.db");
    let mut store = Store::open(&db_path).expect("open store");
    store.run_migrations().expect("migrations");
    AppState::new(
        store,
        Box::new(MemoryKeychain::new()),
        Arc::new(PoolRegistry::new()),
    )
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn all_ten_health_handlers_against_real_postgres() {
    // SAFETY: tests run serially within a process; setting these env vars at
    // top of the test mirrors the connection_integration.rs pattern.
    std::env::set_var("IDE99_KEYCHAIN_BACKEND", "memory");
    let tmp = TempDir::new().expect("tempdir");
    std::env::set_var("IDE99_DATA_DIR", tmp.path());

    let container = match Postgres::default().with_tag("17-alpine").start().await {
        Ok(c) => c,
        Err(err) => {
            eprintln!("skipping health_pg_integration: docker unavailable ({err})");
            return;
        }
    };
    let host_port = container
        .get_host_port_ipv4(5432)
        .await
        .expect("get host port");

    let state = build_state(tmp.path());
    let created = state
        .create_connection(NewConnection {
            name: "tc-pg-health".into(),
            host: "127.0.0.1".into(),
            port: host_port,
            database: "postgres".into(),
            username: "postgres".into(),
            password: Some("postgres".into()),
            ssl_mode: SslMode::Disable,
            exclude_from_history: false,
            exclude_from_recent_plans: false,
            environment: Environment::Local,
            read_only: false,
            slow_query_warning: false,
            confirm_destructive: false,
            migrations_dir: None,
            migration_tracking_enabled: true,
            migration_snapshots_enabled: false,
            squawk_lint_enabled: true,
        })
        .await
        .expect("create");

    state
        .connection_connect(&created.id)
        .await
        .expect("connect");

    // -----------------------------------------------------------------------
    // Seed: 10K-row table + ANALYZE so missing-indexes / vacuum / bloat
    // queries have realistic input.
    // -----------------------------------------------------------------------
    {
        let pool = state
            .pools
            .get(&created.id)
            .await
            .expect("pool present after connect");
        let client = pool.get().await.expect("client");
        client
            .batch_execute(
                "CREATE TABLE IF NOT EXISTS health_test ( \
                     id SERIAL PRIMARY KEY, \
                     payload TEXT NOT NULL, \
                     created_at TIMESTAMPTZ NOT NULL DEFAULT now() \
                 ); \
                 INSERT INTO health_test (payload) \
                   SELECT md5(random()::text) FROM generate_series(1, 10000); \
                 ANALYZE health_test;",
            )
            .await
            .expect("seed table");

        // Trigger a few seq scans so missing_indexes has rows >100 if it
        // ever fires (the query filters on seq_scan > 100; we don't need
        // the card to be non-empty, just to round-trip).
        for _ in 0..5 {
            let _ = client
                .query("SELECT count(*) FROM health_test WHERE payload = ''", &[])
                .await;
        }
    }

    // -----------------------------------------------------------------------
    // 1. db_size — must succeed; bytes > 0; pretty non-empty.
    // -----------------------------------------------------------------------
    let db_size = state.health_db_size(&created.id).await.expect("db_size");
    assert!(db_size.bytes > 0, "db size should be positive");
    assert!(!db_size.pretty.is_empty(), "pretty string should be set");
    // sparkline_points always contains the current reading at minimum.
    assert!(
        !db_size.sparkline_points.is_empty(),
        "sparkline_points has at least the current bytes"
    );
    // First call → no prior snapshots → growth fields None.
    assert!(db_size.growth_7d_bytes.is_none());
    assert!(db_size.growth_7d_pct.is_none());

    // -----------------------------------------------------------------------
    // 2. bloat — handler runs; rows may legitimately be empty on a fresh DB.
    // -----------------------------------------------------------------------
    let bloat = state.health_bloat(&created.id).await.expect("bloat");
    // Just verify shape — `rows` is Vec<BloatRow>, may be empty.
    for row in &bloat.rows {
        assert!(!row.schema.is_empty());
        assert!(!row.table.is_empty());
        assert!(row.bloat_pct >= 0.0);
        assert!(row.bloat_bytes >= 0);
    }

    // -----------------------------------------------------------------------
    // 3. slow_queries — pg_stat_statements is NOT installed in the default
    // postgres:17-alpine image → must surface as Unavailable with the right
    // install SQL.
    // -----------------------------------------------------------------------
    let slow = state.health_slow_queries(&created.id).await;
    match slow {
        Err(CardError::Unavailable {
            extension,
            install_sql,
        }) => {
            assert_eq!(extension, "pg_stat_statements");
            assert_eq!(install_sql, "CREATE EXTENSION pg_stat_statements;");
        }
        Err(other) => panic!("expected Unavailable for missing pg_stat_statements, got {other:?}"),
        Ok(data) => {
            // If a future image bakes the extension in, accept Ok — but the
            // shape must be sane.
            for row in &data.rows {
                assert!(!row.query.is_empty());
                assert!(row.calls >= 0);
            }
        }
    }

    // -----------------------------------------------------------------------
    // 4. missing_indexes — handler returns Ok with possibly-empty rows.
    // -----------------------------------------------------------------------
    let missing = state
        .health_missing_indexes(&created.id)
        .await
        .expect("missing_indexes");
    for row in &missing.rows {
        assert!(!row.schema.is_empty());
        assert!(!row.table.is_empty());
        assert!(row.seq_scan >= 0);
    }

    // -----------------------------------------------------------------------
    // 5. unused_indexes — returns Ok; PK index excluded by name suffix.
    // -----------------------------------------------------------------------
    let unused = state
        .health_unused_indexes(&created.id)
        .await
        .expect("unused_indexes");
    for row in &unused.rows {
        assert!(!row.index.ends_with("pkey"), "PK indexes must be filtered");
        assert!(row.size_bytes >= 0);
    }

    // -----------------------------------------------------------------------
    // 6. cache_hit — returns Ok; ratio in [0, 100].
    // -----------------------------------------------------------------------
    let cache = state
        .health_cache_hit(&created.id)
        .await
        .expect("cache_hit");
    assert!(
        (0.0..=100.0).contains(&cache.ratio_pct),
        "ratio_pct must be in [0, 100], got {}",
        cache.ratio_pct
    );

    // -----------------------------------------------------------------------
    // 7. active_connections — current ≥ 1 (this very test holds a session);
    //    max == max_connections (positive integer).
    // -----------------------------------------------------------------------
    let active = state
        .health_active_connections(&created.id)
        .await
        .expect("active_connections");
    assert!(
        active.current >= 1,
        "at least our own session is active, got {}",
        active.current
    );
    assert!(
        active.max > 0,
        "max_connections must parse to a positive int"
    );
    let total: i64 = active.by_state.values().sum();
    assert_eq!(total, active.current, "by_state should sum to current");

    // -----------------------------------------------------------------------
    // 8. long_running — handler succeeds; rows likely empty (no >30s queries).
    // -----------------------------------------------------------------------
    let long = state
        .health_long_running(&created.id)
        .await
        .expect("long_running");
    for row in &long.rows {
        assert!(row.duration_seconds >= 0.0);
        assert!(!row.query.is_empty());
    }

    // -----------------------------------------------------------------------
    // 9. vacuum_status — handler succeeds; days_since None for never-vacuumed.
    // -----------------------------------------------------------------------
    let vac = state
        .health_vacuum_status(&created.id)
        .await
        .expect("vacuum_status");
    for row in &vac.rows {
        assert!(!row.schema.is_empty());
        assert!(!row.table.is_empty());
        // days_since is None when both last_vacuum and last_autovacuum are NULL.
        if row.last_vacuum.is_none() && row.last_autovacuum.is_none() {
            assert!(row.days_since.is_none());
        }
    }

    // -----------------------------------------------------------------------
    // 10. replication_lag — no replicas configured → NoReplicas + empty slots.
    // -----------------------------------------------------------------------
    let rep = state
        .health_replication_lag(&created.id)
        .await
        .expect("replication_lag");
    assert!(matches!(rep.state, ReplicationState::NoReplicas));
    assert!(
        rep.slots.is_empty(),
        "no slots configured on a fresh PG, got {:?}",
        rep.slots
    );

    // -----------------------------------------------------------------------
    // Snapshots roundtrip — save then read recent. End-to-end through
    // AppState (the same path the Tauri command takes).
    // -----------------------------------------------------------------------
    state
        .health_snapshots_save(&created.id, db_size.bytes)
        .await
        .expect("snapshots_save");

    let recent = state
        .health_snapshots_recent(&created.id, 7)
        .await
        .expect("snapshots_recent");
    assert_eq!(recent.len(), 1, "exactly one snapshot after first save");
    assert_eq!(recent[0].db_size_bytes, db_size.bytes);

    // Saving again immediately must dedup (≥1h gap rule); count stays 1.
    state
        .health_snapshots_save(&created.id, db_size.bytes + 1)
        .await
        .expect("snapshots_save (dedup)");
    let recent2 = state
        .health_snapshots_recent(&created.id, 7)
        .await
        .expect("snapshots_recent");
    assert_eq!(
        recent2.len(),
        1,
        "1h dedup should reject the second save inside the window"
    );
    assert_eq!(
        recent2[0].db_size_bytes, db_size.bytes,
        "first snapshot wins inside the dedup window"
    );

    // db_size after a snapshot exists → growth fields populated. delta = 0
    // because we saved the *same* bytes; that's still a valid 2-point series.
    let db_size2 = state
        .health_db_size(&created.id)
        .await
        .expect("db_size 2nd");
    assert!(db_size2.growth_7d_bytes.is_some());
    assert!(db_size2.sparkline_points.len() >= 2);

    // -----------------------------------------------------------------------
    // NotConnected after disconnect — every handler must surface the variant.
    // -----------------------------------------------------------------------
    state
        .connection_disconnect(&created.id)
        .await
        .expect("disconnect");

    let err = state.health_db_size(&created.id).await.unwrap_err();
    assert!(matches!(err, CardError::NotConnected));

    let err = state.health_cache_hit(&created.id).await.unwrap_err();
    assert!(matches!(err, CardError::NotConnected));

    let err = state.health_replication_lag(&created.id).await.unwrap_err();
    assert!(matches!(err, CardError::NotConnected));

    std::env::remove_var("IDE99_KEYCHAIN_BACKEND");
    std::env::remove_var("IDE99_DATA_DIR");
}

// ---------------------------------------------------------------------------
// SQLSTATE classification — exercise each branch of `classify` end-to-end
// by triggering real PG errors (function does not exist → 42883, missing
// privileges → 42501) inside a testcontainer.
// ---------------------------------------------------------------------------

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn classify_sqlstates_against_real_postgres() {
    std::env::set_var("IDE99_KEYCHAIN_BACKEND", "memory");
    let tmp = TempDir::new().expect("tempdir");
    std::env::set_var("IDE99_DATA_DIR", tmp.path());

    let container = match Postgres::default().with_tag("17-alpine").start().await {
        Ok(c) => c,
        Err(err) => {
            eprintln!("skipping classify_sqlstates: docker unavailable ({err})");
            return;
        }
    };
    let host_port = container
        .get_host_port_ipv4(5432)
        .await
        .expect("get host port");

    let state = build_state(tmp.path());
    let created = state
        .create_connection(NewConnection {
            name: "tc-pg-classify".into(),
            host: "127.0.0.1".into(),
            port: host_port,
            database: "postgres".into(),
            username: "postgres".into(),
            password: Some("postgres".into()),
            ssl_mode: SslMode::Disable,
            exclude_from_history: false,
            exclude_from_recent_plans: false,
            environment: Environment::Local,
            read_only: false,
            slow_query_warning: false,
            confirm_destructive: false,
            migrations_dir: None,
            migration_tracking_enabled: true,
            migration_snapshots_enabled: false,
            squawk_lint_enabled: true,
        })
        .await
        .expect("create");

    state
        .connection_connect(&created.id)
        .await
        .expect("connect");

    let pool = state.pools.get(&created.id).await.expect("pool");
    let client = pool.get().await.expect("client");

    // 42883 — undefined function. Verify our classify() helper extracts the
    // pg_… token from the message.
    let err = client
        .query("SELECT pg_definitely_not_a_function(1)", &[])
        .await
        .expect_err("expected undefined function error");
    let card_err = ide99::health::commands::classify(err);
    match card_err {
        CardError::Unavailable {
            extension,
            install_sql,
        } => {
            assert!(
                extension.starts_with("pg_"),
                "extracted extension should look like pg_…, got {extension}"
            );
            assert!(install_sql.starts_with("CREATE EXTENSION "));
        }
        other => panic!("expected Unavailable for SQLSTATE 42883, got {other:?}"),
    }

    // 42704 — undefined object (e.g. an unknown collation).
    let err = client
        .query(
            "SELECT 'x'::text COLLATE \"definitely_not_a_collation\"",
            &[],
        )
        .await
        .expect_err("expected undefined object error");
    let card_err = ide99::health::commands::classify(err);
    assert!(matches!(card_err, CardError::Unavailable { .. }));

    // 42501 — insufficient privilege. Create a role without pg_monitor and
    // try to read a privileged catalog. We simulate by REVOKE on a temp
    // table from a fresh role and SELECT under it.
    client
        .batch_execute(
            "DROP ROLE IF EXISTS hclassify_user; \
             CREATE ROLE hclassify_user LOGIN PASSWORD 'pw'; \
             CREATE TABLE IF NOT EXISTS hclassify_secret (x int); \
             REVOKE ALL ON hclassify_secret FROM PUBLIC;",
        )
        .await
        .expect("seed");

    // Connect as the unprivileged role and trigger 42501.
    let mut bad_cfg = tokio_postgres::Config::new();
    bad_cfg
        .host("127.0.0.1")
        .port(host_port)
        .dbname("postgres")
        .user("hclassify_user")
        .password("pw");
    let (bad_client, conn) = bad_cfg
        .connect(tokio_postgres::NoTls)
        .await
        .expect("bad connect");
    tokio::spawn(conn);
    let err = bad_client
        .query("SELECT * FROM hclassify_secret", &[])
        .await
        .expect_err("expected permission denied");
    let card_err = ide99::health::commands::classify(err);
    assert!(
        matches!(
            card_err,
            CardError::Forbidden { ref required_role } if required_role == "pg_monitor"
        ),
        "expected Forbidden for SQLSTATE 42501, got {card_err:?}"
    );

    // Generic error → QueryFailed.
    let err = client
        .query("SELECT * FROM definitely_not_a_table_xyz", &[])
        .await
        .expect_err("expected undefined table error");
    let card_err = ide99::health::commands::classify(err);
    assert!(
        matches!(card_err, CardError::QueryFailed { .. }),
        "expected QueryFailed for unrecognized SQLSTATE, got {card_err:?}"
    );

    std::env::remove_var("IDE99_KEYCHAIN_BACKEND");
    std::env::remove_var("IDE99_DATA_DIR");
}
