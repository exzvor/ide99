//! Schema-introspection Tauri commands.
//!
//! Each command:
//! 1. Looks up the live pool for `conn_id` in `state.pools` —
//! returns `ConnectionError::NotConnected(id)` if absent.
//! 2. Acquires a client from the pool.
//! 3. Runs the corresponding parameterized SQL from `super::queries`.
//! 4. Maps result rows into the matching DTO.
//!
//! Inherent helpers on `AppState` mirror the Tauri commands so the integration
//! test and the criterion bench can drive them without spinning up Tauri.

#![allow(unused, clippy::pedantic, clippy::nursery, clippy::unused_async)]

use deadpool_postgres::Pool;
use tauri::State;
use tokio_postgres::Row;

use crate::connection::types::ConnectionError;
use crate::schema::queries::{
    AUTOCOMPLETE_SNAPSHOT_SQL, CURRENT_USER_SQL, LIST_COLUMNS_SQL, LIST_FOREIGN_KEYS_SQL,
    LIST_INDEXES_SQL, LIST_SCHEMAS_SQL, LIST_TABLES_SQL, LIST_VIEWS_SQL, SHOW_SEARCH_PATH_SQL,
};
use crate::schema::types::{
    AutocompleteColumn, AutocompleteRelKind, AutocompleteRelation, AutocompleteSnapshot,
    ColumnInfo, ForeignKeyInfo, IndexInfo, SchemaInfo, TableInfo, ViewInfo,
};
use crate::AppState;

// ---------------------------------------------------------------------------
// Tauri command handlers — thin wrappers over inherent helpers.
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn schema_list_schemas(    state: State<'_, AppState>,
    conn_id: String,
) -> Result<Vec<SchemaInfo>, ConnectionError> {
    state.schema_list_schemas(&conn_id).await
}

#[tauri::command]
pub async fn schema_list_tables(    state: State<'_, AppState>,
    conn_id: String,
    schema: String,
) -> Result<Vec<TableInfo>, ConnectionError> {
    state.schema_list_tables(&conn_id, &schema).await
}

#[tauri::command]
pub async fn schema_list_views(    state: State<'_, AppState>,
    conn_id: String,
    schema: String,
) -> Result<Vec<ViewInfo>, ConnectionError> {
    state.schema_list_views(&conn_id, &schema).await
}

#[tauri::command]
pub async fn schema_list_columns(    state: State<'_, AppState>,
    conn_id: String,
    schema: String,
    table: String,
) -> Result<Vec<ColumnInfo>, ConnectionError> {
    state.schema_list_columns(&conn_id, &schema, &table).await
}

#[tauri::command]
pub async fn schema_list_indexes(    state: State<'_, AppState>,
    conn_id: String,
    schema: String,
    table: String,
) -> Result<Vec<IndexInfo>, ConnectionError> {
    state.schema_list_indexes(&conn_id, &schema, &table).await
}

#[tauri::command]
pub async fn schema_list_foreign_keys(    state: State<'_, AppState>,
    conn_id: String,
    schema: String,
    table: String,
) -> Result<Vec<ForeignKeyInfo>, ConnectionError> {
    state
        .schema_list_foreign_keys(&conn_id, &schema, &table)
        .await
}

#[tauri::command]
pub async fn schema_get_autocomplete_snapshot(    state: State<'_, AppState>,
    conn_id: String,
) -> Result<AutocompleteSnapshot, ConnectionError> {
    state.schema_get_autocomplete_snapshot(&conn_id).await
}

// ---------------------------------------------------------------------------
// — full-detail introspection commands for object editors.
// wires command stubs that delegate to `schema::introspect::*`. The
// inner functions are `unimplemented!()` placeholders until Phase B1.
// ---------------------------------------------------------------------------

use crate::schema::introspect::{self as introspect_mod, IntrospectError};
use crate::schema::types::{
    IndexDefinition, MatviewDefinition, MatviewSummary, SequenceDefinition, SequenceSummary,
    TableDefinition, ViewDefinition,
};

async fn require_pool_introspect(    state: &State<'_, AppState>,
    conn_id: &str,
) -> Result<Pool, IntrospectError> {
    state
        .pools
        .get(conn_id)
        .await
        .ok_or_else(|| IntrospectError::NotConnected(conn_id.to_string()))
}

#[tauri::command]
pub async fn schema_get_table_definition(    state: State<'_, AppState>,
    conn_id: String,
    schema: String,
    table: String,
) -> Result<TableDefinition, IntrospectError> {
    let pool = require_pool_introspect(&state, &conn_id).await?;
    introspect_mod::get_table_definition(&pool, &schema, &table).await
}

