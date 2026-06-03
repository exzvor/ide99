//! — full-detail introspection for object editors.
//!
//! Each fetcher takes a `&Pool` and (`schema`, `name`) and returns a
//! domain DTO from `super::types`. SQL constants live in `super::queries`.
//! Errors propagate as `IntrospectError`, which the Tauri command layer
//! serializes for the frontend.

#![allow(
    clippy::missing_errors_doc,
    clippy::missing_panics_doc,
    clippy::similar_names,
    clippy::too_many_lines
)]

use std::collections::HashMap;

use deadpool_postgres::Pool;
use serde::Serialize;
use thiserror::Error;
use tokio_postgres::types::Oid;

use super::queries::{
    GET_FUNCTION_HEAD_SQL, GET_FUNCTION_HEAD_SQL_PRE11, GET_FUNCTION_PARAMS_SQL,
    GET_INDEX_DETAIL_SQL, GET_PROCEDURE_HEAD_SQL, GET_SEQUENCE_OWNED_BY_SQL, GET_SEQUENCE_SQL,
    GET_TABLE_COLUMNS_SQL, GET_TABLE_COLUMNS_SQL_PRE10, GET_TABLE_CONSTRAINTS_SQL,
    GET_TABLE_HEAD_SQL, GET_TABLE_HEAD_SQL_PRE10, GET_TABLE_INDEX_NAMES_SQL,
    GET_TRIGGER_DETAIL_SQL, GET_VIEW_LIKE_SQL, LIST_FUNCTIONS_SQL, LIST_FUNCTIONS_SQL_PRE11,
    LIST_MATVIEWS_SQL, LIST_PROCEDURES_SQL, LIST_SEQUENCES_SQL, LIST_SEQUENCES_SQL_PRE10,
    LIST_TRIGGERS_SQL, RESOLVE_ATTNAMES_SQL,
};
use super::tgtype_decode::decode_tgtype;
use super::types::{
    ColumnDefinition, ConstraintDefinition, FunctionDefinition, FunctionParameter, FunctionSummary,
    GeneratedColumn, IndexDefinition, MatviewDefinition, MatviewSummary, PartitionInfo,
    ProcedureDefinition, ProcedureSummary, SequenceDefinition, SequenceOwnedBy, SequenceSummary,
    TableDefinition, TriggerDefinition, ViewDefinition,
};

#[derive(Debug, Error, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum IntrospectError {
    #[error("not connected: {0}")]
    NotConnected(String),
    #[error("object not found: {schema}.{name}")]
    NotFound { schema: String, name: String },
    #[error("permission denied: {0}")]
    PermissionDenied(String),
    #[error("postgres error: {0}")]
    Postgres(String),
    #[error("internal: {0}")]
    Internal(String),
}

impl IntrospectError {
    fn pg<E: std::fmt::Display>(e: E) -> Self {
        Self::Postgres(e.to_string())
    }
    fn not_found(schema: &str, name: &str) -> Self {
        Self::NotFound {
            schema: schema.to_string(),
            name: name.to_string(),
        }
    }
}

/// PostgreSQL `server_version_num` thresholds for catalog-shape differences.
/// `pg_sequences`, `pg_partitioned_table`, identity columns → PG 10.
/// `prokind` (functions vs procedures vs aggregates) → PG 11.
const PG10: i64 = 100_000;
const PG11: i64 = 110_000;

/// Resolve `server_version_num` (e.g. 90624, 110000, 160000) for a client.
/// On any failure we assume a modern server (`i64::MAX`) so the default
/// (modern) query path is used — the legacy path is opt-in for old servers
/// such as PostgreSQL 9.6 (shipped by Astra Linux). Issue #14.
async fn server_version_num(client: &deadpool_postgres::Client) -> i64 {
    match client.query_one("SHOW server_version_num", &[]).await {
        Ok(row) => row
            .try_get::<_, String>(0)
            .ok()
            .and_then(|s| s.trim().parse().ok())
            .unwrap_or(i64::MAX),
        Err(_) => i64::MAX,
    }
}

/// Quote an identifier for safe interpolation into dynamic SQL (PG rules: wrap
/// in double quotes, double any embedded quote). Used only on the PG 9.x
/// sequence-detail path where the sequence relation must be read directly.
fn quote_ident(s: &str) -> String {
    format!("\"{}\"", s.replace('"', "\"\""))
}

/// Map a single-character partition strategy code to the canonical name.
fn partition_strategy_name(code: &str) -> &'static str {
    match code {
        "r" => "range",
        "l" => "list",
        "h" => "hash",
        _ => "unknown",
    }
}

/// Map a `pg_constraint.contype` discriminator to our public string kind.
fn contype_to_kind(c: &str) -> &'static str {
    match c {
        "p" => "pk",
        "u" => "unique",
        "f" => "fk",
        "c" => "check",
        _ => "unknown",
    }
}

/// Resolve `attnum` → column name for a list of attnums on a single relation.
/// Returns names in the order requested. Missing attnums are silently skipped
/// (this only happens if the catalog is in an unexpected state).
async fn resolve_attnames(
    client: &deadpool_postgres::Client,
    relid: Oid,
    attnums: &[i16],
) -> Result<Vec<String>, IntrospectError> {
    if attnums.is_empty() {
        return Ok(Vec::new());
    }
    let rows = client
        .query(RESOLVE_ATTNAMES_SQL, &[&relid, &attnums])
        .await
        .map_err(IntrospectError::pg)?;
    let map: HashMap<i16, String> = rows
        .iter()
        .map(|r| (r.get::<_, i16>("attnum"), r.get::<_, String>("name")))
        .collect();
    Ok(attnums.iter().filter_map(|n| map.get(n).cloned()).collect())
}

