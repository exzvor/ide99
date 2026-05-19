//! Schema-snapshot capture for the migration timeline.
//!
//! `capture` runs a focused introspection query and serializes the result as a
//! deterministic JSON document (BTreeMap-keyed, pretty-printed with 2-space
//! indent), then gzips it. `decompress` round-trips the bytes back to the JSON
//! string. `unified_diff` runs `similar::TextDiff::from_lines` for diff display.
//!
//! Determinism: every collection is keyed by name and sorted alphabetically so
//! two captures of identical schemas produce byte-identical output. We
//! deliberately omit anything user-data-bearing (sequence current values, row
//! counts, comments) — the snapshot is a structural record, not a backup.

#![allow(clippy::missing_errors_doc, clippy::missing_panics_doc)]

use std::collections::BTreeMap;
use std::io::{Read, Write};

use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;
use serde_json::{json, Value};
use tokio_postgres::Client;

use crate::migrations::types::MigrationsError;

fn map_pg(e: &tokio_postgres::Error) -> MigrationsError {
    MigrationsError::Postgres(e.to_string())
}

/// SQL — schemas (excluding catalogs / temp / toast namespaces).
const Q_SCHEMAS: &str = "\
SELECT schema_name AS name
FROM information_schema.schemata
WHERE schema_name NOT IN ('pg_catalog', 'information_schema')
  AND schema_name NOT LIKE 'pg_temp_%'
  AND schema_name NOT LIKE 'pg_toast%'
ORDER BY schema_name";

/// SQL — tables (relkind r/p), excluding partition children. Returns
/// (schema, name) pairs.
const Q_TABLES: &str = "\
SELECT n.nspname AS schema, c.relname AS name
FROM pg_class c
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname NOT LIKE 'pg_temp_%'
  AND n.nspname NOT LIKE 'pg_toast%'
  AND c.relkind IN ('r', 'p')
  AND NOT EXISTS (SELECT 1 FROM pg_inherits i WHERE i.inhrelid = c.oid)
ORDER BY n.nspname, c.relname";

/// SQL — columns across all user schemas. Sorted by ordinal so iteration order
/// is stable. We include name, formatted type, nullable, default expression.
const Q_COLUMNS: &str = "\
SELECT n.nspname     AS schema,
       c.relname     AS table,
       a.attname     AS name,
       format_type(a.atttypid, a.atttypmod) AS data_type,
       NOT a.attnotnull AS nullable,
       pg_get_expr(d.adbin, d.adrelid) AS default
FROM pg_class c
JOIN pg_namespace n ON c.relnamespace = n.oid
JOIN pg_attribute a ON a.attrelid = c.oid
LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname NOT LIKE 'pg_temp_%'
  AND n.nspname NOT LIKE 'pg_toast%'
  AND c.relkind IN ('r', 'p', 'v', 'm')
  AND a.attnum > 0 AND NOT a.attisdropped
ORDER BY n.nspname, c.relname, a.attnum";

/// SQL — indexes. We return `pg_get_indexdef` as the canonical definition.
const Q_INDEXES: &str = "\
SELECT n.nspname AS schema,
       t.relname AS table,
       ic.relname AS name,
       pg_get_indexdef(idx.indexrelid) AS definition
FROM pg_index idx
JOIN pg_class ic ON ic.oid = idx.indexrelid
JOIN pg_class t  ON t.oid  = idx.indrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname NOT LIKE 'pg_temp_%'
  AND n.nspname NOT LIKE 'pg_toast%'
ORDER BY n.nspname, t.relname, ic.relname";

/// SQL — foreign keys. Definition body via `pg_get_constraintdef`.
const Q_FOREIGN_KEYS: &str = "\
SELECT n.nspname AS schema,
       t.relname AS table,
       con.conname AS name,
       pg_get_constraintdef(con.oid) AS definition,
       rn.nspname AS referenced_schema,
       rc.relname AS referenced_table
FROM pg_constraint con
JOIN pg_class t  ON con.conrelid  = t.oid
JOIN pg_namespace n  ON n.oid  = t.relnamespace
JOIN pg_class rc ON con.confrelid = rc.oid
JOIN pg_namespace rn ON rn.oid = rc.relnamespace
WHERE con.contype = 'f'
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
ORDER BY n.nspname, t.relname, con.conname";

/// SQL — views (relkind v). Body via `pg_get_viewdef`.
const Q_VIEWS: &str = "\
SELECT n.nspname AS schema,
       c.relname AS name,
       pg_get_viewdef(c.oid, true) AS definition