#[tauri::command]
pub async fn schema_get_view_definition(    state: State<'_, AppState>,
    conn_id: String,
    schema: String,
    view: String,
) -> Result<ViewDefinition, IntrospectError> {
    let pool = require_pool_introspect(&state, &conn_id).await?;
    introspect_mod::get_view_definition(&pool, &schema, &view).await
}

#[tauri::command]
pub async fn schema_get_matview_definition(    state: State<'_, AppState>,
    conn_id: String,
    schema: String,
    matview: String,
) -> Result<MatviewDefinition, IntrospectError> {
    let pool = require_pool_introspect(&state, &conn_id).await?;
    introspect_mod::get_matview_definition(&pool, &schema, &matview).await
}

#[tauri::command]
pub async fn schema_get_index_definition(    state: State<'_, AppState>,
    conn_id: String,
    schema: String,
    index: String,
) -> Result<IndexDefinition, IntrospectError> {
    let pool = require_pool_introspect(&state, &conn_id).await?;
    introspect_mod::get_index_definition(&pool, &schema, &index).await
}

#[tauri::command]
pub async fn schema_get_sequence_definition(    state: State<'_, AppState>,
    conn_id: String,
    schema: String,
    sequence: String,
) -> Result<SequenceDefinition, IntrospectError> {
    let pool = require_pool_introspect(&state, &conn_id).await?;
    introspect_mod::get_sequence_definition(&pool, &schema, &sequence).await
}

#[tauri::command]
pub async fn schema_list_matviews(    state: State<'_, AppState>,
    conn_id: String,
    schema: String,
) -> Result<Vec<MatviewSummary>, IntrospectError> {
    let pool = require_pool_introspect(&state, &conn_id).await?;
    introspect_mod::list_matviews(&pool, &schema).await
}

#[tauri::command]
pub async fn schema_list_sequences(    state: State<'_, AppState>,
    conn_id: String,
    schema: String,
) -> Result<Vec<SequenceSummary>, IntrospectError> {
    let pool = require_pool_introspect(&state, &conn_id).await?;
    introspect_mod::list_sequences(&pool, &schema).await
}

// ---------------------------------------------------------------------------
// — function / procedure / trigger introspection commands.
// ---------------------------------------------------------------------------

use crate::schema::types::{
    FunctionDefinition, FunctionSummary, ProcedureDefinition, ProcedureSummary, TriggerDefinition,
    TriggerSummary,
};

#[tauri::command]
pub async fn schema_get_function_definition(    state: State<'_, AppState>,
    conn_id: String,
    schema: String,
    fn_name: String,
    fn_args: String,
) -> Result<FunctionDefinition, IntrospectError> {
    let pool = require_pool_introspect(&state, &conn_id).await?;
    introspect_mod::get_function_definition(&pool, &schema, &fn_name, &fn_args).await
}

#[tauri::command]
pub async fn schema_get_procedure_definition(    state: State<'_, AppState>,
    conn_id: String,
    schema: String,
    proc_name: String,
    proc_args: String,
) -> Result<ProcedureDefinition, IntrospectError> {
    let pool = require_pool_introspect(&state, &conn_id).await?;
    introspect_mod::get_procedure_definition(&pool, &schema, &proc_name, &proc_args).await
}

#[tauri::command]
pub async fn schema_get_trigger_definition(    state: State<'_, AppState>,
    conn_id: String,
    schema: String,
    table: String,
    trigger_name: String,
) -> Result<TriggerDefinition, IntrospectError> {
    let pool = require_pool_introspect(&state, &conn_id).await?;
    introspect_mod::get_trigger_definition(&pool, &schema, &table, &trigger_name).await
}

#[tauri::command]
pub async fn schema_list_functions(    state: State<'_, AppState>,
    conn_id: String,
    schema: String,
    trigger_only: bool,
) -> Result<Vec<FunctionSummary>, IntrospectError> {
    let pool = require_pool_introspect(&state, &conn_id).await?;
    introspect_mod::list_functions(&pool, &schema, trigger_only).await
}

#[tauri::command]
pub async fn schema_list_procedures(    state: State<'_, AppState>,
    conn_id: String,
    schema: String,
) -> Result<Vec<ProcedureSummary>, IntrospectError> {
    let pool = require_pool_introspect(&state, &conn_id).await?;
    introspect_mod::list_procedures(&pool, &schema).await
}