pub async fn get_table_definition(
    pool: &Pool,
    schema: &str,
    name: &str,
) -> Result<TableDefinition, IntrospectError> {
    let client = pool.get().await.map_err(IntrospectError::pg)?;
    // PG < 10 lacks pg_partitioned_table / identity / generated columns.
    let legacy = server_version_num(&client).await < PG10;

    // 1) Head row — fails fast with NotFound if no row.
    let head_rows = client
        .query(
            if legacy {
                GET_TABLE_HEAD_SQL_PRE10
            } else {
                GET_TABLE_HEAD_SQL
            },
            &[&schema, &name],
        )
        .await
        .map_err(IntrospectError::pg)?;
    let head = head_rows
        .first()
        .ok_or_else(|| IntrospectError::not_found(schema, name))?;
    let relid: Oid = head.get("oid");
    let rls_enabled: bool = head.get("rls_enabled");
    let comment: Option<String> = head.get("comment");
    let partition_strategy: Option<String> = head.get("partition_strategy");
    let partition_key: Option<String> = head.get("partition_key");
    let partition = match (partition_strategy.as_deref(), partition_key) {
        (Some(code), Some(key)) => Some(PartitionInfo {
            strategy: partition_strategy_name(code).to_string(),
            key,
        }),
        _ => None,
    };

    // 2) Columns.
    let col_rows = client
        .query(
            if legacy {
                GET_TABLE_COLUMNS_SQL_PRE10
            } else {
                GET_TABLE_COLUMNS_SQL
            },
            &[&schema, &name],
        )
        .await
        .map_err(IntrospectError::pg)?;
    let mut columns: Vec<ColumnDefinition> = Vec::with_capacity(col_rows.len());
    for r in &col_rows {
        let attgenerated: String = r.get("attgenerated");
        let default_expr: Option<String> = r.get("default");
        let generated = match attgenerated.as_str() {
            "s" => default_expr.clone().map(|expr| GeneratedColumn {
                kind: "stored".to_string(),
                expression: expr,
            }),
            "v" => default_expr.clone().map(|expr| GeneratedColumn {
                kind: "virtual".to_string(),
                expression: expr,
            }),
            _ => None,
        };
        // For generated columns, `pg_get_expr` returns the generation expression;
        // it must NOT be reported as a default.
        let default = if generated.is_some() {
            None
        } else {
            default_expr
        };
        columns.push(ColumnDefinition {
            name: r.get("name"),
            type_text: r.get("type_text"),
            nullable: r.get("nullable"),
            default,
            generated,
            comment: r.get("comment"),
            ordinal: i32::from(r.get::<_, i16>("ordinal")),
        });
    }

    // 3) Constraints. For FK, resolve referenced column names via attnums on
    // the referenced relation.
    let con_rows = client
        .query(GET_TABLE_CONSTRAINTS_SQL, &[&schema, &name])
        .await
        .map_err(IntrospectError::pg)?;
    let mut constraints: Vec<ConstraintDefinition> = Vec::with_capacity(con_rows.len());
    for r in &con_rows {
        let contype: String = r.get("contype");
        let kind = contype_to_kind(&contype).to_string();
        let conkey: Option<Vec<i16>> = r.get("conkey");
        let columns_list = match &conkey {
            Some(v) if !v.is_empty() => resolve_attnames(&client, relid, v).await?,
            _ => Vec::new(),
        };
        let confrelid: Oid = r.get("confrelid");
        let (ref_schema, ref_table, ref_columns) = if confrelid == 0 {
            (None, None, Vec::new())
        } else {
            let confkey: Option<Vec<i16>> = r.get("confkey");
            let names = match &confkey {
                Some(v) if !v.is_empty() => resolve_attnames(&client, confrelid, v).await?,
                _ => Vec::new(),
            };
            (
                r.get::<_, Option<String>>("ref_schema"),
                r.get::<_, Option<String>>("ref_table"),
                names,
            )
        };
        let definition: String = r.get("definition");
        // For CHECK constraints, the body inside parens is the expression. We
        // surface the full pg_get_constraintdef() text under both `definition`
        // and `expression` so the frontend can display either.
        let expression = if kind == "check" {
            Some(definition.clone())
        } else {
            None
        };
        constraints.push(ConstraintDefinition {
            name: r.get("name"),
            kind,
            definition,
            columns: columns_list,
            ref_schema,
            ref_table,
            ref_columns,
            expression,
        });
    }

    // 4) Indexes — fan out to `get_index_definition` per name.
    let idx_rows = client
        .query(GET_TABLE_INDEX_NAMES_SQL, &[&schema, &name])
        .await
        .map_err(IntrospectError::pg)?;
    let mut indexes: Vec<IndexDefinition> = Vec::with_capacity(idx_rows.len());
    for r in &idx_rows {
        let idx_name: String = r.get("name");
        let def = get_index_definition(pool, schema, &idx_name).await?;
        indexes.push(def);
    }

    Ok(TableDefinition {
        schema: schema.to_string(),
        name: name.to_string(),
        comment,
        columns,
        constraints,
        indexes,
        rls_enabled,
        partition,
    })
}

