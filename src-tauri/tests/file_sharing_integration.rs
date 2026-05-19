//! Sprint 36 — `.ide99` round-trip integration tests.
//!
//! Cover acceptance criterion #5: "Export … → import in another instance →
//! [item] appears (без credentials)" for connection + snippet + notebook.
//! Each test:
//! 1. builds an `AppState` against a fresh tempdir-backed Store,
//! 2. inserts a source row,
//! 3. exports → writes a `.ide99` file,
//! 4. previews + decodes it,
//! 5. applies it on a *fresh* `AppState` (the "another instance"), and
//! 6. asserts the row landed in the target storage.

#![allow(clippy::missing_panics_doc)]

use std::sync::Arc;

use ide99::connection::keychain::MemoryKeychain;
use ide99::connection::types::{Environment, NewConnection, SslMode};
use ide99::connection::{PoolRegistry, Store};
use ide99::file_sharing::envelope;
use ide99::file_sharing::kinds::{notebook as nb_kind, snippet as snip_kind};
use ide99::file_sharing::types::ShareKind;
use ide99::notebook::types::{Cell, UpsertNotebookInput};
use ide99::snippets::store::SnippetStore;
use ide99::snippets::types::NewUserSnippet;
use ide99::AppState;
use tempfile::TempDir;

fn build_state(data_dir: &std::path::Path) -> AppState {
    let db_path = data_dir.join("store.db");
    let mut store = Store::open(&db_path).expect("open store");
    store.run_migrations().expect("migrations");
    AppState::with_data_dir(
        store,
        Box::new(MemoryKeychain::new()),
        Arc::new(PoolRegistry::new()),
        data_dir.to_path_buf(),
    )
}

#[tokio::test]
async fn round_trip_connection_export_import() {
    // --- source instance ---
    let src_home = TempDir::new().unwrap();
    let src = build_state(src_home.path());

    let new_conn = NewConnection {
        name: "prod-mirror".into(),
        host: "db.example.com".into(),
        port: 5432,
        database: "myapp".into(),
        username: "alice".into(),
        password: Some("super-secret".into()),
        ssl_mode: SslMode::Require,
        exclude_from_history: false,
        exclude_from_recent_plans: false,
        environment: Environment::Prod,
        read_only: true,
        slow_query_warning: true,
        confirm_destructive: true,
        migrations_dir: None,
        migration_tracking_enabled: true,
        migration_snapshots_enabled: false,
        squawk_lint_enabled: true,
    };
    let created_id = {
        let store = src.store.lock().await;
        store
            .create(&new_conn, true)
            .expect("create source connection")
            .id
    };

    // Export to a .ide99 file.
    let out = TempDir::new().unwrap();
    let file_path = out.path().join("prod-mirror.ide99");
    src.ide99_export_connection(&created_id, file_path.to_str().unwrap())
        .await
        .expect("export connection");

    // Privacy red line: no credentials in the file.
    let raw = std::fs::read_to_string(&file_path).unwrap();
    assert!(!raw.contains("super-secret"), "password leaked!");
    assert!(!raw.contains("hasPassword"), "has_password leaked");
    assert!(!raw.contains("lastTestedAt"));

    // Preview.
    let env = envelope::decode(&raw).expect("decode envelope");
    let preview = envelope::preview(&env).expect("preview");
    assert_eq!(preview.kind, ShareKind::Connection);
    assert!(preview.summary.contains("prod-mirror"));
    assert!(preview.summary.contains("db.example.com"));

    // --- another instance ---
    let dst_home = TempDir::new().unwrap();
    let dst = build_state(dst_home.path());

    // Apply: build NewConnection from the parsed payload + insert.
    let exp = ide99::file_sharing::kinds::connection::from_single_payload(&env.payload)
        .expect("decode connection");
    let landed = {
        let store = dst.store.lock().await;
        store
            .create(
                &NewConnection {
                    name: exp.name.clone(),
                    host: exp.host.clone(),
                    port: exp.port,
                    database: exp.database.clone(),
                    username: exp.username.clone(),
                    password: None, // privacy: caller supplies locally
                    ssl_mode: exp.ssl_mode,
                    exclude_from_history: exp.exclude_from_history,
                    exclude_from_recent_plans: exp.exclude_from_recent_plans,
                    environment: exp.environment,
                    read_only: exp.read_only,
                    slow_query_warning: exp.slow_query_warning,
                    confirm_destructive: exp.confirm_destructive,
                    migrations_dir: None,
                    migration_tracking_enabled: true,
                    migration_snapshots_enabled: false,
                    squawk_lint_enabled: true,
                },
                false, // no password landed
            )
            .expect("create dst connection")
    };

    assert_eq!(landed.name, "prod-mirror");
    assert_eq!(landed.environment, Environment::Prod);
    assert!(landed.read_only);
    assert!(!landed.has_password, "credentials must NOT carry over");
}