FROM pg_class c
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND c.relkind = 'v'
ORDER BY n.nspname, c.relname";

/// Capture a deterministic gzipped JSON snapshot of the schema.
///
/// Covers: schemas, tables (with sorted columns), indexes, foreign keys,
/// views. Deliberately excludes user data and sequence current values — the
/// snapshot is a structural record, not a backup.
pub async fn capture(client: &Client) -> Result<Vec<u8>, MigrationsError> {
    // 1. Schemas (a list of names — kept simple, also stored under "schemas").
    let schemas_rows = client.query(Q_SCHEMAS, &[]).await.map_err(|e| map_pg(&e))?;
    let schemas: Vec<String> = schemas_rows
        .iter()
        .map(|r| r.get::<_, String>("name"))
        .collect();

    // 2. Tables — collected as BTreeMap<"schema.table", { columns: [] }>.
    // BTreeMap guarantees alphabetical ordering on serialization.
    let tables_rows = client.query(Q_TABLES, &[]).await.map_err(|e| map_pg(&e))?;
    let mut tables: BTreeMap<String, Value> = BTreeMap::new();
    for row in &tables_rows {
        let schema: String = row.get("schema");
        let name: String = row.get("name");
        tables.insert(            format!("{schema}.{name}"),
            json!({
                "schema": schema,
                "name": name,
                "columns": [],
            }),
);
    }

    // 3. Columns — attach to their owning table entry, in attnum order
    // (Q_COLUMNS already sorts).
    let cols_rows = client.query(Q_COLUMNS, &[]).await.map_err(|e| map_pg(&e))?;
    for row in &cols_rows {
        let schema: String = row.get("schema");
        let table: String = row.get("table");
        let key = format!("{schema}.{table}");
        let name: String = row.get("name");
        let data_type: String = row.get("data_type");
        let nullable: bool = row.get("nullable");
        let default: Option<String> = row.get("default");
        let col = json!({
            "name": name,
            "type": data_type,
            "nullable": nullable,
            "default": default,
        });
        // Only record columns that belong to a table we already captured.
        // Views' columns are intentionally excluded — view def body is the
        // canonical representation.
        if let Some(entry) = tables.get_mut(&key) {
            if let Some(cols) = entry.get_mut("columns").and_then(Value::as_array_mut) {
                cols.push(col);
            }
        }
    }

    // 4. Indexes.
    let idx_rows = client.query(Q_INDEXES, &[]).await.map_err(|e| map_pg(&e))?;
    let mut indexes: Vec<Value> = Vec::with_capacity(idx_rows.len());
    for row in &idx_rows {
        indexes.push(json!({
            "schema": row.get::<_, String>("schema"),
            "table": row.get::<_, String>("table"),
            "name": row.get::<_, String>("name"),
            "definition": row.get::<_, String>("definition"),
        }));
    }

    // 5. Foreign keys.
    let fk_rows = client
        .query(Q_FOREIGN_KEYS, &[])
        .await
        .map_err(|e| map_pg(&e))?;
    let mut foreign_keys: Vec<Value> = Vec::with_capacity(fk_rows.len());
    for row in &fk_rows {
        foreign_keys.push(json!({
            "schema": row.get::<_, String>("schema"),
            "table": row.get::<_, String>("table"),
            "name": row.get::<_, String>("name"),
            "definition": row.get::<_, String>("definition"),
            "referencedSchema": row.get::<_, String>("referenced_schema"),
            "referencedTable": row.get::<_, String>("referenced_table"),
        }));
    }

    // 6. Views.
    let view_rows = client.query(Q_VIEWS, &[]).await.map_err(|e| map_pg(&e))?;
    let mut views: Vec<Value> = Vec::with_capacity(view_rows.len());
    for row in &view_rows {
        views.push(json!({
            "schema": row.get::<_, String>("schema"),
            "name": row.get::<_, String>("name"),
            "definition": row.get::<_, String>("definition"),
        }));
    }

    // Top-level uses BTreeMap so keys are sorted alphabetically on output.
    let mut top: BTreeMap<&str, Value> = BTreeMap::new();
    top.insert("schemas", json!(schemas));
    top.insert("tables", json!(tables));
    top.insert("indexes", json!(indexes));
    top.insert("foreignKeys", json!(foreign_keys));
    top.insert("views", json!(views));

    let json_str = serde_json::to_string_pretty(&top)
        .map_err(|e| MigrationsError::Storage(format!("snapshot serialize: {e}")))?;

    // Gzip with default compression. Using `Compression::default()` so the same
    // bytes shape over time (tunable later if size becomes a concern).
    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder
        .write_all(json_str.as_bytes())
        .map_err(|e| MigrationsError::Io(e.to_string()))?;
    encoder
        .finish()
        .map_err(|e| MigrationsError::Io(e.to_string()))
}