pub async fn get_view_definition(
    pool: &Pool,
    schema: &str,
    name: &str,
) -> Result<ViewDefinition, IntrospectError> {
    let client = pool.get().await.map_err(IntrospectError::pg)?;
    let rows = client
        .query(GET_VIEW_LIKE_SQL, &[&schema, &name])
        .await
        .map_err(IntrospectError::pg)?;
    let row = rows
        .iter()
        .find(|r| r.get::<_, String>("relkind") == "v")
        .ok_or_else(|| IntrospectError::not_found(schema, name))?;
    Ok(ViewDefinition {
        schema: schema.to_string(),
        name: name.to_string(),
        body: row.get::<_, Option<String>>("body").unwrap_or_default(),
        comment: row.get("comment"),
    })
}

pub async fn get_matview_definition(
    pool: &Pool,
    schema: &str,
    name: &str,
) -> Result<MatviewDefinition, IntrospectError> {
    let client = pool.get().await.map_err(IntrospectError::pg)?;
    let rows = client
        .query(GET_VIEW_LIKE_SQL, &[&schema, &name])
        .await
        .map_err(IntrospectError::pg)?;
    let row = rows
        .iter()
        .find(|r| r.get::<_, String>("relkind") == "m")
        .ok_or_else(|| IntrospectError::not_found(schema, name))?;
    Ok(MatviewDefinition {
        schema: schema.to_string(),
        name: name.to_string(),
        body: row.get::<_, Option<String>>("body").unwrap_or_default(),
        populated: row.get("populated"),
        comment: row.get("comment"),
    })
}

pub async fn get_index_definition(
    pool: &Pool,
    schema: &str,
    name: &str,
) -> Result<IndexDefinition, IntrospectError> {
    let client = pool.get().await.map_err(IntrospectError::pg)?;
    let rows = client
        .query(GET_INDEX_DETAIL_SQL, &[&schema, &name])
        .await
        .map_err(IntrospectError::pg)?;
    let row = rows
        .first()
        .ok_or_else(|| IntrospectError::not_found(schema, name))?;
    let table_name: String = row.get("table_name");
    let method: String = row.get("method");
    let unique: bool = row.get("unique_flag");
    let primary: bool = row.get("primary_flag");
    let indkey: Vec<i16> = row.get::<_, Option<Vec<i16>>>("indkey").unwrap_or_default();
    let indnatts: i16 = row.get("indnatts");
    let indnkeyatts: i16 = row.get("indnkeyatts");
    let indrelid: Oid = row.get("indrelid");
    let definition: String = row.get("definition");
    let predicate: Option<String> = row.get("predicate");

    let key_count = usize::try_from(indnkeyatts.max(0)).unwrap_or(0);
    let total = usize::try_from(indnatts.max(0)).unwrap_or(0);
    // Ordinals for key columns vs INCLUDE columns. Expression-based key
    // columns appear as `0` in indkey — we filter them out of the resolved
    // name list (the verbatim DDL captures the expression text).
    let (key_ordinals, include_ordinals): (Vec<i16>, Vec<i16>) = if total <= key_count {
        (indkey.clone(), Vec::new())
    } else {
        let split = key_count.min(indkey.len());
        let key = indkey.iter().copied().take(split).collect();
        let inc = indkey.iter().copied().skip(split).collect();
        (key, inc)
    };
    let key_filtered: Vec<i16> = key_ordinals.into_iter().filter(|n| *n != 0).collect();
    let include_filtered: Vec<i16> = include_ordinals.into_iter().filter(|n| *n != 0).collect();

    let columns = resolve_attnames(&client, indrelid, &key_filtered).await?;
    let include = resolve_attnames(&client, indrelid, &include_filtered).await?;

    Ok(IndexDefinition {
        schema: schema.to_string(),
        name: name.to_string(),
        table: table_name,
        method,
        unique,
        primary,
        columns,
        include,
        predicate,
        definition,
    })
}

pub async fn get_sequence_definition(
    pool: &Pool,
    schema: &str,
    name: &str,
) -> Result<SequenceDefinition, IntrospectError> {
    let client = pool.get().await.map_err(IntrospectError::pg)?;

    // PG < 10 has no `pg_sequences` view; read the sequence relation directly.
    // On 9.x every sequence is bigint and there is no per-sequence data_type.
    let (rows, data_type) = if server_version_num(&client).await < PG10 {
        let sql = format!(
            "SELECT start_value, increment_by AS increment, min_value, max_value, \
             cache_value AS cache, is_cycled AS cycle FROM {}.{}",
            quote_ident(schema),
            quote_ident(name),
        );
        let rows = client
            .query(sql.as_str(), &[])
            .await
            .map_err(IntrospectError::pg)?;
        (rows, "bigint".to_string())
    } else {
        let rows = client
            .query(GET_SEQUENCE_SQL, &[&schema, &name])
            .await
            .map_err(IntrospectError::pg)?;
        let data_type = rows
            .first()
            .map(|r| r.get::<_, String>("data_type"))
            .unwrap_or_else(|| "bigint".to_string());
        (rows, data_type)
    };
    let row = rows
        .first()
        .ok_or_else(|| IntrospectError::not_found(schema, name))?;
    let owned_rows = client
        .query(GET_SEQUENCE_OWNED_BY_SQL, &[&schema, &name])
        .await
        .map_err(IntrospectError::pg)?;
    let owned_by = owned_rows.first().map(|r| SequenceOwnedBy {
        schema: r.get("owner_schema"),
        table: r.get("owner_table"),
        column: r.get("owner_column"),
    });

    Ok(SequenceDefinition {
        schema: schema.to_string(),
        name: name.to_string(),
        data_type,
        start: row.get("start_value"),
        increment: row.get("increment"),
        min_value: row.get("min_value"),
        max_value: row.get("max_value"),
        cache: row.get("cache"),
        cycle: row.get("cycle"),
        owned_by,
    })
}

