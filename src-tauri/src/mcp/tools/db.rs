//! Database-side MCP tools — implementation.
//!
//! Each tool is an async function with a signature compatible with
//! [`crate::mcp::server::ToolFn`]. Registered in
//! [`super::register_all`].
//!
//! ## Tools
//! | Name | Read/Write | Scope |
//! |---|---|---|
//! | `list_connections` | R | `db:list` |
//! | `get_schema` | R | `db:read` |
//! | `get_table_sample` | R | `db:read` |
//! | `run_query` (read-only mode) | R | `db:read` |
//! | `run_query_write` (per-call confirm) | W | `db:write` |
//! | `get_explain` | R | `db:read` |
//! | `get_health_summary` | R | `db:read` |
//! | `list_slow_queries` | R | `db:read` |
//! | `dry_run_migration` | R (testcontainer) | `db:read` |
//! | `apply_migration` | W (per-call confirm) | `db:write` |

#![allow(
    clippy::missing_errors_doc,
    clippy::missing_panics_doc,
    clippy::too_many_lines,
    clippy::doc_markdown,
    clippy::module_name_repetitions,
    clippy::cast_possible_truncation,
    clippy::cast_precision_loss,
    clippy::similar_names,
    clippy::cognitive_complexity,
    clippy::needless_pass_by_value
)]

use std::time::{Duration, Instant};

use deadpool_postgres::Pool;
use pg_query::NodeEnum;
use serde_json::{json, Value};
use testcontainers::{runners::AsyncRunner, ImageExt};
use testcontainers_modules::postgres::Postgres as PgImage;

use crate::mcp::auth::AuthorizedClient;
use crate::mcp::server::{McpError, ServerContext};
use crate::query::format;

/// Hard cap on rows returned by any read tool — matches the IDE result-grid
/// invariant (1000 rows per page) so an external agent can never pull more
/// data through MCP than the user could see in the IDE.
const MAX_ROWS: usize = 1000;

/// Per-tool timeout for write-confirm prompts — protects the MCP server from
/// hung clients if the user closes the IDE without responding.
const WRITE_CONFIRM_TIMEOUT: Duration = Duration::from_secs(300);

/// Validate that a Postgres identifier is safe to interpolate into SQL.
/// We disallow anything outside `[A-Za-z_][A-Za-z0-9_]*` because PG does
/// not accept identifier parameters via `$N`. Quoted identifiers are not
/// supported on the MCP wire to keep the surface area small.
fn validate_ident(s: &str, kind: &str) -> Result<(), McpError> {
    let mut chars = s.chars();
    let first = chars
        .next()
        .ok_or_else(|| McpError::InvalidArgs(format!("{kind} cannot be empty")))?;
    if !(first.is_ascii_alphabetic() || first == '_') {
        return Err(McpError::InvalidArgs(format!(
            "{kind} must start with a letter or underscore: {s}"
        )));
    }
    for c in chars {
        if !(c.is_ascii_alphanumeric() || c == '_') {
            return Err(McpError::InvalidArgs(format!(
                "{kind} contains invalid character {c:?}: {s}"
            )));
        }
    }
    Ok(())
}

/// Resolve `connId` argument to a deadpool Pool, errorring if either the
/// argument is missing/wrong type or the connection has no live pool.
async fn resolve_pool(ctx: &ServerContext, conn_id: &str) -> Result<Pool, McpError> {
    ctx.pools
        .get(conn_id)
        .await
        .ok_or_else(|| McpError::Internal(format!("connection not active: {conn_id}")))
}

/// Pull `connId` (camelCase per MCP wire convention) from a JSON arg blob.
fn arg_str(args: &Value, key: &str) -> Result<String, McpError> {
    args.get(key)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| McpError::InvalidArgs(format!("missing field '{key}'")))
}

fn arg_str_opt(args: &Value, key: &str) -> Option<String> {
    args.get(key).and_then(Value::as_str).map(str::to_owned)
}

fn arg_u64_opt(args: &Value, key: &str) -> Option<u64> {
    args.get(key).and_then(Value::as_u64)
}

