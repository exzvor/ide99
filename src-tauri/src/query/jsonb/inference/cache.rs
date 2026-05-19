//! SQLite-backed cache for `InferredSchema`.
//!
//! Reuses the single rusqlite handle owned by `AppState` (same pattern
//! as snippets/connections/health stores). Soft-cap: schemas larger
//! than 64 KB are truncated to top-50 nodes by freq before write.

use rusqlite::{params, Connection as SqliteConnection, OptionalExtension};

use super::types::{FullyQualifiedColumn, InferenceError, InferredSchema, TableStats};

const SOFT_CAP_BYTES: usize = 64 * 1024;
const TOP_NODES_AFTER_TRUNCATE: usize = 50;

#[derive(Debug, Clone, PartialEq)]
pub struct CacheEntry {
    pub schema: InferredSchema,
    pub inferred_at: i64,
    pub stats: Option<TableStats>,
}

/// Read a cached schema entry for the given connection and column.
///
/// Returns `Ok(None)` if no entry exists.
///
/// # Errors
///
/// Returns [`InferenceError::Sqlite`] on database failure or
/// [`InferenceError::Internal`] if the stored JSON is malformed.
pub fn read(    db: &SqliteConnection,
    conn_id: &str,
    fqn: &FullyQualifiedColumn,
) -> Result<Option<CacheEntry>, InferenceError> {
    db.query_row(        "SELECT schema_json, generated_at, stat_n_ins, stat_n_upd, stat_n_del, stat_n_live \
         FROM inferred_schemas \
         WHERE conn_id=?1 AND schema_name=?2 AND table_name=?3 AND column_name=?4",
        params![conn_id, &fqn.schema, &fqn.table, &fqn.column],
        |row| {
            let schema_json: String = row.get(0)?;
            let inferred_at: i64 = row.get(1)?;
            let n_ins: Option<i64> = row.get(2)?;
            let n_upd: Option<i64> = row.get(3)?;
            let n_del: Option<i64> = row.get(4)?;
            let n_live: Option<i64> = row.get(5)?;
            Ok((schema_json, inferred_at, n_ins, n_upd, n_del, n_live))
        },
)
    .optional()
    .map_err(|e| map_sqlite(&e))?
    .map(|(json, ts, ins, upd, del, live)| {
        let schema: InferredSchema =
            serde_json::from_str(&json).map_err(|e| InferenceError::Internal {
                message: e.to_string(),
            })?;
        let stats = match (ins, upd, del, live) {
            (Some(i), Some(u), Some(d), Some(l)) => Some(TableStats {
                n_tup_ins: i,
                n_tup_upd: u,
                n_tup_del: d,
                n_live_tup: l,
            }),
            _ => None,
        };
        Ok(CacheEntry {
            schema,
            inferred_at: ts,
            stats,
        })
    })
    .transpose()
}

/// Write (upsert) an inferred schema entry for the given connection and column.
///
/// Schemas exceeding 64 KB are truncated to the top 50 nodes by frequency
/// before being stored.
///
/// # Errors
///
/// Returns [`InferenceError::Internal`] if serialization fails, or
/// [`InferenceError::Sqlite`] on database failure.
pub fn write(    db: &SqliteConnection,
    conn_id: &str,
    fqn: &FullyQualifiedColumn,
    schema: &InferredSchema,
    stats: Option<&TableStats>,
) -> Result<(), InferenceError> {
    let payload = serialize_with_softcap(schema)?;
    db.execute(        "INSERT INTO inferred_schemas \
           (conn_id, schema_name, table_name, column_name, schema_json, sample_count, generated_at, \
            stat_n_ins, stat_n_upd, stat_n_del, stat_n_live) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11) \
         ON CONFLICT(conn_id, schema_name, table_name, column_name) DO UPDATE SET \
           schema_json   = excluded.schema_json, \
           sample_count  = excluded.sample_count, \
           generated_at  = excluded.generated_at, \
           stat_n_ins    = excluded.stat_n_ins, \
           stat_n_upd    = excluded.stat_n_upd, \
           stat_n_del    = excluded.stat_n_del, \
           stat_n_live   = excluded.stat_n_live",
        params![
            conn_id,
            &fqn.schema,
            &fqn.table,
            &fqn.column,
            payload,
            i64::from(schema.sample_count),
            schema.generated_at,
            stats.map(|s| s.n_tup_ins),
            stats.map(|s| s.n_tup_upd),
            stats.map(|s| s.n_tup_del),
            stats.map(|s| s.n_live_tup),
        ],
)
    .map_err(|e| map_sqlite(&e))?;
    Ok(())
}