#[tauri::command]
pub async fn schema_list_triggers(    state: State<'_, AppState>,
    conn_id: String,
    schema: String,
    table: Option<String>,
) -> Result<Vec<TriggerSummary>, IntrospectError> {
    let pool = require_pool_introspect(&state, &conn_id).await?;
    introspect_mod::list_triggers(&pool, &schema, table.as_deref()).await
}

// ---------------------------------------------------------------------------
// — FDW / Publication / Subscription / Role / Custom Type commands.
// ---------------------------------------------------------------------------

use crate::schema::types::{
    CustomTypeDefinition, FdwServerDefinition, PublicationDefinition, PublicationSummary,
    QualifiedName, RoleDefinition, RoleSummary, SubscriptionDefinition,
};

#[tauri::command]
pub async fn schema_get_fdw_server_definition(    state: State<'_, AppState>,
    conn_id: String,
    server_name: String,
) -> Result<FdwServerDefinition, IntrospectError> {
    let pool = require_pool_introspect(&state, &conn_id).await?;
    introspect_mod::get_fdw_server_definition(&pool, &server_name).await
}

#[tauri::command]
pub async fn schema_get_publication_definition(    state: State<'_, AppState>,
    conn_id: String,
    pub_name: String,
) -> Result<PublicationDefinition, IntrospectError> {
    let pool = require_pool_introspect(&state, &conn_id).await?;
    introspect_mod::get_publication_definition(&pool, &pub_name).await
}

#[tauri::command]
pub async fn schema_get_subscription_definition(    state: State<'_, AppState>,
    conn_id: String,
    sub_name: String,
) -> Result<SubscriptionDefinition, IntrospectError> {
    let pool = require_pool_introspect(&state, &conn_id).await?;
    introspect_mod::get_subscription_definition(&pool, &sub_name).await
}

#[tauri::command]
pub async fn schema_get_role_definition(    state: State<'_, AppState>,
    conn_id: String,
    role_name: String,
) -> Result<RoleDefinition, IntrospectError> {
    let pool = require_pool_introspect(&state, &conn_id).await?;
    introspect_mod::get_role_definition(&pool, &role_name).await
}

#[tauri::command]
pub async fn schema_get_custom_type_definition(    state: State<'_, AppState>,
    conn_id: String,
    schema: String,
    name: String,
) -> Result<CustomTypeDefinition, IntrospectError> {
    let pool = require_pool_introspect(&state, &conn_id).await?;
    introspect_mod::get_custom_type_definition(&pool, &schema, &name).await
}

#[tauri::command]
pub async fn schema_list_publishable_tables(    state: State<'_, AppState>,
    conn_id: String,
) -> Result<Vec<QualifiedName>, IntrospectError> {
    let pool = require_pool_introspect(&state, &conn_id).await?;
    introspect_mod::list_publishable_tables(&pool).await
}

#[tauri::command]
pub async fn schema_list_publications(    state: State<'_, AppState>,
    conn_id: String,
) -> Result<Vec<PublicationSummary>, IntrospectError> {
    let pool = require_pool_introspect(&state, &conn_id).await?;
    introspect_mod::list_publications(&pool).await
}

#[tauri::command]
pub async fn schema_list_collations(    state: State<'_, AppState>,
    conn_id: String,
) -> Result<Vec<String>, IntrospectError> {
    let pool = require_pool_introspect(&state, &conn_id).await?;
    introspect_mod::list_collations(&pool).await
}

#[tauri::command]
pub async fn schema_list_roles(    state: State<'_, AppState>,
    conn_id: String,
) -> Result<Vec<RoleSummary>, IntrospectError> {
    let pool = require_pool_introspect(&state, &conn_id).await?;
    introspect_mod::list_roles(&pool).await
}

// ---------------------------------------------------------------------------
// Inherent helpers — exercised directly by integration tests + criterion bench
// without depending on the Tauri runtime.
// ---------------------------------------------------------------------------

impl AppState {
    pub async fn schema_list_schemas(        &self,
        conn_id: &str,
) -> Result<Vec<SchemaInfo>, ConnectionError> {
        let pool = require_pool(self, conn_id).await?;
        let client = pool
            .get()
            .await
            .map_err(|e| ConnectionError::Postgres(e.to_string()))?;
        let rows = client
            .query(LIST_SCHEMAS_SQL, &[])
            .await
            .map_err(|e| ConnectionError::Postgres(e.to_string()))?;
        Ok(rows.iter().map(map_schema).collect())
    }

