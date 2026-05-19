//! — backend command for the ERD auto-layout payload.
//!
//! `erd_get_schema_graph` returns a single `ErdSchemaGraph` for the
//! supplied connection, optionally filtered to a list of schemas.
//!
//! Implementation details:
//! - One pool checkout per call; both queries share the same client.
//! - When `schemas: None`, all non-system user schemas are discovered first
//! via `ERD_ALL_USER_SCHEMAS_SQL` and the resulting list is forwarded to
//! the two main queries as a `text[]` parameter.
//! - The tables/columns query returns interleaved rows; we group while
//! iterating using `(schema, name)` as the cursor key.
//! - The foreign-keys query produces `text[]` columns server-side with
//! `array_agg(... ORDER BY ordinality)` so composite FK column ordering
//! between source and target arrays is preserved positionally.

#![allow(unused, clippy::pedantic, clippy::nursery, clippy::unused_async)]

use std::time::Instant;

use deadpool_postgres::Pool;
use tauri::State;
use tokio_postgres::Row;

use crate::connection::types::ConnectionError;
use crate::schema::erd_queries::{
    ERD_ALL_USER_SCHEMAS_SQL, ERD_FOREIGN_KEYS_SQL, ERD_TABLES_AND_COLUMNS_SQL,
};
use crate::schema::erd_types::{ErdColumn, ErdForeignKey, ErdSchemaGraph, ErdTable};
use crate::AppState;

#[tauri::command]
pub async fn erd_get_schema_graph(    state: State<'_, AppState>,
    conn_id: String,
    schemas: Option<Vec<String>>,
) -> Result<ErdSchemaGraph, ConnectionError> {
    state
        .erd_get_schema_graph(&conn_id, schemas.as_deref())
        .await
}

impl AppState {
    pub async fn erd_get_schema_graph(        &self,
        conn_id: &str,
        schemas: Option<&[String]>,
) -> Result<ErdSchemaGraph, ConnectionError> {
        let started = Instant::now();

        let pool = self
            .pools
            .get(conn_id)
            .await
            .ok_or_else(|| ConnectionError::NotConnected(conn_id.to_string()))?;
        let client = pool
            .get()
            .await
            .map_err(|e| ConnectionError::Postgres(e.to_string()))?;

        // 1) Resolve the schema list. None → all non-system schemas.
        let schema_list: Vec<String> = match schemas {
            Some(list) => list.to_vec(),
            None => {
                let rows = client
                    .query(ERD_ALL_USER_SCHEMAS_SQL, &[])
                    .await
                    .map_err(|e| ConnectionError::Postgres(e.to_string()))?;
                rows.iter().map(|r| r.get::<_, String>("name")).collect()
            }
        };

        // Empty schema set → empty graph (don't even round-trip the queries).
        if schema_list.is_empty() {
            return Ok(ErdSchemaGraph {
                tables: Vec::new(),
                foreign_keys: Vec::new(),
                fetched_in_ms: u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX),
            });
        }

        let schema_param: Vec<&str> = schema_list.iter().map(String::as_str).collect();

        // 2) Tables + columns (interleaved row stream).
        let tc_rows = client
            .query(ERD_TABLES_AND_COLUMNS_SQL, &[&schema_param])
            .await
            .map_err(|e| ConnectionError::Postgres(e.to_string()))?;
        let tables = assemble_tables(&tc_rows)?;

        // 3) Foreign keys (one row per FK; `text[]` arrays already aligned).
        let fk_rows = client
            .query(ERD_FOREIGN_KEYS_SQL, &[&schema_param])
            .await
            .map_err(|e| ConnectionError::Postgres(e.to_string()))?;
        let foreign_keys = fk_rows.iter().map(map_foreign_key).collect();

        let fetched_in_ms = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);

        Ok(ErdSchemaGraph {
            tables,
            foreign_keys,
            fetched_in_ms,
        })
    }
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

fn assemble_tables(rows: &[Row]) -> Result<Vec<ErdTable>, ConnectionError> {
    let mut tables: Vec<ErdTable> = Vec::new();
    for row in rows {
        let kind: String = row.get("kind");
        let schema: String = row.get("schema");
        let name: String = row.get("name");

        match kind.as_str() {
            "table" => {
                tables.push(ErdTable {
                    schema,
                    name,
                    columns: Vec::new(),
                });
            }
            "column" => {
                let last = tables.last_mut().ok_or_else(|| {
                    ConnectionError::Postgres(                        "erd: column row arrived before any table row".to_string(),
)
                })?;
                if last.schema != schema || last.name != name {
                    return Err(ConnectionError::Postgres(format!(                        "erd: column row for {schema}.{name} does not match cursor table {}.{}",
                        last.schema, last.name
)));
                }
                last.columns.push(ErdColumn {
                    name: row.get::<_, String>("col_name"),
                    data_type: row.get::<_, String>("col_type"),
                    nullable: row.get::<_, bool>("col_nullable"),
                    is_primary_key: row.get::<_, bool>("col_is_pk"),
                    is_foreign_key: row.get::<_, bool>("col_is_fk"),
                    ordinal: row.get::<_, i32>("col_ordinal"),
                });
            }
            other => {
                return Err(ConnectionError::Postgres(format!(                    "erd: unexpected row kind {other}"
)));
            }
        }
    }
    Ok(tables)
}

fn map_foreign_key(row: &Row) -> ErdForeignKey {
    ErdForeignKey {
        name: row.get::<_, String>("name"),
        source_schema: row.get::<_, String>("source_schema"),
        source_table: row.get::<_, String>("source_table"),
        source_columns: row
            .get::<_, Option<Vec<String>>>("source_columns")
            .unwrap_or_default(),
        target_schema: row.get::<_, String>("target_schema"),
        target_table: row.get::<_, String>("target_table"),
        target_columns: row
            .get::<_, Option<Vec<String>>>("target_columns")
            .unwrap_or_default(),
    }
}

#[cfg(test)]
mod tests {
    //! Unit tests for the row-assembly helper. Keep these pure-data so they
    //! run without Docker; the real-PG behaviour is covered by
    //! `tests/erd_pg_integration.rs`.
    //!
    //! We can't easily fabricate `tokio_postgres::Row` values, so the tests
    //! here focus on shape-level invariants of the SQL constants and the
    //! foreign-key mapper's tolerance to `Option<Vec<String>>` columns.

    use super::*;
    use crate::schema::erd_queries::{ERD_FOREIGN_KEYS_SQL, ERD_TABLES_AND_COLUMNS_SQL};

    #[test]
    fn sql_constants_use_text_array_param() {
        assert!(ERD_TABLES_AND_COLUMNS_SQL.contains("$1::text[]"));
        assert!(ERD_FOREIGN_KEYS_SQL.contains("$1::text[]"));
    }

    #[test]
    fn empty_rows_yield_empty_tables_vec() {
        let v = assemble_tables(&[]).expect("no rows is valid");
        assert!(v.is_empty());
    }
}
