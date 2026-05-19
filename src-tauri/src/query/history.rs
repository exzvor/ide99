//! Query history persistence + FTS5 search.
//!
//! Free functions over `&rusqlite::Connection`. Caller (`AppState`) holds
//! the `Mutex<Store>` guard for the duration of the call, same pattern as
//! `query::tabs`. Phase 2A fills in real bodies; this scaffold lets the
//! `commands.rs` hook compile without ordering dependencies.

#![allow(clippy::missing_errors_doc, clippy::missing_panics_doc)]

use rusqlite::{params, params_from_iter, types::Value, Connection, OptionalExtension, Row};
use uuid::Uuid;

use crate::query::types::{
    HistoryRow, HistorySearchFilter, HistorySearchResult, HistoryStatus, NewHistoryRecord,
};

/// Hard upper bound on `HistorySearchFilter::limit`.
///
/// Keeps result-set sizes predictable: the frontend's default is 200;
/// anything larger is clamped so a pathological caller can't blow the UI
/// thread past `<100ms` budget.
pub const MAX_PAGE: u32 = 200;

const SELECT_COLUMNS: &str = "h.id, h.connection_id, h.connection_name, h.sql, \
     h.executed_at, h.duration_ms, h.status, h.rows_affected, h.rows_returned, \
     h.truncated, h.error_message, h.tag, h.comment, h.pinned";

/// Insert a new history row. Returns the generated UUID.
pub fn record(conn: &Connection, input: &NewHistoryRecord) -> rusqlite::Result<String> {
    let id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO query_history \
         (id, connection_id, connection_name, sql, executed_at, duration_ms, status, \
          rows_affected, rows_returned, truncated, error_message, tag, comment, pinned) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        params![
            id,
            input.connection_id,
            input.connection_name,
            input.sql,
            input.executed_at,
            i64::try_from(input.duration_ms).unwrap_or(i64::MAX),
            input.status.as_str(),
            input
                .rows_affected
                .map(|v| i64::try_from(v).unwrap_or(i64::MAX)),
            input
                .rows_returned
                .map(|v| i64::try_from(v).unwrap_or(i64::MAX)),
            i64::from(input.truncated),
            input.error_message,
            Option::<String>::None, // tag — set via set_tag
            Option::<String>::None, // comment — set via set_comment
            0_i64,                  // pinned — set via set_pinned
        ],
    )?;
    Ok(id)
}

/// FTS-aware paginated search. Filters compose with implicit AND; `since` is
/// inclusive and `until` is exclusive, mirroring the frontend's date-range
/// picker semantics.
pub fn search(
    conn: &Connection,
    filter: &HistorySearchFilter,
) -> rusqlite::Result<HistorySearchResult> {
    let limit = filter.limit.min(MAX_PAGE);
    let (where_sql, args, has_match) = build_where_clause(filter);

    // SELECT — only join FTS when MATCH is in play; the join is observably
    // slower for non-MATCH queries.
    let from_sql = if has_match {
        "FROM query_history h \
         JOIN query_history_fts f ON f.rowid = h.rowid"
    } else {
        "FROM query_history h"
    };

    let select_sql = format!(
        "SELECT {SELECT_COLUMNS} {from_sql}{where_sql} \
         ORDER BY h.executed_at DESC LIMIT ? OFFSET ?",
    );
    let mut select_args = args.clone();
    select_args.push(Value::Integer(i64::from(limit)));
    select_args.push(Value::Integer(i64::from(filter.offset)));

    let mut stmt = conn.prepare(&select_sql)?;
    let rows_iter = stmt.query_map(params_from_iter(select_args.iter()), row_to_history)?;
    let mut rows = Vec::with_capacity(limit as usize);
    for r in rows_iter {
        rows.push(r?);
    }

    // COUNT(*) — same WHERE/FROM, no ORDER/LIMIT/OFFSET.
    let count_sql = format!("SELECT COUNT(*) {from_sql}{where_sql}");
    let total_matched: i64 =
        conn.query_row(&count_sql, params_from_iter(args.iter()), |row| row.get(0))?;

    Ok(HistorySearchResult {
        rows,
        total_matched: u64::try_from(total_matched).unwrap_or(0),
    })
}

