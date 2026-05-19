//! — Recent EXPLAIN plans persistence + FTS5 search.
//!
//! Mirror of `query::history` (S6) shape: free functions over
//! `&rusqlite::Connection`, caller (`AppState`) holds the `Mutex<Store>`
//! guard for the duration of the call.

#![allow(clippy::missing_errors_doc, clippy::missing_panics_doc)]

use rusqlite::{params, params_from_iter, types::Value, Connection, OptionalExtension, Row};
use serde_json::Value as JsonValue;
use uuid::Uuid;

use crate::query::types::{
    NewRecentPlan, RecentPlanMode, RecentPlanRow, RecentPlansFilter, RecentPlansSearchResult,
};

pub const MAX_PAGE: u32 = 200;
pub const LRU_CAP_UNPINNED: i64 = 100;

const SELECT_COLUMNS: &str = "p.id, p.connection_id, p.connection_name, p.sql, \
     p.plan_json, p.executed_at, p.duration_ms, p.total_cost, p.mode, \
     p.options_json, p.involved_tables_json, p.pinned";

/// Insert a new EXPLAIN plan and prune unpinned rows back to the LRU cap.
///
/// Caller is responsible for honoring `connections.exclude_from_recent_plans`
/// — `save` itself always inserts. INSERT + LRU DELETE run in the same
/// transaction so we never expose a >`LRU_CAP_UNPINNED`-unpinned-rows window.
pub fn save(conn: &mut Connection, input: NewRecentPlan) -> rusqlite::Result<String> {
    // Destructure up front so each owned field is moved into a named local —
    // this both documents intent at the IPC boundary and satisfies
    // clippy::needless_pass_by_value (the `params!` macro otherwise only
    // borrows, making the by-value parameter look unused).
    let NewRecentPlan {
        connection_id,
        connection_name,
        sql,
        plan_json,
        duration_ms,
        mode,
        options_json,
    } = input;

    let id = Uuid::new_v4().to_string();
    let executed_at = chrono::Utc::now().to_rfc3339();
    let total_cost = extract_total_cost(&plan_json);
    let involved_tables = extract_tables(&plan_json);
    let involved_tables_json =
        serde_json::to_string(&involved_tables).unwrap_or_else(|_| "[]".to_string());
    let plan_json_str = serde_json::to_string(&plan_json).unwrap_or_else(|_| "null".to_string());

    let tx = conn.transaction()?;
    tx.execute(        "INSERT INTO recent_plans \
         (id, connection_id, connection_name, sql, plan_json, executed_at, \
          duration_ms, total_cost, mode, options_json, involved_tables_json, pinned) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 0)",
        params![
            id,
            connection_id,
            connection_name,
            sql,
            plan_json_str,
            executed_at,
            i64::try_from(duration_ms).unwrap_or(i64::MAX),
            total_cost,
            mode.as_str(),
            options_json,
            involved_tables_json,
        ],
)?;
    // LRU eviction: keep the LRU_CAP_UNPINNED most-recent unpinned rows.
    tx.execute(        "DELETE FROM recent_plans \
         WHERE pinned = 0 AND id NOT IN (\
           SELECT id FROM recent_plans \
           WHERE pinned = 0 \
           ORDER BY executed_at DESC \
           LIMIT ?1 \
)",
        params![LRU_CAP_UNPINNED],
)?;
    tx.commit()?;
    Ok(id)
}

/// FTS5-aware paginated search.
///
/// Filters compose with implicit AND. The FTS5 join is conditional —
/// non-MATCH queries skip the join cost. Order is `(pinned DESC,
/// executed_at DESC)` so pinned rows surface first even when older.
pub fn search(    conn: &Connection,
    filter: &RecentPlansFilter,
) -> rusqlite::Result<RecentPlansSearchResult> {
    let limit = filter.limit.min(MAX_PAGE);
    let (where_sql, args, has_match) = build_where_clause(filter);

    let from_sql = if has_match {
        "FROM recent_plans p \
         JOIN recent_plans_fts f ON f.rowid = p.rowid"
    } else {
        "FROM recent_plans p"
    };

    let select_sql = format!(        "SELECT {SELECT_COLUMNS} {from_sql}{where_sql} \
         ORDER BY p.pinned DESC, p.executed_at DESC \
         LIMIT ? OFFSET ?",
);
    let mut select_args = args.clone();
    select_args.push(Value::Integer(i64::from(limit)));
    select_args.push(Value::Integer(i64::from(filter.offset)));

    let mut stmt = conn.prepare(&select_sql)?;
    let rows_iter = stmt.query_map(params_from_iter(select_args.iter()), row_to_recent_plan)?;
    let mut rows = Vec::with_capacity(limit as usize);
    for r in rows_iter {
        rows.push(r?);
    }

    let count_sql = format!("SELECT COUNT(*) {from_sql}{where_sql}");
    let total: i64 = conn.query_row(&count_sql, params_from_iter(args.iter()), |row| row.get(0))?;

    Ok(RecentPlansSearchResult {
        rows,
        total: u64::try_from(total).unwrap_or(0),
    })
}