    pub async fn schema_list_tables(        &self,
        conn_id: &str,
        schema: &str,
) -> Result<Vec<TableInfo>, ConnectionError> {
        let pool = require_pool(self, conn_id).await?;
        let client = pool
            .get()
            .await
            .map_err(|e| ConnectionError::Postgres(e.to_string()))?;
        let rows = client
            .query(LIST_TABLES_SQL, &[&schema])
            .await
            .map_err(|e| ConnectionError::Postgres(e.to_string()))?;
        Ok(rows.iter().map(map_table).collect())
    }

    pub async fn schema_list_views(        &self,
        conn_id: &str,
        schema: &str,
) -> Result<Vec<ViewInfo>, ConnectionError> {
        let pool = require_pool(self, conn_id).await?;
        let client = pool
            .get()
            .await
            .map_err(|e| ConnectionError::Postgres(e.to_string()))?;
        let rows = client
            .query(LIST_VIEWS_SQL, &[&schema])
            .await
            .map_err(|e| ConnectionError::Postgres(e.to_string()))?;
        Ok(rows.iter().map(map_view).collect())
    }

    pub async fn schema_list_columns(        &self,
        conn_id: &str,
        schema: &str,
        table: &str,
) -> Result<Vec<ColumnInfo>, ConnectionError> {
        let pool = require_pool(self, conn_id).await?;
        let client = pool
            .get()
            .await
            .map_err(|e| ConnectionError::Postgres(e.to_string()))?;
        let rows = client
            .query(LIST_COLUMNS_SQL, &[&schema, &table])
            .await
            .map_err(|e| ConnectionError::Postgres(e.to_string()))?;
        Ok(rows.iter().map(map_column).collect())
    }

    pub async fn schema_list_indexes(        &self,
        conn_id: &str,
        schema: &str,
        table: &str,
) -> Result<Vec<IndexInfo>, ConnectionError> {
        let pool = require_pool(self, conn_id).await?;
        let client = pool
            .get()
            .await
            .map_err(|e| ConnectionError::Postgres(e.to_string()))?;
        let rows = client
            .query(LIST_INDEXES_SQL, &[&schema, &table])
            .await
            .map_err(|e| ConnectionError::Postgres(e.to_string()))?;
        Ok(rows.iter().map(map_index).collect())
    }

    pub async fn schema_list_foreign_keys(        &self,
        conn_id: &str,
        schema: &str,
        table: &str,
) -> Result<Vec<ForeignKeyInfo>, ConnectionError> {
        let pool = require_pool(self, conn_id).await?;
        let client = pool
            .get()
            .await
            .map_err(|e| ConnectionError::Postgres(e.to_string()))?;
        let rows = client
            .query(LIST_FOREIGN_KEYS_SQL, &[&schema, &table])
            .await
            .map_err(|e| ConnectionError::Postgres(e.to_string()))?;
        Ok(rows.iter().map(map_foreign_key).collect())
    }