pub fn get_by_id(conn: &Connection, id: &str) -> rusqlite::Result<Option<HistoryRow>> {
    let sql = format!("SELECT {SELECT_COLUMNS} FROM query_history h WHERE h.id = ?1");
    conn.query_row(&sql, params![id], row_to_history).optional()
}

/// Idempotent — missing-id calls return `Ok(())` so concurrent UI updates
/// against a row that was just deleted don't surface as errors.
pub fn set_pinned(conn: &Connection, id: &str, pinned: bool) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE query_history SET pinned = ?1 WHERE id = ?2",
        params![i64::from(pinned), id],
    )?;
    Ok(())
}

pub fn set_tag(conn: &Connection, id: &str, tag: Option<&str>) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE query_history SET tag = ?1 WHERE id = ?2",
        params![tag, id],
    )?;
    Ok(())
}

pub fn set_comment(conn: &Connection, id: &str, comment: Option<&str>) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE query_history SET comment = ?1 WHERE id = ?2",
        params![comment, id],
    )?;
    Ok(())
}

/// Idempotent — missing-id deletes return `Ok(())` so close-tab races don't
/// surface errors. Mirrors `query::tabs::delete`.
pub fn delete(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM query_history WHERE id = ?1", params![id])?;
    Ok(())
}

/// Bulk-delete all rows for a connection (used by the per-connection "Clear
/// history" action). Returns the number of rows deleted.
pub fn delete_all_for_connection(conn: &Connection, connection_id: &str) -> rusqlite::Result<u64> {
    let n = conn.execute(
        "DELETE FROM query_history WHERE connection_id = ?1",
        params![connection_id],
    )?;
    Ok(u64::try_from(n).unwrap_or(0))
}