fn arg_bool(args: &Value, key: &str, default: bool) -> bool {
    args.get(key).and_then(Value::as_bool).unwrap_or(default)
}

// ---------------------------------------------------------------------------
// list_connections
// ---------------------------------------------------------------------------

pub async fn list_connections_tool(
    ctx: &ServerContext,
    _client: &AuthorizedClient,
    _args: Value,
) -> Result<Value, McpError> {
    let store = ctx.store.lock().await;
    let conns = store
        .list()
        .map_err(|e| McpError::Internal(format!("store list: {e}")))?;
    drop(store);
    let out: Vec<Value> = conns
        .into_iter()
        .map(|c| {
            json!({
                "id": c.id,
                "name": c.name,
                "host": c.host,
                "port": c.port,
                "database": c.database,
                "environment": c.environment.as_str(),
            })
        })
        .collect();
    Ok(json!({ "connections": out }))
}

// ---------------------------------------------------------------------------
// get_schema
// ---------------------------------------------------------------------------

pub async fn get_schema_tool(
    ctx: &ServerContext,
    _client: &AuthorizedClient,
    args: Value,
) -> Result<Value, McpError> {
    let conn_id = arg_str(&args, "connId")?;
    let schema_filter = arg_str_opt(&args, "schema");

    let pool = resolve_pool(ctx, &conn_id).await?;
    let pg_client = pool
        .get()
        .await
        .map_err(|e| McpError::Internal(format!("pool: {e}")))?;

    // 1) List user schemas (or single one filtered).
    let schema_rows = pg_client
        .query(crate::schema::queries::LIST_SCHEMAS_SQL, &[])
        .await
        .map_err(|e| McpError::Internal(format!("list schemas: {e}")))?;
    let mut schemas: Vec<String> = schema_rows
        .iter()
        .map(|r| r.get::<_, String>("name"))
        .collect();
    if let Some(filter) = &schema_filter {
        validate_ident(filter, "schema")?;
        schemas.retain(|s| s == filter);
    }

    let mut schema_payload: Vec<Value> = Vec::new();
    for schema in &schemas {
        let table_rows = pg_client
            .query(crate::schema::queries::LIST_TABLES_SQL, &[schema])
            .await
            .map_err(|e| McpError::Internal(format!("list tables {schema}: {e}")))?;
        let mut tables: Vec<Value> = Vec::new();
        for tr in &table_rows {
            let table_name: String = tr.get("name");
            let comment: Option<String> = tr.get("comment");

            let column_rows = pg_client
                .query(
                    crate::schema::queries::LIST_COLUMNS_SQL,
                    &[schema, &table_name],
                )
                .await
                .map_err(|e| {
                    McpError::Internal(format!("list columns {schema}.{table_name}: {e}"))
                })?;
            let columns: Vec<Value> = column_rows
                .iter()
                .map(|r| {
                    json!({
                        "name": r.get::<_, String>("name"),
                        "dataType": r.get::<_, String>("data_type"),
                        "nullable": r.get::<_, bool>("nullable"),
                        "default": r.get::<_, Option<String>>("default"),
                        "ordinal": i32::from(r.get::<_, i16>("ordinal")),
                    })
                })
                .collect();

            let index_rows = pg_client
                .query(
                    crate::schema::queries::LIST_INDEXES_SQL,
                    &[schema, &table_name],
                )
                .await
                .map_err(|e| {
                    McpError::Internal(format!("list indexes {schema}.{table_name}: {e}"))
                })?;
            let indexes: Vec<Value> = index_rows
                .iter()
                .map(|r| {
                    json!({
                        "name": r.get::<_, String>("name"),
                        "method": r.get::<_, String>("method"),
                        "isUnique": r.get::<_, bool>("is_unique"),
                        "isPrimary": r.get::<_, bool>("is_primary"),
                        "definition": r.get::<_, String>("definition"),
                    })
                })
                .collect();

            let fk_rows = pg_client
                .query(
                    crate::schema::queries::LIST_FOREIGN_KEYS_SQL,
                    &[schema, &table_name],
                )
                .await
                .map_err(|e| McpError::Internal(format!("list FKs {schema}.{table_name}: {e}")))?;
            let foreign_keys: Vec<Value> = fk_rows
                .iter()
                .map(|r| {
                    json!({
                        "name": r.get::<_, String>("name"),
                        "definition": r.get::<_, String>("definition"),
                        "referencedSchema": r.get::<_, String>("referenced_schema"),
                        "referencedTable": r.get::<_, String>("referenced_table"),
                    })
                })
                .collect();

            tables.push(json!({
                "name": table_name,
                "comment": comment,
                "columns": columns,
                "indexes": indexes,
                "foreignKeys": foreign_keys,
            }));
        }

        schema_payload.push(json!({
            "name": schema,
            "tables": tables,
        }));
    }

    Ok(json!({
        "connId": conn_id,
        "schemas": schema_payload,
    }))
}

