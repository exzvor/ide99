//! `SQLite` CRUD for the `editor_tabs` table.
//!
//! Reuses the single `rusqlite::Connection` owned by the app `Store` (held
//! behind `Mutex<Store>` in `AppState`). All three operations are O(rows)
//! against a small table — full scan with `created_at ASC` ordering is
//! supported by the index defined in migration `002_editor_tabs.sql`.
//!
//! `upsert` uses `INSERT OR REPLACE` so save-on-edit from the frontend is
//! idempotent w.r.t. existing rows; `delete` is intentionally idempotent
//! (missing-row delete is a no-op) so close-tab races don't surface errors.

#![allow(clippy::missing_errors_doc)]

use rusqlite::{params, Connection};

use crate::query::types::EditorTabRow;

/// Return all tabs ordered by `created_at` ascending — matches the
/// front-end's natural insertion order on rehydrate.
pub fn list(conn: &Connection) -> rusqlite::Result<Vec<EditorTabRow>> {
    let mut stmt = conn.prepare(        "SELECT id, kind, name, content, connection_id, node_key, \
                cursor_line, cursor_col, created_at, updated_at \
         FROM editor_tabs ORDER BY created_at ASC",
)?;
    let rows = stmt.query_map([], |row| {
        Ok(EditorTabRow {
            id: row.get(0)?,
            kind: row.get(1)?,
            name: row.get(2)?,
            content: row.get(3)?,
            connection_id: row.get(4)?,
            node_key: row.get(5)?,
            cursor_line: row.get(6)?,
            cursor_col: row.get(7)?,
            created_at: row.get(8)?,
            updated_at: row.get(9)?,
        })
    })?;
    rows.collect()
}

/// Insert-or-replace by primary key (`id`). The table's CHECK constraint on
/// `kind` enforces the editor/object discriminator at the SQL layer.
pub fn upsert(conn: &Connection, tab: &EditorTabRow) -> rusqlite::Result<()> {
    conn.execute(        "INSERT OR REPLACE INTO editor_tabs \
         (id, kind, name, content, connection_id, node_key, \
          cursor_line, cursor_col, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            tab.id,
            tab.kind,
            tab.name,
            tab.content,
            tab.connection_id,
            tab.node_key,
            tab.cursor_line,
            tab.cursor_col,
            tab.created_at,
            tab.updated_at,
        ],
)?;
    Ok(())
}

/// Idempotent delete by `id`. Missing-row deletes return `Ok(())` so close-tab
/// races (e.g. rapid-fire from keyboard shortcuts) don't surface errors.
pub fn delete(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM editor_tabs WHERE id = ?1", params![id])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::connection::Store;

    fn fresh_store() -> Store {
        let mut store = Store::open_in_memory().expect("open mem store");
        store.run_migrations().expect("migrations");
        store
    }

    fn sample(id: &str) -> EditorTabRow {
        EditorTabRow {
            id: id.to_string(),
            kind: "editor".to_string(),
            name: format!("untitled-{id}"),
            content: "SELECT 1".to_string(),
            connection_id: None,
            node_key: None,
            cursor_line: 1,
            cursor_col: 1,
            created_at: "2026-04-27T00:00:00Z".to_string(),
            updated_at: "2026-04-27T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn upsert_then_list() {
        let store = fresh_store();
        let conn = store.conn();
        upsert(conn, &sample("a")).unwrap();
        let listed = list(conn).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, "a");
    }

    #[test]
    fn upsert_replaces_existing() {
        let store = fresh_store();
        let conn = store.conn();
        upsert(conn, &sample("a")).unwrap();
        let mut t = sample("a");
        t.content = "SELECT 2".to_string();
        upsert(conn, &t).unwrap();
        let listed = list(conn).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].content, "SELECT 2");
    }

    #[test]
    fn delete_missing_is_idempotent() {
        let store = fresh_store();
        let conn = store.conn();
        delete(conn, "nope").unwrap();
        assert!(list(conn).unwrap().is_empty());
    }

    #[test]
    fn list_orders_by_created_at_asc() {
        let store = fresh_store();
        let conn = store.conn();
        let mut t1 = sample("a");
        t1.created_at = "2026-04-27T00:00:01Z".to_string();
        let mut t2 = sample("b");
        t2.created_at = "2026-04-27T00:00:00Z".to_string();
        upsert(conn, &t1).unwrap();
        upsert(conn, &t2).unwrap();
        let listed = list(conn).unwrap();
        assert_eq!(listed[0].id, "b");
        assert_eq!(listed[1].id, "a");
    }
}