/// Fetch a single row by id; `None` if missing or already evicted.
pub fn get(conn: &Connection, id: &str) -> rusqlite::Result<Option<RecentPlanRow>> {
    let sql = format!("SELECT {SELECT_COLUMNS} FROM recent_plans p WHERE p.id = ?1");
    conn.query_row(&sql, params![id], row_to_recent_plan)
        .optional()
}

/// Idempotent — missing-id calls return `Ok(())` (mirror of `history::set_pinned`).
pub fn set_pinned(conn: &Connection, id: &str, pinned: bool) -> rusqlite::Result<()> {
    conn.execute(        "UPDATE recent_plans SET pinned = ?1 WHERE id = ?2",
        params![i64::from(pinned), id],
)?;
    Ok(())
}

/// Idempotent — missing-id deletes return `Ok(())`. FTS5 trigger keeps the
/// index in sync.
pub fn delete(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM recent_plans WHERE id = ?1", params![id])?;
    Ok(())
}

/// Bulk-delete all rows for a connection. Returns the number of rows removed.
pub fn clear_for_connection(conn: &Connection, connection_id: &str) -> rusqlite::Result<u64> {
    let rows = conn.execute(        "DELETE FROM recent_plans WHERE connection_id = ?1",
        params![connection_id],
)?;
    Ok(u64::try_from(rows).unwrap_or(0))
}

/// Recursively walk the plan tree gathering deduped `<schema>.<table>`.
///
/// Node-type-agnostic — works for Seq Scan, Index Scan, Bitmap Heap Scan,
/// Foreign Scan, etc. Nodes without a `Relation Name` field (Subquery Scan,
/// CTE Scan, Values Scan, …) are silently skipped. Defensive against
/// missing/malformed JSON — returns whatever was gathered so far.
#[must_use]
pub fn extract_tables(plan: &JsonValue) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let root = plan
        .as_array()
        .and_then(|arr| arr.first())
        .and_then(|first| first.get("Plan"));
    if let Some(root) = root {
        walk(root, &mut out);
    }
    out.sort();
    out.dedup();
    out
}

/// Top-level `Plan["Total Cost"]` if present and finite.
///
/// Defensive — returns `None` for non-array roots, missing `Plan`, missing
/// `Total Cost`, or non-finite values (NaN/Inf).
#[must_use]
pub fn extract_total_cost(plan: &JsonValue) -> Option<f64> {
    plan.as_array()
        .and_then(|arr| arr.first())
        .and_then(|first| first.get("Plan"))
        .and_then(|p| p.get("Total Cost"))
        .and_then(JsonValue::as_f64)
        .filter(|v| v.is_finite())
}

fn walk(node: &JsonValue, out: &mut Vec<String>) {
    if let Some(rel) = node.get("Relation Name").and_then(JsonValue::as_str) {
        let schema = node.get("Schema").and_then(JsonValue::as_str);
        let key = match schema {
            Some(s) if !s.is_empty() => format!("{s}.{rel}"),
            _ => rel.to_string(),
        };
        out.push(key);
    }
    if let Some(children) = node.get("Plans").and_then(JsonValue::as_array) {
        for c in children {
            walk(c, out);
        }
    }
}