// ---------------------------------------------------------------------------
// get_table_sample
// ---------------------------------------------------------------------------

pub async fn get_table_sample_tool(
    ctx: &ServerContext,
    _client: &AuthorizedClient,
    args: Value,
) -> Result<Value, McpError> {
    let conn_id = arg_str(&args, "connId")?;
    let schema = arg_str(&args, "schema")?;
    let table = arg_str(&args, "table")?;
    let limit_in = arg_u64_opt(&args, "limit").unwrap_or(100);
    if limit_in == 0 || limit_in > 100 {
        return Err(McpError::InvalidArgs(format!(
            "limit must be between 1 and 100, got {limit_in}"
        )));
    }
    validate_ident(&schema, "schema")?;
    validate_ident(&table, "table")?;

    let pool = resolve_pool(ctx, &conn_id).await?;
    let pg_client = pool
        .get()
        .await
        .map_err(|e| McpError::Internal(format!("pool: {e}")))?;

    // Identifiers cannot be parameterized; we already validated them so
    // this format-string interpolation is safe.
    let sql = format!("SELECT * FROM \"{schema}\".\"{table}\" LIMIT {limit_in}",);
    let stmt = pg_client
        .prepare(&sql)
        .await
        .map_err(|e| McpError::Internal(format!("prepare sample: {e}")))?;
    let columns: Vec<Value> = stmt
        .columns()
        .iter()
        .map(|c| {
            json!({
                "name": c.name(),
                "type": c.type_().name(),
            })
        })
        .collect();
    let rows = pg_client
        .query(&stmt, &[])
        .await
        .map_err(|e| McpError::Internal(format!("execute sample: {e}")))?;
    let row_payload: Vec<Vec<Option<String>>> = rows
        .iter()
        .map(|row| {
            (0..row.len())
                .map(|i| format::cell_to_string(row, i))
                .collect()
        })
        .collect();

    Ok(json!({
        "columns": columns,
        "rows": row_payload,
    }))
}

// ---------------------------------------------------------------------------
// run_query (read-only)
// ---------------------------------------------------------------------------

/// Reject statements that look like writes by inspecting the parsed AST. We
/// run `pg_query::parse` and then enforce SELECT-only at the top-level. If
/// pg_query can't parse the SQL, we still let it through to Postgres (the
/// READ ONLY transaction will refuse anything dangerous).
fn ensure_select_only(sql: &str) -> Result<(), McpError> {
    let parsed = match pg_query::parse(sql) {
        Ok(p) => p,
        Err(e) => {
            return Err(McpError::InvalidArgs(format!("SQL parse failed: {e}")));
        }
    };
    for stmt in &parsed.protobuf.stmts {
        let Some(stmt_node) = stmt.stmt.as_ref().and_then(|n| n.node.as_ref()) else {
            continue;
        };
        match stmt_node {
            NodeEnum::SelectStmt(_)
            | NodeEnum::ExplainStmt(_)
            | NodeEnum::VariableShowStmt(_)
            | NodeEnum::TransactionStmt(_) => {}
            _ => {
                return Err(McpError::InvalidArgs(format!(                    "run_query rejects non-SELECT statements (use run_query_write for writes); got {stmt_node:?}"
)));
            }
        }
    }
    Ok(())
}