/// Delete the cached entry for the given connection and column.
///
/// # Errors
///
/// Returns [`InferenceError::Sqlite`] on database failure.
pub fn invalidate(    db: &SqliteConnection,
    conn_id: &str,
    fqn: &FullyQualifiedColumn,
) -> Result<(), InferenceError> {
    db.execute(        "DELETE FROM inferred_schemas \
         WHERE conn_id=?1 AND schema_name=?2 AND table_name=?3 AND column_name=?4",
        params![conn_id, &fqn.schema, &fqn.table, &fqn.column],
)
    .map_err(|e| map_sqlite(&e))?;
    Ok(())
}

/// Delete all cached entries for the given connection ID.
///
/// Returns the number of rows deleted.
///
/// # Errors
///
/// Returns [`InferenceError::Sqlite`] on database failure.
pub fn evict_for_connection(db: &SqliteConnection, conn_id: &str) -> Result<usize, InferenceError> {
    let n = db
        .execute(            "DELETE FROM inferred_schemas WHERE conn_id = ?1",
            params![conn_id],
)
        .map_err(|e| map_sqlite(&e))?;
    Ok(n)
}

// ----- helpers -----

fn serialize_with_softcap(schema: &InferredSchema) -> Result<String, InferenceError> {
    let primary = serde_json::to_string(schema).map_err(|e| InferenceError::Internal {
        message: e.to_string(),
    })?;
    if primary.len() <= SOFT_CAP_BYTES {
        return Ok(primary);
    }
    // Truncate: keep top-N nodes by freq.
    let mut truncated = schema.clone();
    truncated.nodes.sort_by(|a, b| {
        b.freq
            .partial_cmp(&a.freq)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    truncated.nodes.truncate(TOP_NODES_AFTER_TRUNCATE);
    truncated.nodes.sort_by(|a, b| {
        a.path
            .len()
            .cmp(&b.path.len())
            .then_with(|| a.path.cmp(&b.path))
    });
    tracing::warn!(        blob_bytes = primary.len(),
        cap_bytes = SOFT_CAP_BYTES,
        top_nodes = TOP_NODES_AFTER_TRUNCATE,
        "inference: schema blob exceeds cap, truncated to top nodes",
);
    serde_json::to_string(&truncated).map_err(|e| InferenceError::Internal {
        message: e.to_string(),
    })
}

fn map_sqlite(e: &rusqlite::Error) -> InferenceError {
    InferenceError::Sqlite {
        message: e.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::query::jsonb::inference::types::{
        InferredNode, PathSegment, Primitive, ProbableType,
    };

    fn open_in_memory() -> SqliteConnection {
        let db = SqliteConnection::open_in_memory().unwrap();
        // Apply the migration manually for tests.
        db.execute_batch(include_str!(            "../../../../migrations/009_jsonb_inferred_schemas.sql"
))
        .unwrap();
        db
    }

    fn fqn() -> FullyQualifiedColumn {
        FullyQualifiedColumn {
            schema: "public".into(),
            table: "events".into(),
            column: "data".into(),
        }
    }

    fn sample_schema() -> InferredSchema {
        InferredSchema {
            nodes: vec![InferredNode {
                path: vec![PathSegment::Key("user".into())],
                kind: ProbableType::Primitive {
                    value: Primitive::String,
                },
                freq: 0.95,
                samples: vec![serde_json::json!("alice")],
            }],
            sample_count: 100,
            generated_at: 1_000,
        }
    }

    #[test]
    fn round_trip_write_then_read() {
        let db = open_in_memory();
        let s = sample_schema();
        let stats = TableStats {
            n_tup_ins: 10,
            n_tup_upd: 5,
            n_tup_del: 1,
            n_live_tup: 100,
        };
        write(&db, "c1", &fqn(), &s, Some(&stats)).unwrap();
        let entry = read(&db, "c1", &fqn()).unwrap().expect("entry exists");
        assert_eq!(entry.schema, s);
        assert_eq!(entry.stats, Some(stats));
    }

    #[test]
    fn round_trip_with_none_stats() {
        let db = open_in_memory();
        let s = sample_schema();
        write(&db, "c1", &fqn(), &s, None).unwrap();
        let entry = read(&db, "c1", &fqn()).unwrap().expect("entry exists");
        assert_eq!(entry.schema, s);
        assert_eq!(entry.stats, None);
    }

    #[test]
    fn missing_returns_none() {
        let db = open_in_memory();
        assert!(read(&db, "c1", &fqn()).unwrap().is_none());
    }

    #[test]
    fn invalidate_removes_row() {
        let db = open_in_memory();
        write(&db, "c1", &fqn(), &sample_schema(), None).unwrap();
        invalidate(&db, "c1", &fqn()).unwrap();
        assert!(read(&db, "c1", &fqn()).unwrap().is_none());
    }

    #[test]
    fn evict_for_connection_drops_all_for_that_conn() {
        let db = open_in_memory();
        write(&db, "c1", &fqn(), &sample_schema(), None).unwrap();
        let other = FullyQualifiedColumn {
            schema: "public".into(),
            table: "x".into(),
            column: "y".into(),
        };
        write(&db, "c1", &other, &sample_schema(), None).unwrap();
        write(&db, "c2", &fqn(), &sample_schema(), None).unwrap();
        let n = evict_for_connection(&db, "c1").unwrap();
        assert_eq!(n, 2);
        assert!(read(&db, "c1", &fqn()).unwrap().is_none());
        assert!(read(&db, "c2", &fqn()).unwrap().is_some());
    }

    #[test]
    fn upsert_overwrites_existing() {
        let db = open_in_memory();
        write(&db, "c1", &fqn(), &sample_schema(), None).unwrap();
        let mut updated = sample_schema();
        updated.sample_count = 200;
        updated.generated_at = 2_000;
        write(&db, "c1", &fqn(), &updated, None).unwrap();
        let entry = read(&db, "c1", &fqn()).unwrap().unwrap();
        assert_eq!(entry.schema.sample_count, 200);
        assert_eq!(entry.schema.generated_at, 2_000);
    }

    #[test]
    #[allow(clippy::cast_precision_loss)]
    fn soft_cap_truncates_huge_schemas() {
        let mut huge = sample_schema();
        huge.nodes.clear();
        for i in 0..2_000 {
            huge.nodes.push(InferredNode {
                path: vec![PathSegment::Key(format!("key_{i:08}"))],
                kind: ProbableType::Primitive {
                    value: Primitive::String,
                },
                freq: 1.0 - (i as f32) / 2_000.0,
                samples: vec![serde_json::json!(format!("value_{i}_some_long_string"))],
            });
        }
        let s = serde_json::to_string(&huge).unwrap();
        assert!(s.len() > SOFT_CAP_BYTES, "fixture should overflow cap");
        let db = open_in_memory();
        write(&db, "c1", &fqn(), &huge, None).unwrap();
        let entry = read(&db, "c1", &fqn()).unwrap().unwrap();
        assert!(entry.schema.nodes.len() <= TOP_NODES_AFTER_TRUNCATE);

        // Top-50 nodes by freq should have been retained. The fixture sets
        // freq = 1.0 - i/2_000 for i in 0..2_000, so the surviving nodes
        // must all have freq > 1.0 - (50/2_000) = 0.975. The cutoff is the
        // 50th-highest freq from the fixture.
        let min_kept_freq = entry
            .schema
            .nodes
            .iter()
            .map(|n| n.freq)
            .fold(f32::INFINITY, f32::min);
        assert!(            min_kept_freq >= 0.975 - 1e-3,
            "expected top-freq nodes retained; min freq in survivors = {min_kept_freq}"
);

        // Surviving nodes must remain sorted by (path.len ASC, path lex) per
        // serialize_with_softcap's re-sort step.
        for window in entry.schema.nodes.windows(2) {
            let a = &window[0];
            let b = &window[1];
            assert!(                a.path.len() < b.path.len() || (a.path.len() == b.path.len() && a.path <= b.path),
                "soft-cap output must be sorted by (path.len, path)"
);
        }
    }
}