fn build_where_clause(filter: &RecentPlansFilter) -> (String, Vec<Value>, bool) {
    let mut clauses: Vec<String> = Vec::new();
    let mut args: Vec<Value> = Vec::new();
    let mut has_match = false;

    if let Some(q) = &filter.query {
        if !q.trim().is_empty() {
            clauses.push("recent_plans_fts MATCH ?".to_string());
            args.push(Value::Text(q.clone()));
            has_match = true;
        }
    }
    if let Some(t) = &filter.table {
        if !t.trim().is_empty() {
            // involved_tables_json is a JSON array of strings; substring
            // match is enough to find "<schema>.<name>" or partial names.
            clauses.push("p.involved_tables_json LIKE ?".to_string());
            args.push(Value::Text(format!("%{t}%")));
        }
    }
    if let Some(c) = filter.cost_min {
        clauses.push("p.total_cost >= ?".to_string());
        args.push(Value::Real(c));
    }
    if let Some(c) = filter.cost_max {
        clauses.push("p.total_cost <= ?".to_string());
        args.push(Value::Real(c));
    }
    if let Some(cid) = &filter.connection_id {
        clauses.push("p.connection_id = ?".to_string());
        args.push(Value::Text(cid.clone()));
    }

    let where_sql = if clauses.is_empty() {
        String::new()
    } else {
        format!(" WHERE {}", clauses.join(" AND "))
    };
    (where_sql, args, has_match)
}