pub async fn run_query_tool(
    ctx: &ServerContext,
    _client: &AuthorizedClient,
    args: Value,
) -> Result<Value, McpError> {
    let conn_id = arg_str(&args, "connId")?;
    let sql = arg_str(&args, "sql")?;
    let max_rows = arg_u64_opt(&args, "maxRows").map_or(MAX_ROWS, |n| (n as usize).min(MAX_ROWS));

    ensure_select_only(&sql)?;

    let pool = resolve_pool(ctx, &conn_id).await?;
    let pg_client = pool
        .get()
        .await
        .map_err(|e| McpError::Internal(format!("pool: {e}")))?;

    // Wrap in BEGIN READ ONLY ... COMMIT so any unparseable-but-mutating
    // SQL still hits the PG read-only guard.
    pg_client
        .batch_execute("BEGIN READ ONLY")
        .await
        .map_err(|e| McpError::Internal(format!("begin readonly: {e}")))?;

    let started = Instant::now();
    let stmt_result = pg_client.prepare(&sql).await;
    let stmt = match stmt_result {
        Ok(s) => s,
        Err(e) => {
            let _ = pg_client.batch_execute("ROLLBACK").await;
            return Err(McpError::Internal(format!("prepare: {e}")));
        }
    };
    let columns: Vec<Value> = stmt
        .columns()
        .iter()
        .map(|c| {
            json!({
                "name": c.name(),
                "type": c.type_().name(),
            })
        })
        .collect();

    let rows_result = pg_client.query(&stmt, &[]).await;
    let _ = pg_client.batch_execute("COMMIT").await;
    let rows = rows_result.map_err(|e| McpError::Internal(format!("query: {e}")))?;
    let truncated = rows.len() > max_rows;
    let row_payload: Vec<Vec<Option<String>>> = rows
        .iter()
        .take(max_rows)
        .map(|row| {
            (0..row.len())
                .map(|i| format::cell_to_string(row, i))
                .collect()
        })
        .collect();

    Ok(json!({
        "columns": columns,
        "rows": row_payload,
        "durationMs": started.elapsed().as_millis() as u64,
        "truncated": truncated,
    }))
}

// ---------------------------------------------------------------------------
// run_query_write (per-call user confirm)
// ---------------------------------------------------------------------------

async fn await_write_confirm(
    ctx: &ServerContext,
    client: &AuthorizedClient,
    sql: &str,
) -> Result<(), McpError> {
    let (tx, rx) = tokio::sync::oneshot::channel::<bool>();
    let request_id = ctx
        .auth
        .register_write_confirm(client.name.clone(), sql.to_string(), tx)
        .await;

    if let Some(app) = &ctx.app_handle {
        use tauri::Emitter;
        let _ = app.emit(
            "mcp:write-confirm-request",
            json!({
                "requestId": request_id,
                "clientId": client.id,
                "clientName": client.name,
                "sql": sql,
            }),
        );
    }

    match tokio::time::timeout(WRITE_CONFIRM_TIMEOUT, rx).await {
        Ok(Ok(true)) => Ok(()),
        _ => Err(McpError::WriteRejected),
    }
}

pub async fn run_query_write_tool(
    ctx: &ServerContext,
    client: &AuthorizedClient,
    args: Value,
) -> Result<Value, McpError> {
    let conn_id = arg_str(&args, "connId")?;
    let sql = arg_str(&args, "sql")?;

    await_write_confirm(ctx, client, &sql).await?;

    let pool = resolve_pool(ctx, &conn_id).await?;
    let pg_client = pool
        .get()
        .await
        .map_err(|e| McpError::Internal(format!("pool: {e}")))?;

    let started = Instant::now();
    let rows_affected = pg_client
        .execute(&sql, &[])
        .await
        .map_err(|e| McpError::Internal(format!("execute write: {e}")))?;

    Ok(json!({
        "rowsAffected": rows_affected,
        "durationMs": started.elapsed().as_millis() as u64,
    }))
}

// ---------------------------------------------------------------------------
// get_explain
// ---------------------------------------------------------------------------