pub async fn list_matviews(
    pool: &Pool,
    schema: &str,
) -> Result<Vec<MatviewSummary>, IntrospectError> {
    let client = pool.get().await.map_err(IntrospectError::pg)?;
    let rows = client
        .query(LIST_MATVIEWS_SQL, &[&schema])
        .await
        .map_err(IntrospectError::pg)?;
    Ok(rows
        .iter()
        .map(|r| MatviewSummary {
            name: r.get("name"),
            populated: r.get("populated"),
            comment: r.get("comment"),
        })
        .collect())
}

pub async fn list_sequences(
    pool: &Pool,
    schema: &str,
) -> Result<Vec<SequenceSummary>, IntrospectError> {
    let client = pool.get().await.map_err(IntrospectError::pg)?;
    let legacy = server_version_num(&client).await < PG10;
    let rows = client
        .query(
            if legacy {
                LIST_SEQUENCES_SQL_PRE10
            } else {
                LIST_SEQUENCES_SQL
            },
            &[&schema],
        )
        .await
        .map_err(IntrospectError::pg)?;
    Ok(rows
        .iter()
        .map(|r| SequenceSummary {
            name: r.get("name"),
            data_type: r
                .get::<_, Option<String>>("data_type")
                .unwrap_or_else(|| "bigint".to_string()),
        })
        .collect())
}

// ---------------------------------------------------------------------------
// — function / procedure / trigger introspection.
// ---------------------------------------------------------------------------

use super::types::TriggerSummary;

/// Map `pg_proc.provolatile` discriminator to the canonical name.
fn volatility_name(c: &str) -> &'static str {
    match c {
        "i" => "immutable",
        "s" => "stable",
        _ => "volatile",
    }
}

/// Map `pg_proc.proparallel` discriminator to the canonical name.
fn parallel_name(c: &str) -> &'static str {
    match c {
        "s" => "safe",
        "r" => "restricted",
        _ => "unsafe",
    }
}

/// Derive `return_kind` from `format_type(prorettype, NULL)` and `proretset`.
///
/// Rules: void → "void"; trigger → "trigger"; otherwise SETOF flag wins
/// ("setof" vs "scalar"). The frontend treats "void" / "trigger" as terminal
/// kinds with no return-type value.
fn derive_return_kind(return_type_text: &str, proretset: bool) -> &'static str {
    let lower = return_type_text.to_ascii_lowercase();
    if lower == "void" {
        "void"
    } else if lower == "trigger" || lower == "event_trigger" {
        "trigger"
    } else if proretset {
        "setof"
    } else {
        "scalar"
    }
}

/// Map `pg_proc.proargmodes` single-char discriminator to the canonical name.
/// Codes 't' (table) and 'o' (out) are surfaced under our "out" mode — TABLE
/// returns are out-of-scope for editing .
const fn param_mode_name(c: char) -> &'static str {
    match c {
        'o' | 't' => "out",
        'b' => "inout",
        'v' => "variadic",
        _ => "in",
    }
}

/// Split a comma-separated list of SQL expressions, respecting parentheses
/// and single-quoted strings. Used to break up `pg_get_expr(proargdefaults, 0)`
/// into per-parameter default values.
fn split_default_exprs(s: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut buf = String::new();
    let mut depth: i32 = 0;
    let mut in_quote = false;
    let mut chars = s.chars().peekable();
    while let Some(ch) = chars.next() {
        if in_quote {
            buf.push(ch);
            if ch == '\'' {
                // Escaped '' stays inside the string.
                if matches!(chars.peek(), Some('\'')) {
                    buf.push(chars.next().unwrap());
                } else {
                    in_quote = false;
                }
            }
            continue;
        }
        match ch {
            '\'' => {
                in_quote = true;
                buf.push(ch);
            }
            '(' | '[' | '{' => {
                depth += 1;
                buf.push(ch);
            }
            ')' | ']' | '}' => {
                depth -= 1;
                buf.push(ch);
            }
            ',' if depth == 0 => {
                out.push(buf.trim().to_string());
                buf.clear();
            }
            _ => buf.push(ch),
        }
    }
    let last = buf.trim().to_string();
    if !last.is_empty() {
        out.push(last);
    }
    out
}