fn row_to_recent_plan(row: &Row) -> rusqlite::Result<RecentPlanRow> {
    let mode_str: String = row.get("mode")?;
    let mode = match mode_str.as_str() {
        "explain" => RecentPlanMode::Explain,
        "analyze" => RecentPlanMode::Analyze,
        other => {
            return Err(rusqlite::Error::FromSqlConversionFailure(                0,
                rusqlite::types::Type::Text,
                Box::new(std::io::Error::new(                    std::io::ErrorKind::InvalidData,
                    format!("unknown mode {other}"),
)),
));
        }
    };
    let involved_tables_json: String = row.get("involved_tables_json")?;
    let involved_tables: Vec<String> =
        serde_json::from_str(&involved_tables_json).unwrap_or_default();
    let duration_ms: i64 = row.get("duration_ms")?;
    let pinned: i64 = row.get("pinned")?;

    Ok(RecentPlanRow {
        id: row.get("id")?,
        connection_id: row.get("connection_id")?,
        connection_name: row.get("connection_name")?,
        sql: row.get("sql")?,
        plan_json: row.get("plan_json")?,
        executed_at: row.get("executed_at")?,
        duration_ms: u64::try_from(duration_ms).unwrap_or(0),
        total_cost: row.get("total_cost")?,
        mode,
        options_json: row.get("options_json")?,
        involved_tables,
        pinned: pinned != 0,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use serde_json::json;

    // -----------------------------------------------------------------------
    // extract_tables / extract_total_cost
    // -----------------------------------------------------------------------

    #[test]
    fn extract_tables_seq_scan() {
        let plan = json!([{
            "Plan": {
                "Node Type": "Seq Scan",
                "Schema": "public",
                "Relation Name": "users",
                "Plans": []
            }
        }]);
        assert_eq!(extract_tables(&plan), vec!["public.users".to_string()]);
    }

    #[test]
    fn extract_tables_nested() {
        let plan = json!([{
            "Plan": {
                "Node Type": "Hash Join",
                "Plans": [
                    { "Node Type": "Seq Scan", "Schema": "public", "Relation Name": "a", "Plans": [] },
                    { "Node Type": "Hash", "Plans": [
                        { "Node Type": "Index Scan", "Schema": "qa", "Relation Name": "b", "Plans": [] }
                    ]}
                ]
            }
        }]);
        let mut got = extract_tables(&plan);
        got.sort();
        assert_eq!(got, vec!["public.a".to_string(), "qa.b".to_string()]);
    }

    #[test]
    fn extract_tables_dedupes() {
        let plan = json!([{
            "Plan": {
                "Node Type": "Append",
                "Plans": [
                    { "Node Type": "Seq Scan", "Schema": "public", "Relation Name": "x", "Plans": [] },
                    { "Node Type": "Seq Scan", "Schema": "public", "Relation Name": "x", "Plans": [] }
                ]
            }
        }]);
        assert_eq!(extract_tables(&plan), vec!["public.x".to_string()]);
    }

    #[test]
    fn extract_tables_skips_subquery() {
        let plan = json!([{
            "Plan": {
                "Node Type": "Subquery Scan",
                "Plans": [
                    { "Node Type": "Seq Scan", "Schema": "public", "Relation Name": "y", "Plans": [] }
                ]
            }
        }]);
        // Subquery Scan node has no Relation Name → skipped, but its child Seq Scan adds y.
        assert_eq!(extract_tables(&plan), vec!["public.y".to_string()]);
    }

    #[test]
    fn extract_tables_handles_missing_schema() {
        // Real-world plans sometimes omit Schema for system tables.
        let plan = json!([{
            "Plan": { "Node Type": "Seq Scan", "Relation Name": "sys", "Plans": [] }
        }]);
        // Fallback to relation name only when schema missing.
        assert_eq!(extract_tables(&plan), vec!["sys".to_string()]);
    }

    #[test]
    fn extract_tables_malformed_returns_empty() {
        let plan = json!({ "garbage": true });
        assert!(extract_tables(&plan).is_empty());
    }

    #[test]
    fn extract_total_cost_present() {
        let plan = json!([{ "Plan": { "Total Cost": 12345.67 } }]);
        assert_eq!(extract_total_cost(&plan), Some(12345.67));
    }

    #[test]
    fn extract_total_cost_missing_returns_none() {
        let plan = json!([{ "Plan": {} }]);
        assert_eq!(extract_total_cost(&plan), None);
    }

    // -----------------------------------------------------------------------
    // save / get / set_pinned
    // -----------------------------------------------------------------------

    /// Spin up an in-memory `SQLite` with the migrations applied. Tests use
    /// this instead of the production DB.
    fn fresh_db() -> Connection {
        let conn = Connection::open_in_memory().expect("open");
        conn.execute_batch(include_str!("../../migrations/001_connections.sql"))
            .expect("001");
        // 002–005 add columns to connections that recent_plans does NOT
        // depend on, so we only apply 006 directly.
        conn.execute_batch(include_str!("../../migrations/006_recent_plans.sql"))
            .expect("006");
        conn
    }

    fn sample_plan() -> serde_json::Value {
        json!([{
            "Plan": { "Node Type": "Seq Scan", "Schema": "public",
                      "Relation Name": "t", "Total Cost": 100.0, "Plans": [] }
        }])
    }

    fn insert_n(conn: &mut Connection, n: usize) {
        for i in 0..n {
            let id = save(                conn,
                NewRecentPlan {
                    connection_id: "c1".into(),
                    connection_name: "test".into(),
                    sql: format!("SELECT {i}"),
                    plan_json: sample_plan(),
                    duration_ms: 1,
                    mode: RecentPlanMode::Explain,
                    options_json: "{}".into(),
                },
)
            .expect("save");
            assert!(!id.is_empty());
        }
    }

    #[test]
    fn save_inserts_row_and_returns_uuid() {
        let mut conn = fresh_db();
        let id = save(            &mut conn,
            NewRecentPlan {
                connection_id: "c1".into(),
                connection_name: "test".into(),
                sql: "SELECT 1".into(),
                plan_json: sample_plan(),
                duration_ms: 12,
                mode: RecentPlanMode::Analyze,
                options_json: "{\"verbose\":false}".into(),
            },
)
        .expect("save");

        assert_eq!(id.len(), 36); // UUID v4
        let total: i64 = conn
            .query_row("SELECT COUNT(*) FROM recent_plans", [], |r| r.get(0))
            .unwrap();
        assert_eq!(total, 1);
    }

    #[test]
    fn save_lru_evicts_oldest_unpinned_at_cap_plus_one() {
        let mut conn = fresh_db();
        insert_n(&mut conn, usize::try_from(LRU_CAP_UNPINNED).unwrap());
        let total: i64 = conn
            .query_row("SELECT COUNT(*) FROM recent_plans", [], |r| r.get(0))
            .unwrap();
        assert_eq!(total, LRU_CAP_UNPINNED);

        // Insert one more — total stays at LRU_CAP_UNPINNED.
        insert_n(&mut conn, 1);
        let total: i64 = conn
            .query_row("SELECT COUNT(*) FROM recent_plans", [], |r| r.get(0))
            .unwrap();
        assert_eq!(total, LRU_CAP_UNPINNED);
    }

    #[test]
    fn save_lru_keeps_pinned() {
        let mut conn = fresh_db();
        // Insert 1 plan, pin it.
        let id = save(            &mut conn,
            NewRecentPlan {
                connection_id: "c1".into(),
                connection_name: "t".into(),
                sql: "PINNED".into(),
                plan_json: sample_plan(),
                duration_ms: 1,
                mode: RecentPlanMode::Explain,
                options_json: "{}".into(),
            },
)
        .expect("save");
        set_pinned(&conn, &id, true).expect("pin");

        // Now insert LRU_CAP_UNPINNED more — pinned must survive even though
        // it's the oldest.
        insert_n(&mut conn, usize::try_from(LRU_CAP_UNPINNED).unwrap());
        let total: i64 = conn
            .query_row("SELECT COUNT(*) FROM recent_plans", [], |r| r.get(0))
            .unwrap();
        assert_eq!(total, LRU_CAP_UNPINNED + 1);

        // Pinned row still present.
        let pinned: i64 = conn
            .query_row(                "SELECT COUNT(*) FROM recent_plans WHERE id = ?1",
                params![id],
                |r| r.get(0),
)
            .unwrap();
        assert_eq!(pinned, 1);
    }

    #[test]
    fn save_populates_total_cost_and_tables() {
        let mut conn = fresh_db();
        let id = save(            &mut conn,
            NewRecentPlan {
                connection_id: "c1".into(),
                connection_name: "t".into(),
                sql: "SELECT * FROM public.t".into(),
                plan_json: sample_plan(),
                duration_ms: 1,
                mode: RecentPlanMode::Explain,
                options_json: "{}".into(),
            },
)
        .expect("save");
        let row = get(&conn, &id).expect("get").expect("some");
        assert_eq!(row.total_cost, Some(100.0));
        assert_eq!(row.involved_tables, vec!["public.t".to_string()]);
    }

    // -----------------------------------------------------------------------
    // search
    // -----------------------------------------------------------------------

    #[test]
    fn search_returns_rows_default_filter() {
        let mut conn = fresh_db();
        insert_n(&mut conn, 3);
        let res = search(&conn, &RecentPlansFilter::default()).expect("search");
        assert_eq!(res.rows.len(), 3);
        assert_eq!(res.total, 3);
    }

    #[test]
    fn search_filters_by_fts_query() {
        let mut conn = fresh_db();
        save(            &mut conn,
            NewRecentPlan {
                connection_id: "c1".into(),
                connection_name: "t".into(),
                sql: "SELECT * FROM users".into(),
                plan_json: sample_plan(),
                duration_ms: 1,
                mode: RecentPlanMode::Explain,
                options_json: "{}".into(),
            },
)
        .unwrap();
        save(            &mut conn,
            NewRecentPlan {
                connection_id: "c1".into(),
                connection_name: "t".into(),
                sql: "SELECT * FROM products".into(),
                plan_json: sample_plan(),
                duration_ms: 1,
                mode: RecentPlanMode::Explain,
                options_json: "{}".into(),
            },
)
        .unwrap();
        let res = search(            &conn,
            &RecentPlansFilter {
                query: Some("users".into()),
                ..RecentPlansFilter::default()
            },
)
        .unwrap();
        assert_eq!(res.rows.len(), 1);
        assert!(res.rows[0].sql.contains("users"));
    }

    #[test]
    fn search_filters_by_table_substring() {
        let mut conn = fresh_db();
        let plan_users = json!([{ "Plan": { "Node Type": "Seq Scan", "Schema": "public",
            "Relation Name": "users", "Total Cost": 1.0, "Plans": [] }}]);
        let plan_orders = json!([{ "Plan": { "Node Type": "Seq Scan", "Schema": "public",
            "Relation Name": "orders", "Total Cost": 1.0, "Plans": [] }}]);
        save(            &mut conn,
            NewRecentPlan {
                connection_id: "c1".into(),
                connection_name: "t".into(),
                sql: "a".into(),
                plan_json: plan_users,
                duration_ms: 1,
                mode: RecentPlanMode::Explain,
                options_json: "{}".into(),
            },
)
        .unwrap();
        save(            &mut conn,
            NewRecentPlan {
                connection_id: "c1".into(),
                connection_name: "t".into(),
                sql: "b".into(),
                plan_json: plan_orders,
                duration_ms: 1,
                mode: RecentPlanMode::Explain,
                options_json: "{}".into(),
            },
)
        .unwrap();
        let res = search(            &conn,
            &RecentPlansFilter {
                table: Some("orders".into()),
                ..RecentPlansFilter::default()
            },
)
        .unwrap();
        assert_eq!(res.rows.len(), 1);
        assert_eq!(            res.rows[0].involved_tables,
            vec!["public.orders".to_string()]
);
    }

    #[test]
    fn search_filters_by_cost_range() {
        let mut conn = fresh_db();
        for cost in [10.0_f64, 100.0, 1000.0] {
            let plan = json!([{ "Plan": { "Node Type": "Seq Scan",
                "Relation Name": "t", "Total Cost": cost, "Plans": [] }}]);
            save(                &mut conn,
                NewRecentPlan {
                    connection_id: "c1".into(),
                    connection_name: "t".into(),
                    sql: format!("cost {cost}"),
                    plan_json: plan,
                    duration_ms: 1,
                    mode: RecentPlanMode::Explain,
                    options_json: "{}".into(),
                },
)
            .unwrap();
        }
        let res = search(            &conn,
            &RecentPlansFilter {
                cost_min: Some(50.0),
                cost_max: Some(500.0),
                ..RecentPlansFilter::default()
            },
)
        .unwrap();
        assert_eq!(res.rows.len(), 1);
        assert_eq!(res.rows[0].total_cost, Some(100.0));
    }

    #[test]
    fn search_orders_pinned_first() {
        let mut conn = fresh_db();
        let id_first = save(            &mut conn,
            NewRecentPlan {
                connection_id: "c1".into(),
                connection_name: "t".into(),
                sql: "OLD".into(),
                plan_json: sample_plan(),
                duration_ms: 1,
                mode: RecentPlanMode::Explain,
                options_json: "{}".into(),
            },
)
        .unwrap();
        save(            &mut conn,
            NewRecentPlan {
                connection_id: "c1".into(),
                connection_name: "t".into(),
                sql: "NEW".into(),
                plan_json: sample_plan(),
                duration_ms: 1,
                mode: RecentPlanMode::Explain,
                options_json: "{}".into(),
            },
)
        .unwrap();
        set_pinned(&conn, &id_first, true).unwrap();

        let res = search(&conn, &RecentPlansFilter::default()).unwrap();
        assert_eq!(res.rows.len(), 2);
        assert_eq!(res.rows[0].sql, "OLD"); // pinned first even though older
        assert_eq!(res.rows[1].sql, "NEW");
    }

    #[test]
    fn search_paginates() {
        let mut conn = fresh_db();
        insert_n(&mut conn, 5);
        let page1 = search(            &conn,
            &RecentPlansFilter {
                limit: 2,
                offset: 0,
                ..RecentPlansFilter::default()
            },
)
        .unwrap();
        let page2 = search(            &conn,
            &RecentPlansFilter {
                limit: 2,
                offset: 2,
                ..RecentPlansFilter::default()
            },
)
        .unwrap();
        assert_eq!(page1.rows.len(), 2);
        assert_eq!(page2.rows.len(), 2);
        assert_eq!(page1.total, 5);
        assert_eq!(page2.total, 5);
        // No overlap.
        for r1 in &page1.rows {
            for r2 in &page2.rows {
                assert_ne!(r1.id, r2.id);
            }
        }
    }

    // -----------------------------------------------------------------------
    // delete / clear_for_connection
    // -----------------------------------------------------------------------

    #[test]
    fn delete_removes_row() {
        let mut conn = fresh_db();
        let id = save(            &mut conn,
            NewRecentPlan {
                connection_id: "c1".into(),
                connection_name: "t".into(),
                sql: "x".into(),
                plan_json: sample_plan(),
                duration_ms: 1,
                mode: RecentPlanMode::Explain,
                options_json: "{}".into(),
            },
)
        .unwrap();
        delete(&conn, &id).unwrap();
        assert!(get(&conn, &id).unwrap().is_none());
    }

    #[test]
    fn clear_for_connection_only_targets_one_conn() {
        let mut conn = fresh_db();
        for cid in ["c1", "c1", "c2"] {
            save(                &mut conn,
                NewRecentPlan {
                    connection_id: cid.into(),
                    connection_name: "t".into(),
                    sql: cid.into(),
                    plan_json: sample_plan(),
                    duration_ms: 1,
                    mode: RecentPlanMode::Explain,
                    options_json: "{}".into(),
                },
)
            .unwrap();
        }
        let removed = clear_for_connection(&conn, "c1").unwrap();
        assert_eq!(removed, 2);
        let total: i64 = conn
            .query_row("SELECT COUNT(*) FROM recent_plans", [], |r| r.get(0))
            .unwrap();
        assert_eq!(total, 1);
    }
}