pub async fn get_explain_tool(
    ctx: &ServerContext,
    _client: &AuthorizedClient,
    args: Value,
) -> Result<Value, McpError> {
    let conn_id = arg_str(&args, "connId")?;
    let sql = arg_str(&args, "sql")?;
    let analyze = arg_bool(&args, "analyze", false);
    let buffers = arg_bool(&args, "buffers", false);

    let pool = resolve_pool(ctx, &conn_id).await?;
    let pg_client = pool
        .get()
        .await
        .map_err(|e| McpError::Internal(format!("pool: {e}")))?;

    let mut opts = String::from("FORMAT JSON");
    if analyze {
        opts.push_str(", ANALYZE");
    }
    if buffers {
        opts.push_str(", BUFFERS");
    }
    let explain_sql = format!("EXPLAIN ({opts}) {sql}");
    let row = pg_client
        .query_one(&explain_sql, &[])
        .await
        .map_err(|e| McpError::Internal(format!("explain: {e}")))?;
    let plan: Value = row.get(0);
    Ok(json!({
        "plan": plan,
        "analyze": analyze,
        "buffers": buffers,
    }))
}

// ---------------------------------------------------------------------------
// get_health_summary
// ---------------------------------------------------------------------------

pub async fn get_health_summary_tool(
    ctx: &ServerContext,
    _client: &AuthorizedClient,
    args: Value,
) -> Result<Value, McpError> {
    let conn_id = arg_str(&args, "connId")?;
    let pool = resolve_pool(ctx, &conn_id).await?;
    let pg_client = pool
        .get()
        .await
        .map_err(|e| McpError::Internal(format!("pool: {e}")))?;

    // db size
    let size_row = pg_client
        .query_one(crate::health::queries::DB_SIZE, &[])
        .await
        .map_err(|e| McpError::Internal(format!("db_size: {e}")))?;
    let db_size = json!({
        "bytes": size_row.get::<_, i64>("bytes"),
        "pretty": size_row.get::<_, String>("pretty"),
    });

    // cache hit
    let cache_row = pg_client
        .query_one(crate::health::queries::CACHE_HIT, &[])
        .await
        .map_err(|e| McpError::Internal(format!("cache_hit: {e}")))?;
    let cache_hit = json!({
        "ratioPct": cache_row.get::<_, f64>("ratio_pct"),
    });

    // active connections
    let conn_rows = pg_client
        .query(crate::health::queries::ACTIVE_CONNECTIONS_BY_STATE, &[])
        .await
        .map_err(|e| McpError::Internal(format!("active_connections: {e}")))?;
    let mut by_state = serde_json::Map::new();
    let mut current: i64 = 0;
    for r in &conn_rows {
        let state: String = r.get("state");
        let cnt: i64 = r.get("cnt");
        current += cnt;
        by_state.insert(state, json!(cnt));
    }
    let max_row = pg_client
        .query_one(crate::health::queries::SHOW_MAX_CONNECTIONS, &[])
        .await
        .map_err(|e| McpError::Internal(format!("max_connections: {e}")))?;
    let max_str: String = max_row.get(0);
    let max: i64 = max_str.parse().unwrap_or(0);
    let active_connections = json!({
        "current": current,
        "max": max,
        "byState": by_state,
    });

    // long running
    let long_rows = pg_client
        .query(crate::health::queries::LONG_RUNNING, &[])
        .await
        .map_err(|e| McpError::Internal(format!("long_running: {e}")))?;
    let long_running: Vec<Value> = long_rows
        .iter()
        .map(|r| {
            json!({
                "pid": r.get::<_, i32>("pid"),
                "durationSeconds": r.get::<_, f64>("duration_seconds"),
                "query": r.get::<_, String>("query"),
                "state": r.get::<_, String>("state"),
                "username": r.get::<_, String>("username"),
            })
        })
        .collect();

    Ok(json!({
        "dbSize": db_size,
        "cacheHit": cache_hit,
        "activeConnections": active_connections,
        "longRunning": long_running,
    }))
}