/// Fetch + assemble parameters for a given function/procedure oid.
///
/// Combines `proargnames`/`proargmodes`/`proallargtypes` (or `proargtypes`
/// fallback) so OUT/INOUT/VARIADIC modes round-trip. Defaults apply to the
/// LAST `pronargdefaults` IN/INOUT/VARIADIC parameters per PG semantics.
async fn fetch_function_params(
    client: &deadpool_postgres::Client,
    oid: Oid,
) -> Result<Vec<FunctionParameter>, IntrospectError> {
    let row = client
        .query_one(GET_FUNCTION_PARAMS_SQL, &[&oid])
        .await
        .map_err(IntrospectError::pg)?;
    let type_texts: Vec<String> = row
        .get::<_, Option<Vec<String>>>("type_texts")
        .unwrap_or_default();
    let names: Vec<Option<String>> = row
        .get::<_, Option<Vec<Option<String>>>>("arg_names")
        .unwrap_or_default()
        .into_iter()
        .map(|s| s.filter(|v| !v.is_empty()))
        .collect();
    let modes_raw: Vec<Option<String>> = row
        .get::<_, Option<Vec<Option<String>>>>("arg_modes")
        .unwrap_or_default();
    let defaults_text: Option<String> = row.get("defaults_text");
    let num_defaults: i16 = row.get("num_defaults");

    let count = type_texts.len();
    let mut params: Vec<FunctionParameter> = Vec::with_capacity(count);
    for i in 0..count {
        let mode = modes_raw
            .get(i)
            .and_then(|opt| opt.as_ref())
            .and_then(|s| s.chars().next())
            .map_or("in", param_mode_name)
            .to_string();
        let name = names.get(i).cloned().flatten().unwrap_or_default();
        let type_text = type_texts.get(i).cloned().unwrap_or_default();
        params.push(FunctionParameter {
            name,
            mode,
            type_text,
            default: None,
        });
    }

    // Defaults apply to the LAST `num_defaults` IN-mode (input-bearing) params.
    if num_defaults > 0 {
        let defaults_raw = defaults_text.unwrap_or_default();
        let parts = split_default_exprs(&defaults_raw);
        let nd = usize::try_from(num_defaults).unwrap_or(0);
        let input_idxs: Vec<usize> = params
            .iter()
            .enumerate()
            .filter(|(_, p)| matches!(p.mode.as_str(), "in" | "inout" | "variadic"))
            .map(|(i, _)| i)
            .collect();
        let take_from = input_idxs.len().saturating_sub(nd);
        for (j, idx) in input_idxs.iter().skip(take_from).enumerate() {
            if let Some(expr) = parts.get(j) {
                if let Some(p) = params.get_mut(*idx) {
                    p.default = Some(expr.clone());
                }
            }
        }
    }

    Ok(params)
}

pub async fn get_function_definition(
    pool: &Pool,
    schema: &str,
    name: &str,
    args: &str,
) -> Result<FunctionDefinition, IntrospectError> {
    let client = pool.get().await.map_err(IntrospectError::pg)?;
    let head_sql = if server_version_num(&client).await < PG11 {
        GET_FUNCTION_HEAD_SQL_PRE11
    } else {
        GET_FUNCTION_HEAD_SQL
    };
    let head_rows = client
        .query(head_sql, &[&schema, &name, &args])
        .await
        .map_err(IntrospectError::pg)?;
    let head = head_rows
        .first()
        .ok_or_else(|| IntrospectError::not_found(schema, name))?;
    let oid: Oid = head.get("oid");
    let language: String = head.get("language");
    let proretset: bool = head.get("proretset");
    let provolatile: String = head.get("provolatile");
    let proparallel: String = head.get("proparallel");
    let prosecdef: bool = head.get("prosecdef");
    let procost: f32 = head.get("procost");
    let prorows: f32 = head.get("prorows");
    let body: String = head.get("body");
    let return_type_text: String = head.get("return_type_text");
    let comment: Option<String> = head.get("comment");

    let return_kind = derive_return_kind(&return_type_text, proretset).to_string();
    let return_type = match return_kind.as_str() {
        "void" | "trigger" => None,
        _ => Some(return_type_text),
    };
    let estimated_rows = if proretset && prorows > 0.0 {
        Some(f64::from(prorows))
    } else {
        None
    };
    let parameters = fetch_function_params(&client, oid).await?;

    Ok(FunctionDefinition {
        schema: schema.to_string(),
        name: name.to_string(),
        language,
        parameters,
        return_kind,
        return_type,
        body,
        volatility: volatility_name(&provolatile).to_string(),
        parallel_safety: parallel_name(&proparallel).to_string(),
        security_definer: prosecdef,
        cost: Some(f64::from(procost)),
        estimated_rows,
        comment,
    })
}

pub async fn get_procedure_definition(
    pool: &Pool,
    schema: &str,
    name: &str,
    args: &str,
) -> Result<ProcedureDefinition, IntrospectError> {
    let client = pool.get().await.map_err(IntrospectError::pg)?;
    // No procedures (or `prokind`) before PG 11 — nothing to introspect.
    if server_version_num(&client).await < PG11 {
        return Err(IntrospectError::not_found(schema, name));
    }
    let head_rows = client
        .query(GET_PROCEDURE_HEAD_SQL, &[&schema, &name, &args])
        .await
        .map_err(IntrospectError::pg)?;
    let head = head_rows
        .first()
        .ok_or_else(|| IntrospectError::not_found(schema, name))?;
    let oid: Oid = head.get("oid");
    let language: String = head.get("language");
    let prosecdef: bool = head.get("prosecdef");
    let body: String = head.get("body");
    let comment: Option<String> = head.get("comment");
    let parameters = fetch_function_params(&client, oid).await?;

    Ok(ProcedureDefinition {
        schema: schema.to_string(),
        name: name.to_string(),
        language,
        parameters,
        body,
        security_definer: prosecdef,
        comment,
    })
}