#[tokio::test]
async fn round_trip_snippet_export_import() {
    let src_home = TempDir::new().unwrap();
    let src = build_state(src_home.path());

    let snip_id = {
        let store = src.store.lock().await;
        SnippetStore::new(store.conn())
            .create(&NewUserSnippet {
                label: "Top users".into(),
                prefix: "topu".into(),
                body: "SELECT id, email FROM users ORDER BY created_at DESC LIMIT 10;".into(),
                documentation: "Last 10 sign-ups".into(),
            })
            .expect("create source snippet")
            .id
    };

    let out = TempDir::new().unwrap();
    let file_path = out.path().join("topu.ide99");
    src.ide99_export_snippet(snip_id, file_path.to_str().unwrap())
        .await
        .expect("export snippet");

    let raw = std::fs::read_to_string(&file_path).unwrap();
    let env = envelope::decode(&raw).expect("decode");
    let preview = envelope::preview(&env).expect("preview");
    assert_eq!(preview.kind, ShareKind::Snippet);
    assert!(preview.summary.contains("Top users"));

    // Apply on a fresh instance.
    let dst_home = TempDir::new().unwrap();
    let dst = build_state(dst_home.path());

    let inserted = {
        let store = dst.store.lock().await;
        snip_kind::apply_single(store.conn(), &env.payload).expect("apply snippet")
    };
    assert_eq!(inserted.label, "Top users");
    assert_eq!(inserted.prefix, "topu");
    assert!(inserted.body.contains("LIMIT 10"));

    // List on the destination shows it.
    let store = dst.store.lock().await;
    let listed = SnippetStore::new(store.conn()).list().expect("list");
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].label, "Top users");
}

#[tokio::test]
async fn round_trip_notebook_export_import_strips_results() {
    use ide99::notebook::types::CellResult;

    let src_home = TempDir::new().unwrap();
    let src = build_state(src_home.path());

    let nb_id = "nb-source-1";
    {
        let store = src.store.lock().await;
        ide99::notebook::store::upsert(
            store.conn(),
            &UpsertNotebookInput {
                id: nb_id.into(),
                name: "Bug repro".into(),
                cells: vec![
                    Cell::Markdown {
                        id: "md1".into(),
                        source: "# Repro".into(),
                    },
                    Cell::Sql {
                        id: "sql1".into(),
                        source: "SELECT * FROM users LIMIT 1;".into(),
                        result: Some(CellResult {
                            columns: vec!["id".into(), "email".into()],
                            rows: vec![vec![Some("42".into()), Some("alice@example.com".into())]],
                            truncated: false,
                            duration_ms: 12,
                            executed_at: "2026-05-07T00:00:00Z".into(),
                        }),
                        share_as_cte: false,
                        cte_name: None,
                    },
                ],
                connection_id: None,
                file_path: Some("/tmp/secret.ide99nb".into()),
            },
        )
        .expect("upsert source notebook");
    }

    let out = TempDir::new().unwrap();
    let file_path = out.path().join("repro.ide99");
    src.ide99_export_notebook(nb_id, file_path.to_str().unwrap())
        .await
        .expect("export notebook");

    let raw = std::fs::read_to_string(&file_path).unwrap();
    // Privacy: connection binding + last-run cell results stripped.
    assert!(
        !raw.contains("alice@example.com"),
        "result snapshot leaked into export"
    );
    assert!(
        !raw.contains("/tmp/secret.ide99nb"),
        "file_path leaked into export"
    );

    let env = envelope::decode(&raw).expect("decode");
    let preview = envelope::preview(&env).expect("preview");
    assert_eq!(preview.kind, ShareKind::Notebook);
    assert!(preview.summary.contains("Bug repro"));

    // Apply on fresh instance.
    let dst_home = TempDir::new().unwrap();
    let dst = build_state(dst_home.path());

    let landed = {
        let store = dst.store.lock().await;
        nb_kind::apply(store.conn(), &env.payload).expect("apply notebook")
    };
    assert_eq!(landed.name, "Bug repro");
    assert_eq!(landed.cells.len(), 2);
    assert_ne!(landed.id, nb_id, "id regenerated on apply");
    if let Cell::Sql { result, .. } = &landed.cells[1] {
        assert!(result.is_none(), "imported notebook must not carry results");
    } else {
        panic!("expected SQL cell at index 1");
    }
    // List on destination shows it.
    let store = dst.store.lock().await;
    let listed = ide99::notebook::store::list(store.conn()).expect("list");
    assert_eq!(listed.len(), 1);
}