// ---------------------------------------------------------------------------
// list_slow_queries
// ---------------------------------------------------------------------------

pub async fn list_slow_queries_tool(
    ctx: &ServerContext,
    _client: &AuthorizedClient,
    args: Value,
) -> Result<Value, McpError> {
    let conn_id = arg_str(&args, "connId")?;
    let limit = arg_u64_opt(&args, "limit").unwrap_or(20).clamp(1, 100);

    let pool = resolve_pool(ctx, &conn_id).await?;
    let pg_client = pool
        .get()
        .await
        .map_err(|e| McpError::Internal(format!("pool: {e}")))?;

    let probe = pg_client
        .query(crate::health::queries::PG_STAT_STATEMENTS_PROBE, &[])
        .await
        .map_err(|e| McpError::Internal(format!("probe: {e}")))?;
    if probe.is_empty() {
        return Err(McpError::Internal(
            "pg_stat_statements extension not installed".into(),
        ));
    }

    // The shipped query is `LIMIT 10` — for MCP we want a configurable cap.
    let sql = format!(
        "SELECT query, mean_exec_time AS mean_time_ms, total_exec_time AS total_time_ms, calls \
         FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT {limit}",
    );
    let rows = pg_client
        .query(sql.as_str(), &[])
        .await
        .map_err(|e| McpError::Internal(format!("slow_queries: {e}")))?;
    let out: Vec<Value> = rows
        .iter()
        .map(|r| {
            json!({
                "query": r.get::<_, String>("query"),
                "meanTimeMs": r.get::<_, f64>("mean_time_ms"),
                "totalTimeMs": r.get::<_, f64>("total_time_ms"),
                "calls": r.get::<_, i64>("calls"),
            })
        })
        .collect();

    Ok(json!({ "rows": out }))
}

// ---------------------------------------------------------------------------
// dry_run_migration  — stand up disposable PG via testcontainers, run SQL.
// ---------------------------------------------------------------------------

pub async fn dry_run_migration_tool(
    _ctx: &ServerContext,
    _client: &AuthorizedClient,
    args: Value,
) -> Result<Value, McpError> {
    // Parse the input first so we never spin up a container for a malformed
    // request.
    let _conn_id = arg_str(&args, "connId")?;
    let sql = arg_str(&args, "sql")?;

    let started = Instant::now();
    let image = PgImage::default().with_tag("16-alpine");
    let container = image
        .start()
        .await
        .map_err(|e| McpError::Internal(format!("container start: {e}")))?;
    let host = container
        .get_host()
        .await
        .map_err(|e| McpError::Internal(format!("container host: {e}")))?;
    let port = container
        .get_host_port_ipv4(5432)
        .await
        .map_err(|e| McpError::Internal(format!("container port: {e}")))?;

    let conn_str =
        format!("host={host} port={port} user=postgres password=postgres dbname=postgres");
    let (pg_client, conn) = tokio_postgres::connect(&conn_str, tokio_postgres::NoTls)
        .await
        .map_err(|e| McpError::Internal(format!("container connect: {e}")))?;
    tokio::spawn(async move {
        let _ = conn.await;
    });

    // Wrap user SQL in a transaction so success/failure semantics are
    // explicit. If the user already supplied BEGIN/COMMIT, batch_execute
    // happily handles nested transactions via Postgres savepoints anyway,
    // but we keep our own wrapper minimal.
    let result = pg_client.batch_execute(&sql).await;
    let duration_ms = started.elapsed().as_millis() as u64;

    match result {
        Ok(()) => Ok(json!({
            "ok": true,
            "output": "applied successfully",
            "durationMs": duration_ms,
        })),
        Err(e) => Ok(json!({
            "ok": false,
            "output": format!("{e}"),
            "durationMs": duration_ms,
        })),
    }
}

// ---------------------------------------------------------------------------
// apply_migration  — write SQL to user's DB after per-call user confirm.
// ---------------------------------------------------------------------------