pub async fn get_trigger_definition(
    pool: &Pool,
    schema: &str,
    table: &str,
    name: &str,
) -> Result<TriggerDefinition, IntrospectError> {
    let client = pool.get().await.map_err(IntrospectError::pg)?;
    let rows = client
        .query(GET_TRIGGER_DETAIL_SQL, &[&schema, &table, &name])
        .await
        .map_err(IntrospectError::pg)?;
    let row = rows
        .first()
        .ok_or_else(|| IntrospectError::not_found(schema, name))?;
    let table_schema: String = row.get("table_schema");
    let table_name: String = row.get("table_name");
    let tgrelid: Oid = row.get("tgrelid");
    let tgtype_raw: i64 = row.get("tgtype");
    let tgenabled: String = row.get("tgenabled");
    let when_clause: Option<String> = row.get("when_clause");
    let tgattr: Option<Vec<i16>> = row.get("tgattr");
    let function_schema: String = row.get("function_schema");
    let function_name: String = row.get("function_name");

    // `tgtype` lives in a 16-bit smallint on disk but we cast to int8 in SQL
    // to dodge the smallint→u32 sign mismatch. Drop the high bits before decode.
    let tgtype_u32 = u32::try_from(tgtype_raw & 0xFFFF).unwrap_or(0);
    let decoded = decode_tgtype(tgtype_u32);

    let update_columns = if decoded.events.update {
        match tgattr {
            Some(ref v) if !v.is_empty() => resolve_attnames(&client, tgrelid, v).await?,
            _ => Vec::new(),
        }
    } else {
        Vec::new()
    };

    Ok(TriggerDefinition {
        schema: schema.to_string(),
        name: name.to_string(),
        table_schema,
        table_name,
        timing: decoded.timing,
        events: decoded.events,
        update_columns,
        for_each: decoded.for_each,
        when_clause,
        function_schema,
        function_name,
        enabled: tgenabled != "D",
    })
}

pub async fn list_functions(
    pool: &Pool,
    schema: &str,
    trigger_only: bool,
) -> Result<Vec<FunctionSummary>, IntrospectError> {
    let client = pool.get().await.map_err(IntrospectError::pg)?;
    // PG < 11 has no `prokind`; functions are filtered via proisagg/proiswindow.
    let sql = if server_version_num(&client).await < PG11 {
        LIST_FUNCTIONS_SQL_PRE11
    } else {
        LIST_FUNCTIONS_SQL
    };
    let rows = client
        .query(sql, &[&schema, &trigger_only])
        .await
        .map_err(IntrospectError::pg)?;
    Ok(rows
        .iter()
        .map(|r| {
            let return_type_text: String = r.get("return_type_text");
            let proretset: bool = r.get("proretset");
            let return_kind = derive_return_kind(&return_type_text, proretset).to_string();
            let return_type = match return_kind.as_str() {
                "void" | "trigger" => None,
                _ => Some(return_type_text),
            };
            FunctionSummary {
                name: r.get("name"),
                args: r.get("args"),
                return_kind,
                return_type,
            }
        })
        .collect())
}

pub async fn list_procedures(
    pool: &Pool,
    schema: &str,
) -> Result<Vec<ProcedureSummary>, IntrospectError> {
    let client = pool.get().await.map_err(IntrospectError::pg)?;
    // CREATE PROCEDURE arrived in PG 11; older servers have none (and no
    // `prokind` column to query), so return an empty list cleanly.
    if server_version_num(&client).await < PG11 {
        return Ok(Vec::new());
    }
    let rows = client
        .query(LIST_PROCEDURES_SQL, &[&schema])
        .await
        .map_err(IntrospectError::pg)?;
    Ok(rows
        .iter()
        .map(|r| ProcedureSummary {
            name: r.get("name"),
            args: r.get("args"),
        })
        .collect())
}

pub async fn list_triggers(
    pool: &Pool,
    schema: &str,
    table: Option<&str>,
) -> Result<Vec<TriggerSummary>, IntrospectError> {
    let client = pool.get().await.map_err(IntrospectError::pg)?;
    let rows = client
        .query(LIST_TRIGGERS_SQL, &[&schema, &table])
        .await
        .map_err(IntrospectError::pg)?;
    Ok(rows
        .iter()
        .map(|r| {
            let tgenabled: String = r.get("tgenabled");
            TriggerSummary {
                name: r.get("name"),
                table_schema: r.get("table_schema"),
                table_name: r.get("table_name"),
                enabled: tgenabled != "D",
            }
        })
        .collect())
}

// ---------------------------------------------------------------------------
// — FDW / Publication / Subscription / Role / Custom Type fetchers.
// All bodies are placeholders until Phase B1.
// ---------------------------------------------------------------------------

use super::types::{
    CompositeField, CompositeTypeDefinition, CustomTypeDefinition, DomainConstraint,
    DomainTypeDefinition, EnumTypeDefinition, FdwServerDefinition, KvOption, PublicationDefinition,
    PublicationSummary, QualifiedName, RangeTypeDefinition, RoleDefinition, RoleSummary,
    SubscriptionDefinition, UserMapping,
};

pub async fn get_fdw_server_definition(
    pool: &Pool,
    server_name: &str,
) -> Result<FdwServerDefinition, IntrospectError> {
    let client = pool.get().await.map_err(IntrospectError::pg)?;
    let row_opt = client
        .query_opt(super::queries::GET_FDW_SERVER_SQL, &[&server_name])
        .await
        .map_err(IntrospectError::pg)?;
    let row = row_opt.ok_or_else(|| IntrospectError::not_found("", server_name))?;

    let options_raw: Vec<String> = row.get("options");
    let options = parse_kv_options(&options_raw);

    let mappings_rows = client
        .query(super::queries::GET_USER_MAPPINGS_SQL, &[&server_name])
        .await
        .map_err(IntrospectError::pg)?;
    let user_mappings = mappings_rows
        .iter()
        .map(|r| {
            let raw: Vec<String> = r.get("options");
            UserMapping {
                role_name: r.get("role_name"),
                options: parse_kv_options(&raw),
            }
        })
        .collect();

    Ok(FdwServerDefinition {
        name: row.get("srvname"),
        fdw_name: row.get("fdwname"),
        server_type: row.get("srvtype"),
        version: row.get("srvversion"),
        options,
        user_mappings,
        comment: row.get("comment"),
    })
}