/// Streaming export — runs the same WHERE clause as `search` but feeds each
/// row through `cb` instead of buffering. Returns the row count. Caller
/// computes file size separately.
///
/// `cb`'s `io::Error` is wrapped via `rusqlite::Error::ToSqlConversionFailure`
/// — the standard rusqlite escape hatch for a callback error so it bubbles
/// through `query_map` without losing the underlying cause.
pub fn export_iter<F>(
    conn: &Connection,
    filter: &HistorySearchFilter,
    mut cb: F,
) -> rusqlite::Result<u64>
where
    F: FnMut(&HistoryRow) -> std::io::Result<()>,
{
    let (where_sql, args, has_match) = build_where_clause(filter);
    let from_sql = if has_match {
        "FROM query_history h \
         JOIN query_history_fts f ON f.rowid = h.rowid"
    } else {
        "FROM query_history h"
    };
    // Export is unbounded — no LIMIT/OFFSET — but ordered for stable output.
    let sql = format!("SELECT {SELECT_COLUMNS} {from_sql}{where_sql} ORDER BY h.executed_at DESC");

    let mut stmt = conn.prepare(&sql)?;
    let mut count: u64 = 0;
    let mut rows_iter = stmt.query(params_from_iter(args.iter()))?;
    while let Some(row) = rows_iter.next()? {
        let h = row_to_history(row)?;
        cb(&h).map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
        count += 1;
    }
    Ok(count)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Build the parameterised WHERE clause (and `LEFT JOIN`-need flag) shared
/// by `search` and `export_iter`. The leading space in the returned string
/// means callers can concatenate unconditionally.
fn build_where_clause(filter: &HistorySearchFilter) -> (String, Vec<Value>, bool) {
    let mut clauses: Vec<&str> = Vec::with_capacity(6);
    let mut args: Vec<Value> = Vec::with_capacity(6);
    let mut has_match = false;

    if let Some(q) = filter.query.as_deref() {
        let trimmed = q.trim();
        if !trimmed.is_empty() {
            clauses.push("f.query_history_fts MATCH ?");
            args.push(Value::Text(trimmed.to_string()));
            has_match = true;
        }
    }
    if let Some(cid) = filter.connection_id.as_deref() {
        clauses.push("h.connection_id = ?");
        args.push(Value::Text(cid.to_string()));
    }
    if let Some(status) = filter.status {
        clauses.push("h.status = ?");
        args.push(Value::Text(status.as_str().to_string()));
    }
    if filter.pinned_only {
        clauses.push("h.pinned = 1");
    }
    if let Some(since) = filter.since.as_deref() {
        clauses.push("h.executed_at >= ?");
        args.push(Value::Text(since.to_string()));
    }
    if let Some(until) = filter.until.as_deref() {
        clauses.push("h.executed_at < ?");
        args.push(Value::Text(until.to_string()));
    }

    let where_sql = if clauses.is_empty() {
        String::new()
    } else {
        format!(" WHERE {}", clauses.join(" AND "))
    };

    (where_sql, args, has_match)
}

fn row_to_history(row: &Row<'_>) -> rusqlite::Result<HistoryRow> {
    let duration_ms: i64 = row.get(5)?;
    let status_token: String = row.get(6)?;
    let rows_affected: Option<i64> = row.get(7)?;
    let rows_returned: Option<i64> = row.get(8)?;
    let truncated: i64 = row.get(9)?;
    let pinned: i64 = row.get(13)?;

    // Unknown status would mean a CHECK-constraint violation that somehow got
    // committed — not recoverable without losing data, so default to Ok and
    // let the integration test catch it. (CHECK is enforced by the migration.)
    let status = HistoryStatus::from_token(&status_token).unwrap_or(HistoryStatus::Ok);

    Ok(HistoryRow {
        id: row.get(0)?,
        connection_id: row.get(1)?,
        connection_name: row.get(2)?,
        sql: row.get(3)?,
        executed_at: row.get(4)?,
        duration_ms: u64::try_from(duration_ms).unwrap_or(0),
        status,
        rows_affected: rows_affected.map(|v| u64::try_from(v).unwrap_or(0)),
        rows_returned: rows_returned.map(|v| u64::try_from(v).unwrap_or(0)),
        truncated: truncated != 0,
        error_message: row.get(10)?,
        tag: row.get(11)?,
        comment: row.get(12)?,
        pinned: pinned != 0,
    })
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

    fn sample(connection_id: &str, executed_at: &str, sql: &str) -> NewHistoryRecord {
        NewHistoryRecord {
            connection_id: connection_id.to_string(),
            connection_name: format!("conn-{connection_id}"),
            sql: sql.to_string(),
            executed_at: executed_at.to_string(),
            duration_ms: 12,
            status: HistoryStatus::Ok,
            rows_affected: Some(0),
            rows_returned: Some(3),
            truncated: false,
            error_message: None,
        }
    }

    #[test]
    fn record_then_get_by_id_round_trip() {
        let store = fresh_store();
        let conn = store.conn();
        let mut input = sample("c1", "2026-04-27T00:00:00Z", "SELECT 1");
        input.duration_ms = 99;
        input.rows_affected = Some(5);
        input.rows_returned = Some(7);
        input.truncated = true;
        input.error_message = Some("boom".into());
        input.status = HistoryStatus::Error;

        let id = record(conn, &input).unwrap();
        let got = get_by_id(conn, &id).unwrap().unwrap();
        assert_eq!(got.id, id);
        assert_eq!(got.connection_id, "c1");
        assert_eq!(got.connection_name, "conn-c1");
        assert_eq!(got.sql, "SELECT 1");
        assert_eq!(got.executed_at, "2026-04-27T00:00:00Z");
        assert_eq!(got.duration_ms, 99);
        assert_eq!(got.status, HistoryStatus::Error);
        assert_eq!(got.rows_affected, Some(5));
        assert_eq!(got.rows_returned, Some(7));
        assert!(got.truncated);
        assert_eq!(got.error_message.as_deref(), Some("boom"));
        assert_eq!(got.tag, None);
        assert_eq!(got.comment, None);
        assert!(!got.pinned);
    }

    #[test]
    fn record_minimal_record_nullable_columns() {
        let store = fresh_store();
        let conn = store.conn();
        let mut input = sample("c1", "2026-04-27T00:00:00Z", "SELECT 1");
        input.rows_affected = None;
        input.rows_returned = None;
        input.error_message = None;
        let id = record(conn, &input).unwrap();
        let got = get_by_id(conn, &id).unwrap().unwrap();
        assert_eq!(got.rows_affected, None);
        assert_eq!(got.rows_returned, None);
        assert_eq!(got.error_message, None);
    }

    #[test]
    fn set_pinned_round_trip() {
        let store = fresh_store();
        let conn = store.conn();
        let id = record(conn, &sample("c1", "2026-04-27T00:00:00Z", "SELECT 1")).unwrap();
        set_pinned(conn, &id, true).unwrap();
        assert!(get_by_id(conn, &id).unwrap().unwrap().pinned);
        set_pinned(conn, &id, false).unwrap();
        assert!(!get_by_id(conn, &id).unwrap().unwrap().pinned);
    }

    #[test]
    fn set_tag_round_trip() {
        let store = fresh_store();
        let conn = store.conn();
        let id = record(conn, &sample("c1", "2026-04-27T00:00:00Z", "SELECT 1")).unwrap();
        set_tag(conn, &id, Some("foo")).unwrap();
        assert_eq!(
            get_by_id(conn, &id).unwrap().unwrap().tag.as_deref(),
            Some("foo")
        );
        set_tag(conn, &id, None).unwrap();
        assert_eq!(get_by_id(conn, &id).unwrap().unwrap().tag, None);
    }

    #[test]
    fn set_comment_round_trip() {
        let store = fresh_store();
        let conn = store.conn();
        let id = record(conn, &sample("c1", "2026-04-27T00:00:00Z", "SELECT 1")).unwrap();
        set_comment(conn, &id, Some("note")).unwrap();
        assert_eq!(
            get_by_id(conn, &id).unwrap().unwrap().comment.as_deref(),
            Some("note")
        );
        set_comment(conn, &id, None).unwrap();
        assert_eq!(get_by_id(conn, &id).unwrap().unwrap().comment, None);
    }

    #[test]
    fn delete_removes_row() {
        let store = fresh_store();
        let conn = store.conn();
        let id = record(conn, &sample("c1", "2026-04-27T00:00:00Z", "SELECT 1")).unwrap();
        delete(conn, &id).unwrap();
        assert!(get_by_id(conn, &id).unwrap().is_none());
        // Idempotent on missing id.
        delete(conn, &id).unwrap();
        delete(conn, "nope").unwrap();
    }

    #[test]
    fn delete_all_for_connection_returns_count_and_removes() {
        let store = fresh_store();
        let conn = store.conn();
        for i in 0..5 {
            record(
                conn,
                &sample("A", &format!("2026-04-27T00:00:{i:02}Z"), "SELECT 1"),
            )
            .unwrap();
        }
        for i in 0..3 {
            record(
                conn,
                &sample("B", &format!("2026-04-27T00:00:{i:02}Z"), "SELECT 2"),
            )
            .unwrap();
        }
        let removed = delete_all_for_connection(conn, "A").unwrap();
        assert_eq!(removed, 5);
        let result = search(
            conn,
            &HistorySearchFilter {
                limit: 200,
                ..HistorySearchFilter::default()
            },
        )
        .unwrap();
        assert_eq!(result.rows.len(), 3);
        assert!(result.rows.iter().all(|r| r.connection_id == "B"));
    }

    #[test]
    fn search_empty_filter_returns_newest_first() {
        let store = fresh_store();
        let conn = store.conn();
        record(conn, &sample("c1", "2026-04-27T00:00:01Z", "SELECT 1")).unwrap();
        record(conn, &sample("c1", "2026-04-27T00:00:03Z", "SELECT 3")).unwrap();
        record(conn, &sample("c1", "2026-04-27T00:00:02Z", "SELECT 2")).unwrap();
        // `Default::default()` from `derive(Default)` gives `limit: 0` (the
        // serde-only default helper isn't applied for in-process callers).
        // Frontend-driven flows always go through serde, but Rust-level tests
        // need to set the limit explicitly.
        let result = search(
            conn,
            &HistorySearchFilter {
                limit: 200,
                ..HistorySearchFilter::default()
            },
        )
        .unwrap();
        assert_eq!(result.rows.len(), 3);
        assert_eq!(result.rows[0].executed_at, "2026-04-27T00:00:03Z");
        assert_eq!(result.rows[1].executed_at, "2026-04-27T00:00:02Z");
        assert_eq!(result.rows[2].executed_at, "2026-04-27T00:00:01Z");
        assert_eq!(result.total_matched, 3);
    }

    #[test]
    fn search_pagination_offset_limit() {
        let store = fresh_store();
        let conn = store.conn();
        for i in 0..50 {
            record(
                conn,
                &sample(
                    "c1",
                    &format!("2026-04-27T00:00:{i:02}Z"),
                    &format!("SELECT {i}"),
                ),
            )
            .unwrap();
        }
        let mut filter = HistorySearchFilter {
            limit: 10,
            offset: 0,
            ..HistorySearchFilter::default()
        };
        let p0 = search(conn, &filter).unwrap();
        assert_eq!(p0.rows.len(), 10);
        assert_eq!(p0.total_matched, 50);

        filter.offset = 10;
        let p1 = search(conn, &filter).unwrap();
        assert_eq!(p1.rows.len(), 10);
        assert_eq!(p1.total_matched, 50);

        // No overlap between pages.
        let ids0: Vec<&str> = p0.rows.iter().map(|r| r.id.as_str()).collect();
        let ids1: Vec<&str> = p1.rows.iter().map(|r| r.id.as_str()).collect();
        for id in &ids1 {
            assert!(!ids0.contains(id), "page overlap on {id}");
        }
    }

    #[test]
    fn search_match_finds_token() {
        let store = fresh_store();
        let conn = store.conn();
        record(
            conn,
            &sample("c1", "2026-04-27T00:00:01Z", "SELECT * FROM users"),
        )
        .unwrap();
        record(
            conn,
            &sample(
                "c1",
                "2026-04-27T00:00:02Z",
                "INSERT INTO orders VALUES (1)",
            ),
        )
        .unwrap();
        let filter = HistorySearchFilter {
            query: Some("users".into()),
            limit: 200,
            ..HistorySearchFilter::default()
        };
        let result = search(conn, &filter).unwrap();
        assert_eq!(result.rows.len(), 1);
        assert!(result.rows[0].sql.contains("users"));
        assert_eq!(result.total_matched, 1);
    }

    #[test]
    fn search_match_two_tokens_implicit_and() {
        let store = fresh_store();
        let conn = store.conn();
        record(
            conn,
            &sample("c1", "2026-04-27T00:00:01Z", "select users from t"),
        )
        .unwrap();
        record(
            conn,
            &sample("c1", "2026-04-27T00:00:02Z", "users only here"),
        )
        .unwrap();
        record(
            conn,
            &sample("c1", "2026-04-27T00:00:03Z", "select orders from t"),
        )
        .unwrap();
        let filter = HistorySearchFilter {
            query: Some("\"select\" \"users\"".into()),
            limit: 200,
            ..HistorySearchFilter::default()
        };
        let result = search(conn, &filter).unwrap();
        assert_eq!(result.rows.len(), 1);
        assert!(result.rows[0].sql.contains("select users"));
    }

    #[test]
    fn search_filter_by_connection_id() {
        let store = fresh_store();
        let conn = store.conn();
        for cid in ["A", "B", "C"] {
            for i in 0..3 {
                record(
                    conn,
                    &sample(
                        cid,
                        &format!("2026-04-27T00:00:{i:02}Z"),
                        &format!("SELECT {cid} {i}"),
                    ),
                )
                .unwrap();
            }
        }
        let filter = HistorySearchFilter {
            connection_id: Some("B".into()),
            limit: 200,
            ..HistorySearchFilter::default()
        };
        let result = search(conn, &filter).unwrap();
        assert_eq!(result.rows.len(), 3);
        assert!(result.rows.iter().all(|r| r.connection_id == "B"));
        assert_eq!(result.total_matched, 3);
    }

    #[test]
    fn search_filter_by_status() {
        let store = fresh_store();
        let conn = store.conn();
        for (i, status) in [
            HistoryStatus::Ok,
            HistoryStatus::Error,
            HistoryStatus::Cancelled,
        ]
        .iter()
        .enumerate()
        {
            let mut input = sample("c1", &format!("2026-04-27T00:00:{i:02}Z"), "SELECT 1");
            input.status = *status;
            record(conn, &input).unwrap();
        }
        let filter = HistorySearchFilter {
            status: Some(HistoryStatus::Error),
            limit: 200,
            ..HistorySearchFilter::default()
        };
        let result = search(conn, &filter).unwrap();
        assert_eq!(result.rows.len(), 1);
        assert_eq!(result.rows[0].status, HistoryStatus::Error);
    }

    #[test]
    fn search_filter_pinned_only() {
        let store = fresh_store();
        let conn = store.conn();
        let mut ids = Vec::new();
        for i in 0..5 {
            let id = record(
                conn,
                &sample(
                    "c1",
                    &format!("2026-04-27T00:00:{i:02}Z"),
                    &format!("SELECT {i}"),
                ),
            )
            .unwrap();
            ids.push(id);
        }
        set_pinned(conn, &ids[0], true).unwrap();
        set_pinned(conn, &ids[3], true).unwrap();
        let filter = HistorySearchFilter {
            pinned_only: true,
            limit: 200,
            ..HistorySearchFilter::default()
        };
        let result = search(conn, &filter).unwrap();
        assert_eq!(result.rows.len(), 2);
        assert!(result.rows.iter().all(|r| r.pinned));
    }

    #[test]
    fn search_filter_since_until() {
        let store = fresh_store();
        let conn = store.conn();
        // Boundary: since is inclusive, until is exclusive.
        record(conn, &sample("c1", "2026-04-26T23:59:59Z", "before")).unwrap();
        record(conn, &sample("c1", "2026-04-27T00:00:00Z", "at_since")).unwrap();
        record(conn, &sample("c1", "2026-04-27T12:00:00Z", "middle")).unwrap();
        record(conn, &sample("c1", "2026-04-28T00:00:00Z", "at_until")).unwrap();
        record(conn, &sample("c1", "2026-04-28T00:00:01Z", "after")).unwrap();

        let filter = HistorySearchFilter {
            since: Some("2026-04-27T00:00:00Z".into()),
            until: Some("2026-04-28T00:00:00Z".into()),
            limit: 200,
            ..HistorySearchFilter::default()
        };
        let result = search(conn, &filter).unwrap();
        let sqls: Vec<&str> = result.rows.iter().map(|r| r.sql.as_str()).collect();
        assert!(
            sqls.contains(&"at_since"),
            "since boundary inclusive: {sqls:?}"
        );
        assert!(sqls.contains(&"middle"));
        assert!(
            !sqls.contains(&"at_until"),
            "until boundary exclusive: {sqls:?}"
        );
        assert!(!sqls.contains(&"before"));
        assert!(!sqls.contains(&"after"));
        assert_eq!(result.rows.len(), 2);
    }

    #[test]
    fn search_clamps_limit_to_max_page() {
        let store = fresh_store();
        let conn = store.conn();
        for i in 0..205 {
            record(
                conn,
                &sample(
                    "c1",
                    &format!("2026-04-27T00:{:02}:{:02}Z", i / 60, i % 60),
                    &format!("SELECT {i}"),
                ),
            )
            .unwrap();
        }
        let filter = HistorySearchFilter {
            limit: 10_000,
            ..HistorySearchFilter::default()
        };
        let result = search(conn, &filter).unwrap();
        assert!(result.rows.len() <= MAX_PAGE as usize);
        assert_eq!(result.rows.len(), MAX_PAGE as usize);
        assert_eq!(result.total_matched, 205);
    }

    #[test]
    fn search_cyrillic_match_via_unicode61() {
        let store = fresh_store();
        let conn = store.conn();
        record(
            conn,
            &sample(
                "c1",
                "2026-04-27T00:00:01Z",
                "SELECT 1 -- комментарий пользователя",
            ),
        )
        .unwrap();
        record(
            conn,
            &sample("c1", "2026-04-27T00:00:02Z", "SELECT 2 -- english only"),
        )
        .unwrap();
        let filter = HistorySearchFilter {
            query: Some("комментарий".into()),
            limit: 200,
            ..HistorySearchFilter::default()
        };
        let result = search(conn, &filter).unwrap();
        assert_eq!(result.rows.len(), 1);
        assert!(result.rows[0].sql.contains("комментарий"));
    }

    #[test]
    fn record_does_not_panic_with_special_chars() {
        let store = fresh_store();
        let conn = store.conn();
        let weird =
            "SELECT 'it''s \"ok\"', '\\backslash', E'\\x00 NUL?', 'мульти-байтовый текст 🚀'";
        let id = record(conn, &sample("c1", "2026-04-27T00:00:01Z", weird)).unwrap();
        let got = get_by_id(conn, &id).unwrap().unwrap();
        assert_eq!(got.sql, weird);
    }

    #[test]
    fn export_iter_invokes_callback_per_row() {
        let store = fresh_store();
        let conn = store.conn();
        for i in 0..7 {
            record(
                conn,
                &sample(
                    "c1",
                    &format!("2026-04-27T00:00:{i:02}Z"),
                    &format!("SELECT {i}"),
                ),
            )
            .unwrap();
        }
        let mut collected: Vec<HistoryRow> = Vec::new();
        let count = export_iter(conn, &HistorySearchFilter::default(), |row| {
            collected.push(row.clone());
            Ok(())
        })
        .unwrap();
        assert_eq!(count, 7);
        assert_eq!(collected.len(), 7);
    }

    #[test]
    fn export_iter_propagates_io_error() {
        let store = fresh_store();
        let conn = store.conn();
        record(conn, &sample("c1", "2026-04-27T00:00:01Z", "SELECT 1")).unwrap();
        let err = export_iter(conn, &HistorySearchFilter::default(), |_row| {
            Err(std::io::Error::other("disk full"))
        })
        .expect_err("must surface io error");
        let s = err.to_string();
        assert!(
            s.contains("disk full"),
            "expected propagated io::Error: {s}"
        );
    }

    #[test]
    fn export_iter_respects_filter() {
        let store = fresh_store();
        let conn = store.conn();
        for i in 0..10 {
            record(
                conn,
                &sample(
                    "c1",
                    &format!("2026-04-27T00:00:{i:02}Z"),
                    &format!("SELECT ok {i}"),
                ),
            )
            .unwrap();
        }
        for i in 0..3 {
            let mut input = sample(
                "c1",
                &format!("2026-04-27T00:01:{i:02}Z"),
                &format!("SELECT err {i}"),
            );
            input.status = HistoryStatus::Error;
            record(conn, &input).unwrap();
        }
        let mut count_visited = 0;
        let count = export_iter(
            conn,
            &HistorySearchFilter {
                status: Some(HistoryStatus::Error),
                ..HistorySearchFilter::default()
            },
            |_| {
                count_visited += 1;
                Ok(())
            },
        )
        .unwrap();
        assert_eq!(count, 3);
        assert_eq!(count_visited, 3);
    }

    #[test]
    fn migrations_apply_idempotently() {
        let mut store = Store::open_in_memory().unwrap();
        store.run_migrations().unwrap();
        store.run_migrations().unwrap();
        let count: i64 = store
            .conn()
            .query_row("SELECT COUNT(*) FROM schema_migrations", [], |r| r.get(0))
            .unwrap();
        // added migrations 004 + 005 — total = MIGRATIONS.len()
        assert_eq!(
            count,
            i64::try_from(crate::connection::store::migrations_count()).unwrap()
        );
    }
}