pub async fn apply_migration_tool(
    ctx: &ServerContext,
    client: &AuthorizedClient,
    args: Value,
) -> Result<Value, McpError> {
    let conn_id = arg_str(&args, "connId")?;
    let sql = arg_str(&args, "sql")?;
    let name = arg_str(&args, "name")?;

    // Synthesise a version from the current timestamp so the ledger row is
    // unique. External agent doesn't need to coordinate — the write-confirm
    // flow ensures the user already saw and approved the SQL.
    let version = chrono::Utc::now().format("%Y%m%d%H%M%S").to_string();
    let checksum = crate::migrations::discovery::checksum_hex(sql.as_bytes());

    await_write_confirm(ctx, client, &sql).await?;

    let pool = resolve_pool(ctx, &conn_id).await?;
    let pg_client = pool
        .get()
        .await
        .map_err(|e| McpError::Internal(format!("pool: {e}")))?;

    let started = Instant::now();
    // Honour the same "no transaction" directive as migrations::executor so
    // CREATE INDEX CONCURRENTLY works.
    if crate::migrations::discovery::has_no_transaction_directive(&sql) {
        pg_client
            .batch_execute(&sql)
            .await
            .map_err(|e| McpError::Internal(format!("apply (raw): {e}")))?;
    } else {
        let wrapped = format!("BEGIN;\n{sql}\nCOMMIT;");
        pg_client
            .batch_execute(&wrapped)
            .await
            .map_err(|e| McpError::Internal(format!("apply (tx): {e}")))?;
    }
    let duration_ms = i64::try_from(started.elapsed().as_millis()).unwrap_or(i64::MAX);

    // Best-effort ledger insert; non-fatal if tracking isn't configured.
    if crate::migrations::tracking::ensure_table(&pg_client)
        .await
        .is_ok()
    {
        let _ = crate::migrations::tracking::insert(
            &pg_client,
            &version,
            &name,
            &checksum,
            duration_ms,
        )
        .await;
    }

    Ok(json!({
        "applied": true,
        "version": version,
        "checksum": checksum,
        "durationMs": u64::try_from(duration_ms).unwrap_or(u64::MAX),
    }))
}

// ---------------------------------------------------------------------------
// Argument-parsing tests + a SELECT-only validator unit test. Network-bound
// tests (real PG via testcontainers) live in `super::tests`.
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_ident_allows_simple_names() {
        validate_ident("public", "schema").unwrap();
        validate_ident("users", "table").unwrap();
        validate_ident("_x9", "table").unwrap();
    }

    #[test]
    fn validate_ident_rejects_injections() {
        assert!(validate_ident("public; DROP TABLE", "schema").is_err());
        assert!(validate_ident("\"quoted\"", "schema").is_err());
        assert!(validate_ident("", "schema").is_err());
        assert!(validate_ident("9start", "schema").is_err());
    }

    #[test]
    fn ensure_select_only_passes_select() {
        ensure_select_only("SELECT 1").unwrap();
        ensure_select_only("SELECT * FROM users").unwrap();
        ensure_select_only("SELECT a FROM t WHERE b > 1").unwrap();
    }

    #[test]
    fn ensure_select_only_rejects_writes() {
        assert!(ensure_select_only("INSERT INTO t VALUES (1)").is_err());
        assert!(ensure_select_only("UPDATE t SET a = 1").is_err());
        assert!(ensure_select_only("DELETE FROM t").is_err());
        assert!(ensure_select_only("CREATE TABLE x (a int)").is_err());
        assert!(ensure_select_only("DROP TABLE x").is_err());
        assert!(ensure_select_only("TRUNCATE x").is_err());
        assert!(ensure_select_only("GRANT SELECT ON t TO u").is_err());
    }

    #[test]
    fn arg_helpers_work() {
        let v = json!({ "connId": "abc", "limit": 5, "buffers": true });
        assert_eq!(arg_str(&v, "connId").unwrap(), "abc");
        assert!(arg_str(&v, "missing").is_err());
        assert_eq!(arg_u64_opt(&v, "limit"), Some(5));
        assert_eq!(arg_u64_opt(&v, "missing"), None);
        assert!(arg_bool(&v, "buffers", false));
        assert!(!arg_bool(&v, "missing", false));
    }
}