/// Parse `pg_foreign_server.srvoptions` / `pg_user_mapping.umoptions`
/// `text[]` entries shaped as `"key=value"` (PG's standard option encoding).
fn parse_kv_options(raw: &[String]) -> Vec<KvOption> {
    raw.iter()
        .filter_map(|s| {
            let eq = s.find('=')?;
            Some(KvOption {
                key: s[..eq].to_string(),
                value: s[eq + 1..].to_string(),
            })
        })
        .collect()
}

pub async fn get_publication_definition(
    pool: &Pool,
    pub_name: &str,
) -> Result<PublicationDefinition, IntrospectError> {
    let client = pool.get().await.map_err(IntrospectError::pg)?;
    let head = client
        .query_opt(super::queries::GET_PUBLICATION_HEAD_SQL, &[&pub_name])
        .await
        .map_err(IntrospectError::pg)?
        .ok_or_else(|| IntrospectError::not_found("", pub_name))?;

    let table_rows = client
        .query(super::queries::GET_PUBLICATION_TABLES_SQL, &[&pub_name])
        .await
        .map_err(IntrospectError::pg)?;
    let tables: Vec<QualifiedName> = table_rows
        .iter()
        .map(|r| QualifiedName {
            schema: r.get("nspname"),
            name: r.get("relname"),
        })
        .collect();

    let schema_rows = client
        .query(super::queries::GET_PUBLICATION_SCHEMAS_SQL, &[&pub_name])
        .await
        .map_err(IntrospectError::pg)?;
    let schemas: Vec<String> = schema_rows.iter().map(|r| r.get("nspname")).collect();

    Ok(PublicationDefinition {
        name: head.get("pubname"),
        all_tables: head.get("puballtables"),
        schemas,
        tables,
        publish_insert: head.get("pubinsert"),
        publish_update: head.get("pubupdate"),
        publish_delete: head.get("pubdelete"),
        publish_truncate: head.get("pubtruncate"),
        publish_via_partition_root: head.get("pubviaroot"),
        comment: head.get("comment"),
    })
}

pub async fn get_subscription_definition(
    pool: &Pool,
    sub_name: &str,
) -> Result<SubscriptionDefinition, IntrospectError> {
    let client = pool.get().await.map_err(IntrospectError::pg)?;
    let row_res = client
        .query_opt(super::queries::GET_SUBSCRIPTION_SQL, &[&sub_name])
        .await;

    let row = match row_res {
        Ok(Some(r)) => r,
        Ok(None) => return Err(IntrospectError::not_found("", sub_name)),
        Err(e) => {
            let msg = e.to_string();
            if msg.contains("permission denied") {
                return Err(IntrospectError::PermissionDenied(
                    "pg_subscription requires superuser privileges".to_string(),
                ));
            }
            return Err(IntrospectError::Postgres(msg));
        }
    };

    let publications: Vec<String> = row.get("subpublications");
    Ok(SubscriptionDefinition {
        name: row.get("subname"),
        conninfo: row.get("subconninfo"),
        publications,
        enabled: row.get("subenabled"),
        // copy_data and create_slot are CREATE-time options not reflected in
        // pg_subscription post-creation. Default to true (PG defaults).
        copy_data: true,
        create_slot: true,
        slot_name: row.get("subslotname"),
        synchronous_commit: row.get("synchronous_commit"),
        comment: row.get("comment"),
    })
}

pub async fn get_role_definition(
    pool: &Pool,
    role_name: &str,
) -> Result<RoleDefinition, IntrospectError> {
    let client = pool.get().await.map_err(IntrospectError::pg)?;
    let row = client
        .query_opt(super::queries::GET_ROLE_SQL, &[&role_name])
        .await
        .map_err(IntrospectError::pg)?
        .ok_or_else(|| IntrospectError::not_found("", role_name))?;

    let memberships = client
        .query(super::queries::GET_ROLE_MEMBERSHIPS_SQL, &[&role_name])
        .await
        .map_err(IntrospectError::pg)?
        .iter()
        .map(|r| r.get::<_, String>("parent"))
        .collect();

    Ok(RoleDefinition {
        name: row.get("rolname"),
        login: row.get("rolcanlogin"),
        superuser: row.get("rolsuper"),
        createdb: row.get("rolcreatedb"),
        createrole: row.get("rolcreaterole"),
        replication: row.get("rolreplication"),
        bypassrls: row.get("rolbypassrls"),
        inherit: row.get("rolinherit"),
        connection_limit: row.get("rolconnlimit"),
        valid_until: row.get("valid_until"),
        member_of: memberships,
        comment: row.get("comment"),
    })
}

