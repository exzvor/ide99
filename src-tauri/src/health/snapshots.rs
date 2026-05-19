#![allow(    clippy::missing_errors_doc,
    clippy::doc_markdown,
    clippy::missing_panics_doc
)]

//! — `SQLite` history of `db_size_bytes` per connection.
//!
//! `save`: ≥1h dedup + 30d retention in one transaction.
//! `recent`: returns rows for the last `days` days oldest → newest.

use crate::health::types::HealthSnapshotRow;
use rusqlite::{params, Connection as SqliteConnection};

#[derive(Debug, thiserror::Error)]
pub enum SnapshotError {
    #[error("sqlite: {0}")]
    Sqlite(#[from] rusqlite::Error),
}

/// Insert a snapshot if the most recent one is older than 1 hour, then
/// delete snapshots older than 30 days. Both run in a single transaction
/// so reads never see a partial state.
pub fn save(    conn: &mut SqliteConnection,
    connection_id: &str,
    now_iso: &str,
    db_size_bytes: i64,
) -> Result<(), SnapshotError> {
    let tx = conn.transaction()?;
    // ≥1h dedup — only insert when no recent snapshot exists for this conn.
    // Both sides go through datetime() so a stored RFC-3339 ISO string with
    // `T`/`Z` is normalized before the lexicographic comparison; without
    // this, `'2026-04-29T12:00:00Z' > '2026-04-29 12:01:00'` would
    // incorrectly evaluate true (the 'T' byte sorts after space).
    tx.execute(        "INSERT INTO health_snapshots (connection_id, taken_at, db_size_bytes) \
         SELECT ?1, ?2, ?3 \
         WHERE NOT EXISTS (\
           SELECT 1 FROM health_snapshots \
            WHERE connection_id = ?1 \
              AND datetime(taken_at) > datetime(?2, '-1 hour') \
)",
        params![connection_id, now_iso, db_size_bytes],
)?;
    // 30d retention — drop anything older than 30d for this connection.
    tx.execute(        "DELETE FROM health_snapshots \
          WHERE connection_id = ?1 \
            AND datetime(taken_at) < datetime(?2, '-30 days')",
        params![connection_id, now_iso],
)?;
    tx.commit()?;
    Ok(())
}

/// Return snapshots for `connection_id` taken within the last `days` days,
/// ordered oldest → newest (the order the sparkline expects).
pub fn recent(    conn: &SqliteConnection,
    connection_id: &str,
    days: i64,
) -> Result<Vec<HealthSnapshotRow>, SnapshotError> {
    let bound = format!("-{days} days");
    let mut stmt = conn.prepare(        "SELECT taken_at, db_size_bytes \
           FROM health_snapshots \
          WHERE connection_id = ?1 \
            AND datetime(taken_at) > datetime('now', ?2) \
          ORDER BY datetime(taken_at) ASC",
)?;
    let rows = stmt.query_map(params![connection_id, bound], |row| {
        Ok(HealthSnapshotRow {
            taken_at: row.get(0)?,
            db_size_bytes: row.get(1)?,
        })
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    /// Spin up an in-memory `SQLite` with migrations 001 (connections) and
    /// 008 (`health_snapshots`) applied. Tests use this instead of the
    /// production DB.
    fn fresh_db() -> Connection {
        let conn = Connection::open_in_memory().expect("open");
        conn.pragma_update(None, "foreign_keys", "ON").expect("fk");
        conn.execute_batch(include_str!("../../migrations/001_connections.sql"))
            .expect("001");
        conn.execute_batch(include_str!("../../migrations/008_health_snapshots.sql"))
            .expect("008");
        conn
    }

    /// Create a connections row so FK refs resolve. Returns the inserted id.
    fn make_conn(conn: &Connection, id: &str) {
        conn.execute(            "INSERT INTO connections \
                (id, name, host, port, database, username, ssl_mode, has_password, \
                 created_at, updated_at) \
             VALUES (?1, ?1, 'h', 5432, 'd', 'u', 'prefer', 0, '2026-01-01', '2026-01-01')",
            params![id],
)
        .expect("insert conn");
    }

    fn count_rows(conn: &Connection, conn_id: &str) -> i64 {
        conn.query_row(            "SELECT COUNT(*) FROM health_snapshots WHERE connection_id = ?1",
            params![conn_id],
            |r| r.get(0),
)
        .expect("count")
    }

    #[test]
    fn save_inserts_first_snapshot() {
        let mut conn = fresh_db();
        make_conn(&conn, "c1");
        save(&mut conn, "c1", "2026-04-29T12:00:00Z", 1_000).expect("save");
        assert_eq!(count_rows(&conn, "c1"), 1);
    }

    #[test]
    fn save_dedups_within_one_hour() {
        let mut conn = fresh_db();
        make_conn(&conn, "c1");
        save(&mut conn, "c1", "2026-04-29T12:00:00Z", 1_000).expect("save 1");
        // 30 minutes later — must NOT insert.
        save(&mut conn, "c1", "2026-04-29T12:30:00Z", 2_000).expect("save 2");
        assert_eq!(count_rows(&conn, "c1"), 1);
        let bytes: i64 = conn
            .query_row(                "SELECT db_size_bytes FROM health_snapshots WHERE connection_id = ?1",
                params!["c1"],
                |r| r.get(0),
)
            .unwrap();
        assert_eq!(bytes, 1_000, "first snapshot wins inside the 1h window");
    }

    #[test]
    fn save_inserts_after_one_hour_gap() {
        let mut conn = fresh_db();
        make_conn(&conn, "c1");
        save(&mut conn, "c1", "2026-04-29T12:00:00Z", 1_000).expect("save 1");
        save(&mut conn, "c1", "2026-04-29T13:01:00Z", 2_000).expect("save 2");
        assert_eq!(count_rows(&conn, "c1"), 2);
    }

    #[test]
    fn save_cleans_up_after_30_days() {
        let mut conn = fresh_db();
        make_conn(&conn, "c1");
        // Manually seed a 31-day-old row.
        conn.execute(            "INSERT INTO health_snapshots (connection_id, taken_at, db_size_bytes) \
             VALUES ('c1', '2026-03-29T12:00:00Z', 100)",
            [],
)
        .unwrap();
        // Save at 2026-04-29 → datetime('-30 days') = 2026-03-30 → seeded
        // row at 2026-03-29 is older and gets deleted; new row inserted.
        save(&mut conn, "c1", "2026-04-29T12:00:00Z", 200).expect("save");
        let bytes: i64 = conn
            .query_row(                "SELECT db_size_bytes FROM health_snapshots WHERE connection_id = 'c1'",
                [],
                |r| r.get(0),
)
            .unwrap();
        assert_eq!(bytes, 200);
        assert_eq!(count_rows(&conn, "c1"), 1);
    }

    #[test]
    fn save_isolated_per_connection() {
        let mut conn = fresh_db();
        make_conn(&conn, "c1");
        make_conn(&conn, "c2");
        save(&mut conn, "c1", "2026-04-29T12:00:00Z", 1_000).expect("c1 save");
        // c2 should be allowed even though c1 just saved — independent buckets.
        save(&mut conn, "c2", "2026-04-29T12:00:00Z", 2_000).expect("c2 save");
        assert_eq!(count_rows(&conn, "c1"), 1);
        assert_eq!(count_rows(&conn, "c2"), 1);
    }

    #[test]
    fn fk_cascade_on_connection_delete() {
        let mut conn = fresh_db();
        make_conn(&conn, "c1");
        save(&mut conn, "c1", "2026-04-29T12:00:00Z", 1_000).expect("save");
        assert_eq!(count_rows(&conn, "c1"), 1);
        conn.execute("DELETE FROM connections WHERE id = 'c1'", [])
            .unwrap();
        assert_eq!(            count_rows(&conn, "c1"),
            0,
            "FK ON DELETE CASCADE must wipe snapshots when conn deleted"
);
    }

    #[test]
    fn recent_returns_oldest_to_newest() {
        let conn = fresh_db();
        make_conn(&conn, "c1");
        // Seed three snapshots at known times.
        conn.execute(            "INSERT INTO health_snapshots (connection_id, taken_at, db_size_bytes) VALUES \
             ('c1', datetime('now', '-3 days'),  300), \
             ('c1', datetime('now', '-2 days'),  200), \
             ('c1', datetime('now', '-1 days'),  100)",
            [],
)
        .unwrap();
        let rows = recent(&conn, "c1", 7).expect("recent");
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0].db_size_bytes, 300, "oldest first");
        assert_eq!(rows[1].db_size_bytes, 200);
        assert_eq!(rows[2].db_size_bytes, 100, "newest last");
    }

    #[test]
    fn recent_filters_outside_window() {
        let conn = fresh_db();
        make_conn(&conn, "c1");
        conn.execute(            "INSERT INTO health_snapshots (connection_id, taken_at, db_size_bytes) VALUES \
             ('c1', datetime('now', '-10 days'), 999), \
             ('c1', datetime('now', '-1 days'),  111)",
            [],
)
        .unwrap();
        let rows = recent(&conn, "c1", 7).expect("recent");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].db_size_bytes, 111);
    }

    #[test]
    fn recent_isolated_per_connection() {
        let conn = fresh_db();
        make_conn(&conn, "c1");
        make_conn(&conn, "c2");
        conn.execute(            "INSERT INTO health_snapshots (connection_id, taken_at, db_size_bytes) VALUES \
             ('c1', datetime('now', '-1 days'), 1), \
             ('c2', datetime('now', '-1 days'), 2)",
            [],
)
        .unwrap();
        let r1 = recent(&conn, "c1", 7).expect("c1");
        let r2 = recent(&conn, "c2", 7).expect("c2");
        assert_eq!(r1.len(), 1);
        assert_eq!(r1[0].db_size_bytes, 1);
        assert_eq!(r2.len(), 1);
        assert_eq!(r2[0].db_size_bytes, 2);
    }

    #[test]
    fn recent_empty_when_none() {
        let conn = fresh_db();
        make_conn(&conn, "c1");
        let rows = recent(&conn, "c1", 7).expect("recent");
        assert!(rows.is_empty());
    }
}
