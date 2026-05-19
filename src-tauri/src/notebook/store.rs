//! `SQLite` CRUD for `notebooks` table (migration 013).
//!
//! Pattern mirrors `query::tabs`: thin operations over a shared
//! `Store.conn()` handle. The notebook is stored as a single JSON blob
//! (`cells_json`) — see the migration commentary for rationale.

#![allow(clippy::missing_errors_doc, clippy::missing_panics_doc)]

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};

use crate::notebook::types::{Cell, Notebook, NotebookError, UpsertNotebookInput};

fn map_storage(e: &rusqlite::Error) -> NotebookError {
    NotebookError::Storage(e.to_string())
}

/// Read all notebooks ordered by `updated_at` DESC (most-recent first —
/// matches frontend tab-rehydrate order).
pub fn list(conn: &Connection) -> Result<Vec<Notebook>, NotebookError> {
    let mut stmt = conn
        .prepare(
            "SELECT id, name, cells_json, connection_id, file_path, created_at, updated_at \
             FROM notebooks ORDER BY updated_at DESC",
        )
        .map_err(|e| map_storage(&e))?;
    let rows = stmt
        .query_map([], |row| {
            let cells_json: String = row.get(2)?;
            let cells: Vec<Cell> = serde_json::from_str(&cells_json).unwrap_or_default();
            Ok(Notebook {
                id: row.get(0)?,
                name: row.get(1)?,
                cells,
                connection_id: row.get(3)?,
                file_path: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })
        .map_err(|e| map_storage(&e))?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| map_storage(&e))
}

/// Read a single notebook by id (None if absent).
pub fn get(conn: &Connection, id: &str) -> Result<Option<Notebook>, NotebookError> {
    let mut stmt = conn
        .prepare(
            "SELECT id, name, cells_json, connection_id, file_path, created_at, updated_at \
             FROM notebooks WHERE id = ?1",
        )
        .map_err(|e| map_storage(&e))?;
    stmt.query_row(params![id], |row| {
        let cells_json: String = row.get(2)?;
        let cells: Vec<Cell> = serde_json::from_str(&cells_json).unwrap_or_default();
        Ok(Notebook {
            id: row.get(0)?,
            name: row.get(1)?,
            cells,
            connection_id: row.get(3)?,
            file_path: row.get(4)?,
            created_at: row.get(5)?,
            updated_at: row.get(6)?,
        })
    })
    .optional()
    .map_err(|e| map_storage(&e))
}

/// Insert-or-replace by id. Caller responsible for stable id generation.
pub fn upsert(conn: &Connection, input: &UpsertNotebookInput) -> Result<Notebook, NotebookError> {
    let now = Utc::now().to_rfc3339();
    let cells_json = serde_json::to_string(&input.cells)
        .map_err(|e| NotebookError::InvalidInput(format!("cells JSON encode failed: {e}")))?;

    // Preserve created_at on update by reading existing row first.
    let existing_created = conn
        .query_row(
            "SELECT created_at FROM notebooks WHERE id = ?1",
            params![input.id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|e| map_storage(&e))?;
    let created_at = existing_created.unwrap_or_else(|| now.clone());

    conn.execute(        "INSERT INTO notebooks (id, name, cells_json, connection_id, file_path, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) \
         ON CONFLICT(id) DO UPDATE SET \
           name = excluded.name, \
           cells_json = excluded.cells_json, \
           connection_id = excluded.connection_id, \
           file_path = excluded.file_path, \
           updated_at = excluded.updated_at",
        params![
            input.id,
            input.name,
            cells_json,
            input.connection_id,
            input.file_path,
            created_at,
            now,
        ],
)
    .map_err(|e| map_storage(&e))?;

    get(conn, &input.id)?.ok_or_else(|| NotebookError::Storage("upsert read-back failed".into()))
}

/// Idempotent delete by id.
pub fn delete(conn: &Connection, id: &str) -> Result<(), NotebookError> {
    conn.execute("DELETE FROM notebooks WHERE id = ?1", params![id])
        .map_err(|e| map_storage(&e))?;
    Ok(())
}

/// Total number of stored notebooks. Used by the frontend to gate the
/// «Recent notebooks» banner on the welcome tab — cheap aggregate query
/// avoids round-tripping the entire blob list.
pub fn count(conn: &Connection) -> Result<usize, NotebookError> {
    let n: i64 = conn
        .query_row("SELECT COUNT(*) FROM notebooks", [], |row| row.get(0))
        .map_err(|e| map_storage(&e))?;
    Ok(usize::try_from(n).unwrap_or(0))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::connection::Store;
    use crate::notebook::types::Cell;

    fn fresh_store() -> Store {
        let mut s = Store::open_in_memory().expect("open mem store");
        s.run_migrations().expect("migrations");
        s
    }

    fn sample_input(id: &str, name: &str) -> UpsertNotebookInput {
        UpsertNotebookInput {
            id: id.to_string(),
            name: name.to_string(),
            cells: vec![
                Cell::Markdown {
                    id: "c1".into(),
                    source: "# Notebook".into(),
                },
                Cell::Sql {
                    id: "c2".into(),
                    source: "SELECT 1;".into(),
                    result: None,
                    share_as_cte: false,
                    cte_name: None,
                },
            ],
            connection_id: None,
            file_path: None,
        }
    }

    #[test]
    fn upsert_then_get_roundtrip() {
        let store = fresh_store();
        let nb = upsert(store.conn(), &sample_input("nb-1", "Demo")).expect("upsert");
        assert_eq!(nb.name, "Demo");
        assert_eq!(nb.cells.len(), 2);
        let got = get(store.conn(), "nb-1").expect("get").expect("present");
        assert_eq!(got.id, "nb-1");
    }

    #[test]
    fn upsert_preserves_created_at() {
        let store = fresh_store();
        let first = upsert(store.conn(), &sample_input("nb-2", "v1")).expect("first");
        std::thread::sleep(std::time::Duration::from_millis(5));
        let mut second_input = sample_input("nb-2", "v2");
        second_input.cells.clear();
        let second = upsert(store.conn(), &second_input).expect("second");
        assert_eq!(first.created_at, second.created_at);
        assert_ne!(first.updated_at, second.updated_at);
        assert_eq!(second.name, "v2");
    }

    #[test]
    fn list_orders_by_updated_at_desc() {
        let store = fresh_store();
        upsert(store.conn(), &sample_input("nb-a", "a")).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(5));
        upsert(store.conn(), &sample_input("nb-b", "b")).unwrap();
        let all = list(store.conn()).expect("list");
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].id, "nb-b");
        assert_eq!(all[1].id, "nb-a");
    }

    #[test]
    fn delete_is_idempotent() {
        let store = fresh_store();
        delete(store.conn(), "missing").expect("idempotent");
        upsert(store.conn(), &sample_input("nb-x", "x")).unwrap();
        delete(store.conn(), "nb-x").expect("delete present");
        assert!(get(store.conn(), "nb-x").unwrap().is_none());
    }

    #[test]
    fn count_reflects_inserts_and_deletes() {
        let store = fresh_store();
        assert_eq!(count(store.conn()).unwrap(), 0);
        upsert(store.conn(), &sample_input("nb-1", "a")).unwrap();
        upsert(store.conn(), &sample_input("nb-2", "b")).unwrap();
        assert_eq!(count(store.conn()).unwrap(), 2);
        delete(store.conn(), "nb-1").unwrap();
        assert_eq!(count(store.conn()).unwrap(), 1);
    }

    #[test]
    fn roundtrip_50_cells_each_with_100_rows() {
        // Stress test: 50 SQL cells, each with an inline result snapshot
        // of 100 rows × 5 cols. Verifies the cells_json TEXT column can
        // hold the payload (SQLite default limit ~1 GB).
        let store = fresh_store();
        let mut cells: Vec<Cell> = Vec::with_capacity(50);
        for i in 0..50_u64 {
            let rows: Vec<Vec<Option<String>>> = (0..100)
                .map(|r| {
                    vec![
                        Some(format!("id-{i}-{r}")),
                        Some(format!("payload-{r}")),
                        Some("constant-data".into()),
                        Some(format!("{}", r * 7)),
                        None,
                    ]
                })
                .collect();
            cells.push(Cell::Sql {
                id: format!("c{i}"),
                source: format!("SELECT * FROM t{i}"),
                result: Some(crate::notebook::types::CellResult {
                    columns: vec![
                        "id".into(),
                        "payload".into(),
                        "tag".into(),
                        "n".into(),
                        "nullable".into(),
                    ],
                    rows,
                    truncated: false,
                    duration_ms: i,
                    executed_at: "2026-05-06T00:00:00Z".into(),
                }),
                share_as_cte: false,
                cte_name: None,
            });
        }
        let input = UpsertNotebookInput {
            id: "nb-big".into(),
            name: "Big".into(),
            cells,
            connection_id: None,
            file_path: None,
        };
        let saved = upsert(store.conn(), &input).expect("upsert big");
        assert_eq!(saved.cells.len(), 50);
        let got = get(store.conn(), "nb-big").unwrap().unwrap();
        assert_eq!(got.cells.len(), 50);
        // Spot-check round-trip integrity on random cells.
        match &got.cells[0] {
            Cell::Sql { result, .. } => {
                let r = result.as_ref().expect("result");
                assert_eq!(r.rows.len(), 100);
                assert_eq!(r.rows[0][0], Some("id-0-0".into()));
                assert_eq!(r.rows[99][4], None);
            }
            _ => panic!("expected SQL cell"),
        }
        match &got.cells[49] {
            Cell::Sql { result, .. } => {
                let r = result.as_ref().expect("result");
                assert_eq!(r.duration_ms, 49);
            }
            _ => panic!("expected SQL cell"),
        }
    }
}