    pub async fn schema_get_autocomplete_snapshot(        &self,
        conn_id: &str,
) -> Result<AutocompleteSnapshot, ConnectionError> {
        let pool = require_pool(self, conn_id).await?;
        let client = pool
            .get()
            .await
            .map_err(|e| ConnectionError::Postgres(e.to_string()))?;

        // 1) current_user (so we can substitute `$user` later).
        let current_user: String = client
            .query_one(CURRENT_USER_SQL, &[])
            .await
            .map_err(|e| ConnectionError::Postgres(e.to_string()))?
            .get(0);

        // 2) SHOW search_path → split, trim, substitute "$user", drop empties, dedupe.
        let raw_path: String = client
            .query_one(SHOW_SEARCH_PATH_SQL, &[])
            .await
            .map_err(|e| ConnectionError::Postgres(e.to_string()))?
            .get(0);
        let resolved_path = resolve_search_path(&raw_path, &current_user);

        // 3) snapshot query.
        let path_array: Vec<&str> = resolved_path.iter().map(String::as_str).collect();
        let rows = client
            .query(AUTOCOMPLETE_SNAPSHOT_SQL, &[&path_array])
            .await
            .map_err(|e| ConnectionError::Postgres(e.to_string()))?;

        let mut relations: Vec<AutocompleteRelation> = Vec::new();
        for row in &rows {
            let kind: String = row.get("kind");
            let schema: String = row.get("schema");
            let name: String = row.get("name");
            if kind == "rel" {
                let rel_kind_str: String = row.get("rel_kind");
                let rel_kind = match rel_kind_str.as_str() {
                    "table" => AutocompleteRelKind::Table,
                    "view" => AutocompleteRelKind::View,
                    "matview" => AutocompleteRelKind::Matview,
                    other => {
                        return Err(ConnectionError::Postgres(format!(                            "unexpected relkind {other}"
)));
                    }
                };
                relations.push(AutocompleteRelation {
                    schema,
                    name,
                    kind: rel_kind,
                    columns: Vec::new(),
                });
            } else {
                let col_name: String = row.get("col_name");
                let col_type: String = row.get("col_type");
                let nullable: bool = row.get("col_nullable");
                let is_jsonb: bool = row.get("col_is_jsonb");
                let last = relations.last_mut().ok_or_else(|| {
                    ConnectionError::Postgres(                        "snapshot column row arrived before any relation row".to_string(),
)
                })?;
                debug_assert_eq!(last.schema, schema);
                debug_assert_eq!(last.name, name);
                last.columns.push(AutocompleteColumn {
                    name: col_name,
                    data_type: col_type,
                    nullable,
                    is_jsonb,
                });
            }
        }

        let loaded_at = chrono::Utc::now().timestamp_millis();
        Ok(AutocompleteSnapshot {
            conn_id: conn_id.to_string(),
            search_path: resolved_path,
            relations,
            loaded_at,
        })
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async fn require_pool(state: &AppState, conn_id: &str) -> Result<Pool, ConnectionError> {
    state
        .pools
        .get(conn_id)
        .await
        .ok_or_else(|| ConnectionError::NotConnected(conn_id.to_string()))
}

fn map_schema(row: &Row) -> SchemaInfo {
    SchemaInfo {
        name: row.get::<_, String>("name"),
        owner: row.get::<_, Option<String>>("owner"),
    }
}

fn map_table(row: &Row) -> TableInfo {
    TableInfo {
        name: row.get::<_, String>("name"),
        comment: row.get::<_, Option<String>>("comment"),
    }
}

fn map_view(row: &Row) -> ViewInfo {
    ViewInfo {
        name: row.get::<_, String>("name"),
        definition: row
            .get::<_, Option<String>>("definition")
            .unwrap_or_default(),
        comment: row.get::<_, Option<String>>("comment"),
    }
}

fn map_column(row: &Row) -> ColumnInfo {
    ColumnInfo {
        name: row.get::<_, String>("name"),
        data_type: row.get::<_, String>("data_type"),
        nullable: row.get::<_, bool>("nullable"),
        default: row.get::<_, Option<String>>("default"),
        comment: row.get::<_, Option<String>>("comment"),
        ordinal: i32::from(row.get::<_, i16>("ordinal")),
    }
}

fn map_index(row: &Row) -> IndexInfo {
    IndexInfo {
        name: row.get::<_, String>("name"),
        method: row.get::<_, String>("method"),
        is_unique: row.get::<_, bool>("is_unique"),
        is_primary: row.get::<_, bool>("is_primary"),
        definition: row.get::<_, String>("definition"),
    }
}

fn map_foreign_key(row: &Row) -> ForeignKeyInfo {
    ForeignKeyInfo {
        name: row.get::<_, String>("name"),
        definition: row.get::<_, String>("definition"),
        referenced_schema: row.get::<_, String>("referenced_schema"),
        referenced_table: row.get::<_, String>("referenced_table"),
    }
}

/// Splits a raw `SHOW search_path` value (`"$user", public, app`) into a clean
/// schema list. Substitutes `$user` (with or without quotes) using `current_user`,
/// strips empty entries, trims whitespace, deduplicates while preserving order.
pub(crate) fn resolve_search_path(raw: &str, current_user: &str) -> Vec<String> {
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut out: Vec<String> = Vec::new();
    for part in raw.split(',') {
        let trimmed = part.trim().trim_matches('"');
        let resolved = if trimmed == "$user" {
            current_user.to_string()
        } else {
            trimmed.to_string()
        };
        if resolved.is_empty() {
            continue;
        }
        if seen.insert(resolved.clone()) {
            out.push(resolved);
        }
    }
    out
}

#[cfg(test)]
mod search_path_tests {
    use super::resolve_search_path;

    #[test]
    fn substitutes_dollar_user() {
        let v = resolve_search_path("\"$user\", public", "alice");
        assert_eq!(v, vec!["alice".to_string(), "public".to_string()]);
    }

    #[test]
    fn strips_quotes_and_dedupes() {
        let v = resolve_search_path("public, \"public\", app", "bob");
        assert_eq!(v, vec!["public".to_string(), "app".to_string()]);
    }

    #[test]
    fn preserves_order() {
        let v = resolve_search_path("app, public", "bob");
        assert_eq!(v, vec!["app".to_string(), "public".to_string()]);
    }

    #[test]
    fn drops_empty() {
        let v = resolve_search_path(" , public", "bob");
        assert_eq!(v, vec!["public".to_string()]);
    }
}
