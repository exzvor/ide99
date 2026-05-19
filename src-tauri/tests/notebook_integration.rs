//! Sprint 34 — end-to-end integration test for Notebook persistence + file I/O.
//!
//! Drives the same `AppState` helpers that the Tauri commands invoke
//! (`notebook_save`, `notebook_get`, etc.) through a tempdir-backed store.
//! Covers acceptance criterion #1:
//!
//! > Create notebook с 5 cells (mixed SQL/Markdown) → save → reload →
//! > restored.
//!
//! Doesn't need a Postgres testcontainer — notebook persistence только
//! трогает SQLite store + file system. We round-trip через the file
//! exporter тоже, чтобы убедиться что `.ide99nb` envelope симметричен
//! по структуре с in-memory representation.

use std::sync::Arc;

use ide99::connection::keychain::MemoryKeychain;
use ide99::connection::{PoolRegistry, Store};
use ide99::notebook::types::{Cell, CellResult, UpsertNotebookInput};
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

fn sample_cells() -> Vec<Cell> {
    vec![
        Cell::Markdown {
            id: "md-intro".into(),
            source: "# Bug investigation\n\nLooking at slow `users` queries.".into(),
        },
        Cell::Sql {
            id: "sql-base".into(),
            source: "SELECT id, email FROM users WHERE created_at > NOW() - INTERVAL '7 days';"
                .into(),
            result: Some(CellResult {
                columns: vec!["id".into(), "email".into()],
                rows: vec![
                    vec![Some("1".into()), Some("a@example.com".into())],
                    vec![Some("2".into()), Some("b@example.com".into())],
                ],
                truncated: false,
                duration_ms: 17,
                executed_at: "2026-05-06T12:00:00Z".into(),
            }),
            share_as_cte: true,
            cte_name: Some("recent_users".into()),
        },
        Cell::Markdown {
            id: "md-explain".into(),
            source: "Filtered down to {{ recent_users.email }} as a sample.".into(),
        },
        Cell::Sql {
            id: "sql-followup".into(),
            source: "SELECT COUNT(*) FROM recent_users;".into(),
            result: None,
            share_as_cte: false,
            cte_name: None,
        },
        Cell::Result {
            id: "res-pinned".into(),
            result: CellResult {
                columns: vec!["count".into()],
                rows: vec![vec![Some("2".into())]],
                truncated: false,
                duration_ms: 3,
                executed_at: "2026-05-06T12:00:01Z".into(),
            },
        },
    ]
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn save_reload_export_import_roundtrip() {
    std::env::set_var("IDE99_KEYCHAIN_BACKEND", "memory");
    let tmp = TempDir::new().expect("tempdir");
    std::env::set_var("IDE99_DATA_DIR", tmp.path());

    let state = build_state(tmp.path());

    // 1) Save a notebook with 5 mixed cells.
    let input = UpsertNotebookInput {
        id: "nb-int-1".into(),
        name: "Slow users investigation".into(),
        cells: sample_cells(),
        connection_id: None,
        file_path: None,
    };
    let saved = state.notebook_save(input.clone()).await.expect("save");
    assert_eq!(saved.id, "nb-int-1");
    assert_eq!(saved.cells.len(), 5);

    // 2) Reload through `notebook_get` and confirm equality.
    let reloaded = state
        .notebook_get("nb-int-1")
        .await
        .expect("get")
        .expect("present");
    assert_eq!(reloaded.cells.len(), 5);
    assert_eq!(reloaded.name, "Slow users investigation");
    // Cells round-trip exactly (we depend on PartialEq derived on Cell).
    assert_eq!(reloaded.cells, saved.cells);

    // 3) `notebook_count` reflects the single notebook.
    assert_eq!(state.notebook_count().await.unwrap(), 1);

    // 4) Export to .ide99nb and re-import: structural equality preserved.
    let path = tmp.path().join("export.ide99nb");
    ide99::notebook::file_io::write_to_path(&path, &reloaded).expect("export");
    let imported = ide99::notebook::file_io::read_from_path(&path).expect("import");
    assert_eq!(imported.cells, reloaded.cells);
    assert_eq!(imported.id, reloaded.id);
    assert_eq!(imported.name, reloaded.name);

    // 5) Minimal export drops inline results + standalone Result-cells.
    let min_path = tmp.path().join("share.ide99nb");
    ide99::notebook::file_io::write_minimal_to_path(&min_path, &reloaded).expect("min export");
    let shared = ide99::notebook::file_io::read_from_path(&min_path).expect("min import");
    assert_eq!(shared.cells.len(), 4, "Result-cell должна быть исключена");
    for cell in &shared.cells {
        if let Cell::Sql { result, .. } = cell {
            assert!(result.is_none(), "result snapshots stripped");
        }
    }

    // 6) Cleanup via `notebook_delete` works end-to-end.
    state.notebook_delete("nb-int-1").await.expect("delete");
    assert!(state.notebook_get("nb-int-1").await.unwrap().is_none());
    assert_eq!(state.notebook_count().await.unwrap(), 0);
}