pub async fn get_custom_type_definition(
    pool: &Pool,
    schema: &str,
    name: &str,
) -> Result<CustomTypeDefinition, IntrospectError> {
    let client = pool.get().await.map_err(IntrospectError::pg)?;
    let row = client
        .query_opt(super::queries::GET_TYPE_BY_NAME_SQL, &[&schema, &name])
        .await
        .map_err(IntrospectError::pg)?
        .ok_or_else(|| IntrospectError::not_found(schema, name))?;
    let oid: Oid = row.get("oid");
    let typtype: String = {
        let s: i8 = row.get("typtype");
        #[allow(clippy::cast_sign_loss)]
        let c = s as u8 as char;
        c.to_string()
    };
    let comment: Option<String> = row.get("comment");

    match typtype.as_str() {
        "e" => {
            let rows = client
                .query(super::queries::GET_ENUM_VALUES_SQL, &[&oid])
                .await
                .map_err(IntrospectError::pg)?;
            let values = rows
                .iter()
                .map(|r| r.get::<_, String>("enumlabel"))
                .collect();
            Ok(CustomTypeDefinition::Enum(EnumTypeDefinition {
                schema: schema.to_string(),
                name: name.to_string(),
                values,
                comment,
            }))
        }
        "c" => {
            let rows = client
                .query(super::queries::GET_COMPOSITE_FIELDS_SQL, &[&oid])
                .await
                .map_err(IntrospectError::pg)?;
            let fields = rows
                .iter()
                .map(|r| CompositeField {
                    name: r.get("attname"),
                    type_text: r.get("type_text"),
                    collation: r.get("collation"),
                })
                .collect();
            Ok(CustomTypeDefinition::Composite(CompositeTypeDefinition {
                schema: schema.to_string(),
                name: name.to_string(),
                fields,
                comment,
            }))
        }
        "d" => {
            let head = client
                .query_one(super::queries::GET_DOMAIN_SQL, &[&oid])
                .await
                .map_err(IntrospectError::pg)?;
            let cons = client
                .query(super::queries::GET_DOMAIN_CONSTRAINTS_SQL, &[&oid])
                .await
                .map_err(IntrospectError::pg)?;
            let constraints = cons
                .iter()
                .map(|r| {
                    let def: String = r.get("def");
                    // pg_get_constraintdef returns "CHECK ((VALUE > 0))" — strip wrapper.
                    let check = strip_check_wrapper(&def);
                    DomainConstraint {
                        name: r.get("conname"),
                        check,
                        not_valid: !r.get::<_, bool>("convalidated"),
                    }
                })
                .collect();
            Ok(CustomTypeDefinition::Domain(DomainTypeDefinition {
                schema: schema.to_string(),
                name: name.to_string(),
                base_type: head.get("base_type"),
                not_null: head.get("typnotnull"),
                default: head.get("default_value"),
                constraints,
                collation: head.get("collation"),
                comment,
            }))
        }
        "r" => {
            let head = client
                .query_one(super::queries::GET_RANGE_SQL, &[&oid])
                .await
                .map_err(IntrospectError::pg)?;
            Ok(CustomTypeDefinition::Range(RangeTypeDefinition {
                schema: schema.to_string(),
                name: name.to_string(),
                subtype: head.get("subtype"),
                subtype_opclass: head.get("subtype_opclass"),
                collation: head.get("collation"),
                canonical: head.get("canonical"),
                subtype_diff: head.get("subtype_diff"),
                multirange_type_name: head.get("multirange_type_name"),
                comment,
            }))
        }
        other => Err(IntrospectError::Internal(format!(
            "unsupported typtype '{other}' for {schema}.{name}"
        ))),
    }
}

/// Strip "CHECK ((..))" → "..". Permissive; if the wrapper is missing returns the input.
fn strip_check_wrapper(def: &str) -> String {
    let trimmed = def.trim();
    let s = trimmed
        .strip_prefix("CHECK")
        .unwrap_or(trimmed)
        .trim_start();
    let s = s.strip_prefix('(').unwrap_or(s);
    let s = s.strip_suffix(')').unwrap_or(s);
    let s = s.strip_prefix('(').unwrap_or(s);
    let s = s.strip_suffix(')').unwrap_or(s);
    s.trim().to_string()
}

pub async fn list_publishable_tables(pool: &Pool) -> Result<Vec<QualifiedName>, IntrospectError> {
    let client = pool.get().await.map_err(IntrospectError::pg)?;
    let rows = client
        .query(super::queries::LIST_PUBLISHABLE_TABLES_SQL, &[])
        .await
        .map_err(IntrospectError::pg)?;
    Ok(rows
        .iter()
        .map(|r| QualifiedName {
            schema: r.get("nspname"),
            name: r.get("relname"),
        })
        .collect())
}

pub async fn list_publications(pool: &Pool) -> Result<Vec<PublicationSummary>, IntrospectError> {
    let client = pool.get().await.map_err(IntrospectError::pg)?;
    let rows = client
        .query(super::queries::LIST_PUBLICATIONS_SQL, &[])
        .await
        .map_err(IntrospectError::pg)?;
    Ok(rows
        .iter()
        .map(|r| PublicationSummary {
            name: r.get("pubname"),
            all_tables: r.get("puballtables"),
        })
        .collect())
}

pub async fn list_collations(pool: &Pool) -> Result<Vec<String>, IntrospectError> {
    let client = pool.get().await.map_err(IntrospectError::pg)?;
    let rows = client
        .query(super::queries::LIST_COLLATIONS_SQL, &[])
        .await
        .map_err(IntrospectError::pg)?;
    Ok(rows
        .iter()
        .map(|r| r.get::<_, String>("collname"))
        .collect())
}

pub async fn list_roles(pool: &Pool) -> Result<Vec<RoleSummary>, IntrospectError> {
    let client = pool.get().await.map_err(IntrospectError::pg)?;
    let rows = client
        .query(super::queries::LIST_ROLES_SQL, &[])
        .await
        .map_err(IntrospectError::pg)?;
    Ok(rows
        .iter()
        .map(|r| RoleSummary {
            name: r.get("rolname"),
            login: r.get("rolcanlogin"),
        })
        .collect())
}