/// Decompress a gzipped JSON snapshot back into its UTF-8 string form.
pub fn decompress(gz: &[u8]) -> Result<String, MigrationsError> {
    let mut decoder = GzDecoder::new(gz);
    let mut out = String::new();
    decoder
        .read_to_string(&mut out)
        .map_err(|e| MigrationsError::Io(e.to_string()))?;
    Ok(out)
}

/// Build a unified-diff string between two text snapshots. Used by
/// `migrations_diff_snapshots` to render a Monaco diff. Returns an empty
/// string when the inputs are identical (no `@@` hunks emitted).
#[must_use]
pub fn unified_diff(left: &str, right: &str) -> String {
    similar::TextDiff::from_lines(left, right)
        .unified_diff()
        .context_radius(3)
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use testcontainers::core::ImageExt;
    use testcontainers::runners::AsyncRunner;
    use testcontainers_modules::postgres::Postgres;
    use tokio_postgres::NoTls;

    async fn connect_pg() -> Option<(testcontainers::ContainerAsync<Postgres>, Client)> {
        let container = match Postgres::default().with_tag("17-alpine").start().await {
            Ok(c) => c,
            Err(err) => {
                eprintln!("skipping snapshot test: docker unavailable ({err})");
                return None;
            }
        };
        let host_port = container.get_host_port_ipv4(5432).await.expect("host port");
        let conn_str = format!(            "host=127.0.0.1 port={host_port} user=postgres password=postgres dbname=postgres"
);
        let (client, connection) = tokio_postgres::connect(&conn_str, NoTls)
            .await
            .expect("connect tc pg");
        tokio::spawn(async move {
            let _ = connection.await;
        });
        Some((container, client))
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn round_trip_introspect_gzip_gunzip() {
        let Some((_container, client)) = connect_pg().await else {
            return;
        };
        client
            .batch_execute(                "CREATE TABLE public.users (\
                    id   serial PRIMARY KEY, \
                    name text   NOT NULL, \
                    bio  text \
); \
                 CREATE INDEX users_name_idx ON public.users(name);",
)
            .await
            .expect("seed schema");

        let gz = capture(&client).await.expect("capture");
        assert!(!gz.is_empty(), "gzip output should be non-empty");

        let json_str = decompress(&gz).expect("decompress");
        // Parses as JSON.
        let parsed: serde_json::Value = serde_json::from_str(&json_str).expect("parse json");

        // Includes the public schema.
        let schemas = parsed
            .get("schemas")
            .and_then(|v| v.as_array())
            .expect("schemas array");
        assert!(            schemas.iter().any(|s| s.as_str() == Some("public")),
            "expected schemas[] to contain 'public', got: {schemas:?}",
);

        // Includes the users table with its columns.
        let tables = parsed
            .get("tables")
            .and_then(|v| v.as_object())
            .expect("tables object");
        let users = tables.get("public.users").expect("public.users present");
        let cols = users
            .get("columns")
            .and_then(|v| v.as_array())
            .expect("columns array");
        assert_eq!(cols.len(), 3, "expected 3 columns on users, got {cols:?}");

        // Includes the index.
        let indexes = parsed
            .get("indexes")
            .and_then(|v| v.as_array())
            .expect("indexes array");
        assert!(            indexes
                .iter()
                .any(|i| i.get("name").and_then(|v| v.as_str()) == Some("users_name_idx")),
            "expected users_name_idx in indexes",
);
    }

    #[test]
    fn unified_diff_emits_diff_format() {
        let d = unified_diff("a\nb\nc\n", "a\nx\nc\n");
        // Unified diffs include a `-old` and `+new` line for the changed line.
        assert!(d.contains("-b"), "expected '-b' in diff, got:\n{d}");
        assert!(d.contains("+x"), "expected '+x' in diff, got:\n{d}");
    }

    #[test]
    fn unified_diff_identical_returns_empty_string() {
        let d = unified_diff("a\nb\nc\n", "a\nb\nc\n");
        assert!(            d.is_empty(),
            "expected empty diff for identical input, got:\n{d}",
);
    }
}
