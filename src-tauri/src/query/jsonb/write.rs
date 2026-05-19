//! — JSONB write path.
//!
//! Owns:
//! - `resolve_row_key`: classify a result into PK / Ctid / `ReadOnly` using
//! `RowDescription` metadata (`tokio_postgres::Column::table_oid()` and
//! `column_id()`) — never parses SQL.
//! - `compute_diff`: minimal path-level diff with 8-leaf threshold.
//! - `build_update_sql`: parameterized UPDATE — composed `jsonb_set` /
//! `#-` for ≤8 leaves, full replace otherwise.
//! - `apply`: execute the UPDATE via the cached pool client; honor
//! production guard (typing-confirm token).
//! - `looks_like_single_base_table`: conservative regex used by the cursor
//! path to decide whether ctid wrapping is safe.

// `relkind` arrives from PG as a single-byte `char` — we read it as i8 and
// reinterpret as ASCII u8 to compare with byte literals (b'r' etc.). This
// is a deliberate cross-cast over a single byte and never lossy.
#![allow(    clippy::cast_sign_loss,
    clippy::missing_errors_doc,
    clippy::missing_panics_doc,
    clippy::too_many_lines,
    clippy::doc_markdown
)]

use std::sync::LazyLock;

use deadpool_postgres::Pool;
use regex::Regex;
use serde_json::Value as JsonValue;
use tokio_postgres::types::ToSql;

use crate::connection::types::Environment;
use crate::query::types::{
    JsonbDiff, JsonbOp, JsonbSaveResult, JsonbWriteContext, PkColumn, QueryError, ReadOnlyReason,
    RowKey,
};

/// Threshold above which we switch from composed `jsonb_set`/`#-` to full
/// replace. Chosen so the SQL preview still fits in one line of the modal.
pub const DIFF_OPS_THRESHOLD: usize = 8;

/// Per-column source metadata captured at first-fetch from
/// `tokio_postgres::Column::table_oid()` / `column_id()`. `None` for
/// computed / function-output / NULL columns.
#[derive(Debug, Clone, Copy, Default)]
pub struct ColumnSource {
    pub table_oid: Option<u32>,
    pub attnum: Option<i16>,
}

// ---------------------------------------------------------------------------
// Single-base-table heuristic
// ---------------------------------------------------------------------------

/// Matches `SELECT … FROM <ident>` or `SELECT … FROM <ident>.<ident>` (with
/// optional double-quoting on either part) followed by either end-of-string,
/// a `;`, or a clause keyword (`WHERE`, `ORDER`, `GROUP`, `LIMIT`, `OFFSET`,
/// `FETCH`, `FOR`, `HAVING`, `WINDOW`, `RETURNING`, `UNION`, `INTERSECT`,
/// `EXCEPT`).
///
/// We strip rough disqualifiers (JOIN / UNION / comma in FROM list, WITH
/// prefix, parenthesized FROM target) before running the regex — the regex
/// only handles the bare-relation shape.
static SBT_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(        r#"(?is)^\s*SELECT\s+.+?\s+FROM\s+("[^"]+"|[A-Za-z_][\w\$]*)(\s*\.\s*("[^"]+"|[A-Za-z_][\w\$]*))?\s*(WHERE\b|ORDER\b|GROUP\b|HAVING\b|LIMIT\b|OFFSET\b|FETCH\b|FOR\b|WINDOW\b|RETURNING\b|UNION\b|INTERSECT\b|EXCEPT\b|;|$)"#,
)
    .expect("SBT_RE compiles")
});

/// Conservative regex check for single-base-table SELECTs.
///
/// Returns `true` when `sql` looks like `SELECT … FROM <ident>` or
/// `… FROM <ident>.<ident>` with no JOIN, comma, semicolon (other than at
/// the very end), or subquery in the FROM target. When true, callers may
/// safely use `inject_ctid_column` to rewrite the SELECT-list with an
/// extra `ctid::text AS __ctid__` so the cursor can fall back to
/// ctid-based UPDATE.
///
/// **Conservative on purpose** — false negatives degrade gracefully (no
/// ctid available, but PK path still works); false positives would inject
/// ctid into a query where it breaks semantics, which is dangerous.
#[must_use]
pub fn looks_like_single_base_table(sql: &str) -> bool {
    let trimmed = sql.trim().trim_end_matches(';').trim();
    if trimmed.is_empty() {
        return false;
    }
    // Reject obvious non-base-table queries quickly. The lower-cased copy
    // is only used for ASCII keyword sniffing — it does NOT alter the
    // string we feed to the regex (which is case-insensitive anyway).
    let lower = trimmed.to_ascii_lowercase();
    if lower.starts_with("with ") || lower.starts_with("with\t") || lower.starts_with("with(") {
        return false;
    }
    if lower.contains(" join ")
        || lower.contains("\tjoin\t")
        || lower.contains(" union ")
        || lower.contains(" intersect ")
        || lower.contains(" except ")
    {
        return false;
    }

    // Reject `FROM <something with paren or comma>` early. We look at
    // everything after the first FROM keyword and check the opening
    // sequence — a `(`, `,`, or whitespace-then-`(` means subquery /
    // comma list / paren-wrapped target.
    let from_idx = match lower.find(" from ") {
        Some(idx) => idx,
        None => return false,
    };

    let after = trimmed[from_idx + 6..].trim_start();
    if after.starts_with('(') {
        return false;
    }
    // Reject any comma BEFORE the next clause keyword — that's an
    // implicit cross join in the FROM list.
    let until_clause = next_clause_or_end(after);
    if until_clause.contains(',') {
        return false;
    }

    // (regression fix): ctid injection breaks aggregate /
    // grouped queries. PG complains "<col>.ctid must appear in the
    // GROUP BY clause or be used in an aggregate function" because we
    // adding a non-aggregate column to a select-list that's all
    // aggregates. Reject those queries up-front so the cursor falls
    // back to the no-ctid path (jsonb editing on aggregates wouldn't
    // make sense anyway — there's no underlying row to UPDATE).
    let lower_after_from = &lower[from_idx..];
    if lower_after_from.contains(" group by ") || lower_after_from.contains(" having ") {
        return false;
    }
    let select_head = &lower[..from_idx];
    if select_head_has_aggregate_or_distinct(select_head) {
        return false;
    }

    SBT_RE.is_match(trimmed)
}

/// Scan the lowercased SELECT-list head (everything before FROM) for
/// aggregate-function calls or a top-level DISTINCT. Used to gate ctid
/// injection: an aggregate in the SELECT-list combined with an injected
/// non-aggregate `ctid::text` column produces a PG GROUP BY error.
fn select_head_has_aggregate_or_distinct(head: &str) -> bool {
    if head.contains(" distinct ") || head.starts_with("select distinct ") {
        return true;
    }
    // Common SQL aggregate functions. Match by `name(` form so we don't
    // false-positive on identifiers that merely contain the keyword.
    // Conservative — listing only the functions that always aggregate;
    // user-defined aggregates aren't covered, but the cursor degrades
    // gracefully (no ctid path, PK still works).
    const AGGREGATES: &[&str] = &[
        "count(",
        "sum(",
        "avg(",
        "min(",
        "max(",
        "bool_and(",
        "bool_or(",
        "every(",
        "array_agg(",
        "string_agg(",
        "json_agg(",
        "jsonb_agg(",
        "json_object_agg(",
        "jsonb_object_agg(",
        "stddev(",
        "stddev_pop(",
        "stddev_samp(",
        "variance(",
        "var_pop(",
        "var_samp(",
        "corr(",
        "covar_pop(",
        "covar_samp(",
        "regr_avgx(",
        "regr_avgy(",
        "regr_count(",
        "regr_intercept(",
        "regr_r2(",
        "regr_slope(",
        "regr_sxx(",
        "regr_sxy(",
        "regr_syy(",
    ];
    for kw in AGGREGATES {
        if head.contains(kw) {
            return true;
        }
    }
    false
}

fn next_clause_or_end(s: &str) -> &str {
    let lower = s.to_ascii_lowercase();
    let mut end = s.len();
    for kw in [
        " where ",
        " order ",
        " group ",
        " having ",
        " limit ",
        " offset ",
        " fetch ",
        " for ",
        " window ",
        " returning ",
        " union ",
        " intersect ",
        " except ",
        ";",
    ] {
        if let Some(idx) = lower.find(kw) {
            if idx < end {
                end = idx;
            }
        }
    }
    &s[..end]
}

/// Find the byte index of the first top-level `FROM` keyword in `sql`,
/// skipping over single-quoted string literals, double-quoted identifiers,
/// `--` line comments, and `/* … */` block comments. Returns `None` if no
/// top-level `FROM` is found. Word-boundary aware: only matches when
/// preceded and followed by non-identifier characters.
const fn is_ident_byte(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_' || b == b'$'
}

fn find_top_level_from(sql: &str) -> Option<usize> {
    let bytes = sql.as_bytes();
    let n = bytes.len();
    let mut i = 0usize;

    while i < n {
        let b = bytes[i];

        // Single-quoted string literal — `''` is the doubled-quote escape.
        if b == b'\'' {
            i += 1;
            while i < n {
                if bytes[i] == b'\'' {
                    if i + 1 < n && bytes[i + 1] == b'\'' {
                        i += 2;
                        continue;
                    }
                    i += 1;
                    break;
                }
                i += 1;
            }
            continue;
        }

        // Double-quoted identifier — `""` is the doubled-quote escape.
        if b == b'"' {
            i += 1;
            while i < n {
                if bytes[i] == b'"' {
                    if i + 1 < n && bytes[i + 1] == b'"' {
                        i += 2;
                        continue;
                    }
                    i += 1;
                    break;
                }
                i += 1;
            }
            continue;
        }

        // Line comment.
        if b == b'-' && i + 1 < n && bytes[i + 1] == b'-' {
            i += 2;
            while i < n && bytes[i] != b'\n' {
                i += 1;
            }
            continue;
        }

        // Block comment (non-nested — Postgres does support nesting, but
        // for ide99 SBT detection a flat skip is enough; we already
        // reject anything containing `/*` paired with internal nesting in
        // practice via the conservative SBT regex).
        if b == b'/' && i + 1 < n && bytes[i + 1] == b'*' {
            i += 2;
            while i + 1 < n && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                i += 1;
            }
            i = (i + 2).min(n);
            continue;
        }

        // FROM keyword (case-insensitive, word-bounded).
        if (b == b'F' || b == b'f')
            && i + 4 <= n
            && bytes[i..i + 4].eq_ignore_ascii_case(b"FROM")
            && (i == 0 || !is_ident_byte(bytes[i - 1]))
            && (i + 4 == n || !is_ident_byte(bytes[i + 4]))
        {
            return Some(i);
        }

        i += 1;
    }

    None
}

/// Rewrite `sql`'s SELECT-list to include `, ctid::text AS __ctid__` so the
/// cursor can stash row identifiers per-row. Caller MUST first verify the
/// SQL passes `looks_like_single_base_table`.
///
/// Only injects when:
/// - we can find the first top-level `FROM` keyword (skipping quoted strings,
/// double-quoted identifiers, and comments), AND
/// - the SQL doesn't already select a column literally named `__ctid__`
/// (idempotent / collision-safe).
///
/// Returns `None` if injection isn't safe — caller should fall back to the
/// no-ctid path (PK-only saves still work; ctid-based saves on this cursor
/// will not be available).
#[must_use]
pub fn inject_ctid_column(sql: &str) -> Option<String> {
    if sql.contains("__ctid__") {
        return None;
    }
    let from_idx = find_top_level_from(sql)?;
    // Trim trailing whitespace from the SELECT-list portion so the comma
    // attaches cleanly.
    let head = sql[..from_idx].trim_end();
    let tail = &sql[from_idx..];
    if head.is_empty() {
        return None;
    }
    Some(format!("{head}, ctid::text AS __ctid__ {tail}"))
}

// ---------------------------------------------------------------------------
// resolve_row_key
// ---------------------------------------------------------------------------

/// Resolve the row key for `result_row[row_idx]` in a cursor that captured
/// `column_sources` at first-fetch time.
///
/// # Errors
///
/// Returns `QueryError::PoolError` / `PostgresError` when catalog lookups fail.
pub async fn resolve_row_key(    pool: &Pool,
    column_sources: &[ColumnSource],
    column_names: &[String],
    row_values: &[Option<String>],
    ctid_value: Option<&str>,
) -> Result<RowKey, QueryError> {
    let _ = column_names; // not used (we go via attnum), but kept for symmetry

    // 1) Reduce column_sources to a single distinct table_oid.
    let mut oids: Vec<u32> = column_sources.iter().filter_map(|s| s.table_oid).collect();
    oids.sort_unstable();
    oids.dedup();
    let table_oid = match oids.as_slice() {
        [] => {
            return Ok(RowKey::ReadOnly {
                reason: ReadOnlyReason::NoBaseTable,
            });
        }
        [single] => *single,
        _ => {
            return Ok(RowKey::ReadOnly {
                reason: ReadOnlyReason::MultipleTables,
            });
        }
    };

    // 2) Resolve schema/table + relkind via pg_class + pg_namespace.
    let client = pool.get().await.map_err(|e| QueryError::PoolError {
        message: e.to_string(),
    })?;
    let row = client
        .query_opt(            "SELECT n.nspname, c.relname, c.relkind FROM pg_class c \
             JOIN pg_namespace n ON c.relnamespace = n.oid WHERE c.oid::int8 = $1",
            &[&i64::from(table_oid)],
)
        .await
        .map_err(|e| map_pg_err(&e))?;
    let Some(row) = row else {
        return Ok(RowKey::ReadOnly {
            reason: ReadOnlyReason::NoBaseTable,
        });
    };
    let schema: String = row.get(0);
    let table: String = row.get(1);
    // pg_class.relkind is `char` (a single byte), comes through as i8.
    let relkind: i8 = row.get(2);
    let relkind_byte = relkind as u8;
    match relkind_byte {
        b'r' | b'p' | b'v' => { /* proceed */ }
        b'm' => {
            return Ok(RowKey::ReadOnly {
                reason: ReadOnlyReason::Matview,
            });
        }
        b'f' => {
            return Ok(RowKey::ReadOnly {
                reason: ReadOnlyReason::ForeignTable,
            });
        }
        _ => {
            return Ok(RowKey::ReadOnly {
                reason: ReadOnlyReason::NoBaseTable,
            });
        }
    }

    // 3) Lookup PK columns (attnum + type) from pg_constraint + pg_attribute.
    let pk_rows = client
        .query(            "SELECT a.attnum, a.attname, format_type(a.atttypid, a.atttypmod) AS type_name \
             FROM pg_constraint con \
             JOIN unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord) ON true \
             JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum \
             WHERE con.contype = 'p' AND con.conrelid::int8 = $1 \
             ORDER BY k.ord",
            &[&i64::from(table_oid)],
)
        .await
        .map_err(|e| map_pg_err(&e))?;

    if !pk_rows.is_empty() {
        let mut pk_cols: Vec<PkColumn> = Vec::with_capacity(pk_rows.len());
        let mut needs_refetch = false;
        for r in &pk_rows {
            let attnum: i16 = r.get(0);
            let attname: String = r.get(1);
            let type_name: String = r.get(2);
            // Find this PK col in our result.
            let idx = column_sources
                .iter()
                .position(|s| s.table_oid == Some(table_oid) && s.attnum == Some(attnum));
            if let Some(i) = idx {
                pk_cols.push(PkColumn {
                    name: attname,
                    value: row_values.get(i).cloned().flatten(),
                    type_name: short_type(&type_name),
                });
            } else {
                needs_refetch = true;
                pk_cols.push(PkColumn {
                    name: attname,
                    value: None, // filled below from ctid re-fetch
                    type_name: short_type(&type_name),
                });
            }
        }

        if needs_refetch {
            let ctid = ctid_value.ok_or(QueryError::ReadOnlyResult {
                reason: ReadOnlyReason::ViewWithoutPk,
            })?;
            let cols_sql = pk_cols
                .iter()
                .map(|c| quote_ident(&c.name))
                .collect::<Vec<_>>()
                .join(", ");
            let sql = format!(                "SELECT {cols_sql} FROM {}.{} WHERE ctid = $1::text::tid",
                quote_ident(&schema),
                quote_ident(&table),
);
            let r = client
                .query_one(&sql, &[&ctid])
                .await
                .map_err(|e| map_pg_err(&e))?;
            for (i, col) in pk_cols.iter_mut().enumerate() {
                col.value = crate::query::format::cell_to_string(&r, i);
            }
        }

        return Ok(RowKey::Pk {
            schema,
            table,
            columns: pk_cols,
        });
    }

    // 4) No PK: heap → ctid; view → ReadOnly; partition → ReadOnly.
    let reason = match relkind_byte {
        b'r' => {
            return Ok(ctid_value.map_or(                RowKey::ReadOnly {
                    reason: ReadOnlyReason::ViewWithoutPk,
                },
                |ctid| RowKey::Ctid {
                    schema,
                    table,
                    ctid: ctid.into(),
                },
));
        }
        b'v' => ReadOnlyReason::ViewWithoutPk,
        b'p' => ReadOnlyReason::PartitionedNoPk,
        _ => ReadOnlyReason::NoBaseTable,
    };
    Ok(RowKey::ReadOnly { reason })
}

fn map_pg_err(e: &tokio_postgres::Error) -> QueryError {
    QueryError::PostgresError {
        message: e
            .as_db_error()
            .map_or_else(|| e.to_string(), ToString::to_string),
        position: None,
        sqlstate: e.as_db_error().map(|d| d.code().code().to_string()),
    }
}

/// Strip `format_type` extras (e.g., `character varying(255)` → `varchar`)
/// to a short PG type name suitable for `$N::<type>` binding.
fn short_type(name: &str) -> String {
    let lower = name.to_ascii_lowercase();
    let base = lower.split('(').next().unwrap_or(&lower).trim();
    match base {
        "character varying" => "varchar".into(),
        "character" => "bpchar".into(),
        "double precision" => "float8".into(),
        "timestamp without time zone" => "timestamp".into(),
        "timestamp with time zone" => "timestamptz".into(),
        "time without time zone" => "time".into(),
        "time with time zone" => "timetz".into(),
        s if s.starts_with("numeric") => "numeric".into(),
        s => s.into(),
    }
}

pub(super) fn quote_ident(s: &str) -> String {
    format!("\"{}\"", s.replace('"', "\"\""))
}

// ---------------------------------------------------------------------------
// compute_diff
// ---------------------------------------------------------------------------

const fn json_type_tag(v: &JsonValue) -> u8 {
    match v {
        JsonValue::Null => 0,
        JsonValue::Bool(_) => 1,
        JsonValue::Number(_) => 2,
        JsonValue::String(_) => 3,
        JsonValue::Array(_) => 4,
        JsonValue::Object(_) => 5,
    }
}

fn diff_walk(    path: &mut Vec<String>,
    old: &JsonValue,
    new: &JsonValue,
    ops: &mut Vec<JsonbOp>,
    overflow: &mut bool,
) {
    if *overflow {
        return;
    }
    match (old, new) {
        (JsonValue::Object(a), JsonValue::Object(b)) => {
            for (k, v_old) in a {
                if *overflow {
                    return;
                }
                path.push(k.clone());
                if let Some(v_new) = b.get(k) {
                    diff_walk(path, v_old, v_new, ops, overflow);
                } else {
                    ops.push(JsonbOp::Delete { path: path.clone() });
                    if ops.len() > DIFF_OPS_THRESHOLD {
                        *overflow = true;
                    }
                }
                path.pop();
            }
            for (k, v_new) in b {
                if *overflow {
                    return;
                }
                if !a.contains_key(k) {
                    path.push(k.clone());
                    ops.push(JsonbOp::Set {
                        path: path.clone(),
                        value: v_new.clone(),
                    });
                    if ops.len() > DIFF_OPS_THRESHOLD {
                        *overflow = true;
                    }
                    path.pop();
                }
            }
        }
        (JsonValue::Array(a), JsonValue::Array(b)) => {
            if a.len() != b.len() {
                // Length changed: array index paths become unstable.
                // Caller below converts to full_replace.
                *overflow = true;
                return;
            }
            for (i, (v_old, v_new)) in a.iter().zip(b.iter()).enumerate() {
                if *overflow {
                    return;
                }
                path.push(i.to_string());
                diff_walk(path, v_old, v_new, ops, overflow);
                path.pop();
            }
        }
        (l, r) if l == r => {}
        (_, r) => {
            ops.push(JsonbOp::Set {
                path: path.clone(),
                value: r.clone(),
            });
            if ops.len() > DIFF_OPS_THRESHOLD {
                *overflow = true;
            }
        }
    }
}

/// Compute a minimal diff between two parsed JSON values.
///
/// Threshold = `DIFF_OPS_THRESHOLD`. Above the threshold (or on root-type
/// change / array-length change) the diff degrades to a `full_replace`.
#[must_use]
pub fn compute_diff(old: &JsonValue, new: &JsonValue) -> JsonbDiff {
    if json_type_tag(old) != json_type_tag(new) {
        return JsonbDiff {
            ops: Vec::new(),
            full_replace: true,
            full_value: Some(new.clone()),
        };
    }

    if !matches!(old, JsonValue::Object(_) | JsonValue::Array(_)) {
        if old != new {
            return JsonbDiff {
                ops: Vec::new(),
                full_replace: true,
                full_value: Some(new.clone()),
            };
        }
        return JsonbDiff {
            ops: Vec::new(),
            full_replace: false,
            full_value: None,
        };
    }

    let mut ops: Vec<JsonbOp> = Vec::new();
    let mut overflow = false;
    let mut path: Vec<String> = Vec::new();
    diff_walk(&mut path, old, new, &mut ops, &mut overflow);

    if overflow {
        JsonbDiff {
            ops: Vec::new(),
            full_replace: true,
            full_value: Some(new.clone()),
        }
    } else {
        JsonbDiff {
            ops,
            full_replace: false,
            full_value: None,
        }
    }
}

// ---------------------------------------------------------------------------
// build_update_sql
// ---------------------------------------------------------------------------

/// Parameter shapes accepted by `apply`. JSONB params go through
/// `serde_json::Value`; PK params come back as the same string we read
/// from the result + a type name we cast on the SQL side.
#[derive(Debug, Clone)]
pub enum JsonbParam {
    /// `$N::jsonb` from a `serde_json::Value`.
    Jsonb(JsonValue),
    /// `$N::text[]` from a path vector.
    TextArray(Vec<String>),
    /// PK value — `$N::<typeName>` so postgres re-parses on the server.
    /// Avoids us needing to translate every PG type into a Rust `ToSql` impl.
    PkText {
        value: Option<String>,
        type_name: String,
    },
}

/// Build a parameterized UPDATE for the given row + diff.
///
/// Returns `(sql_text, params, sql_for_display)`. The `display` form inlines
/// parameter values for the diff-preview pane (the executed SQL stays
/// parameterized). Identifier quoting handles embedded `"` (escaped to `""`).
#[must_use]
pub fn build_update_sql(    row_key: &RowKey,
    column: &str,
    diff: &JsonbDiff,
) -> (String, Vec<JsonbParam>, String) {
    let mut params: Vec<JsonbParam> = Vec::new();

    // SET clause.
    let (set_sql, set_display) = if diff.full_replace {
        let val = diff.full_value.clone().unwrap_or(JsonValue::Null);
        let display = format!("'{}'::jsonb", json_lit_escape(&val));
        params.push(JsonbParam::Jsonb(val));
        (            format!("{} = $1::jsonb", quote_ident(column)),
            format!("{} = {}", quote_ident(column), display),
)
    } else {
        // Composed path. Start from `<column>` and wrap.
        let mut expr = quote_ident(column);
        let mut display_expr = quote_ident(column);
        for op in &diff.ops {
            match op {
                JsonbOp::Set { path, value } => {
                    let path_idx = params.len() + 1;
                    params.push(JsonbParam::TextArray(path.clone()));
                    let val_idx = params.len() + 1;
                    params.push(JsonbParam::Jsonb(value.clone()));
                    expr =
                        format!("jsonb_set({expr}, ${path_idx}::text[], ${val_idx}::jsonb, true)");
                    display_expr = format!(                        "jsonb_set({display_expr}, ARRAY[{}]::text[], '{}'::jsonb, true)",
                        path_lit(path),
                        json_lit_escape(value),
);
                }
                JsonbOp::Delete { path } => {
                    let idx = params.len() + 1;
                    params.push(JsonbParam::TextArray(path.clone()));
                    expr = format!("{expr} #- ${idx}::text[]");
                    display_expr = format!("{display_expr} #- ARRAY[{}]::text[]", path_lit(path));
                }
            }
        }
        (            format!("{} = {expr}", quote_ident(column)),
            format!("{} = {display_expr}", quote_ident(column)),
)
    };

    // WHERE clause.
    let (where_sql, where_display) = match row_key {
        RowKey::Pk { columns, .. } => {
            let mut parts: Vec<String> = Vec::new();
            let mut display_parts: Vec<String> = Vec::new();
            for col in columns {
                match &col.value {
                    None => {
                        let q = quote_ident(&col.name);
                        parts.push(format!("{q} IS NULL"));
                        display_parts.push(format!("{q} IS NULL"));
                    }
                    Some(v) => {
                        let idx = params.len() + 1;
                        params.push(JsonbParam::PkText {
                            value: Some(v.clone()),
                            type_name: col.type_name.clone(),
                        });
                        // Double-cast (`$N::text::<type>`) forces PG to
                        // infer the parameter as `text` (we always bind
                        // String) and then re-cast to the column type
                        // server-side. With a single `$N::<type>` cast
                        // PG infers the parameter type as the column
                        // type directly (e.g. int4) and rejects the
                        // String binding with "error serializing
                        // parameter".
                        parts.push(format!(                            "{} = ${idx}::text::{}",
                            quote_ident(&col.name),
                            col.type_name,
));
                        display_parts.push(format!(                            "{} = {}",
                            quote_ident(&col.name),
                            display_pk_lit(v, &col.type_name),
));
                    }
                }
            }
            (parts.join(" AND "), display_parts.join(" AND "))
        }
        RowKey::Ctid { ctid, .. } => {
            let idx = params.len() + 1;
            params.push(JsonbParam::PkText {
                value: Some(ctid.clone()),
                type_name: "tid".into(),
            });
            (                format!("ctid = ${idx}::text::tid"),
                format!("ctid = '{}'::tid", ctid.replace('\'', "''")),
)
        }
        RowKey::ReadOnly { .. } => (            "FALSE /* read-only */".to_string(),
            "FALSE /* read-only */".to_string(),
),
    };

    let table_qualified = match row_key {
        RowKey::Pk { schema, table, .. } | RowKey::Ctid { schema, table, .. } => {
            format!("{}.{}", quote_ident(schema), quote_ident(table))
        }
        RowKey::ReadOnly { .. } => quote_ident("__readonly__"),
    };

    let sql = format!("UPDATE {table_qualified} SET {set_sql} WHERE {where_sql}");
    let display = format!("UPDATE {table_qualified} SET {set_display} WHERE {where_display}");

    (sql, params, display)
}

/// Render a `Vec<String>` path as comma-separated single-quoted SQL literals.
fn path_lit(path: &[String]) -> String {
    path.iter()
        .map(|p| format!("'{}'", p.replace('\'', "''")))
        .collect::<Vec<_>>()
        .join(",")
}

/// Render a JSON value into the form we use for the `display` SQL preview —
/// embed inside single quotes after escaping `'` as `''`.
fn json_lit_escape(v: &JsonValue) -> String {
    serde_json::to_string(v)
        .unwrap_or_else(|_| "null".into())
        .replace('\'', "''")
}

/// Render a PK literal for the display SQL. Numeric / boolean PG types
/// don't need quotes; everything else gets single-quoted.
fn display_pk_lit(value: &str, type_name: &str) -> String {
    let numeric_or_bool = matches!(        type_name,
        "int2"
            | "int4"
            | "int8"
            | "float4"
            | "float8"
            | "numeric"
            | "bool"
            | "oid"
            | "smallint"
            | "integer"
            | "bigint"
);
    if numeric_or_bool {
        value.to_string()
    } else {
        format!("'{}'", value.replace('\'', "''"))
    }
}

// ---------------------------------------------------------------------------
// apply (executor + production guard)
// ---------------------------------------------------------------------------

/// Execute the `build_update_sql` output, honoring the production guard.
///
/// When `env == Environment::Prod`, requires `ctx.confirmed_table_name` to
/// match the FQ table name case-insensitively, else `ProductionGuardFailed`.
///
/// # Errors
///
/// Returns `QueryError::ProductionGuardFailed` / `ReadOnlyResult` /
/// `PostgresError` / `RowVanished` per spec §7.
pub async fn apply(    pool: &Pool,
    env: Environment,
    ctx: &JsonbWriteContext,
    diff: &JsonbDiff,
) -> Result<JsonbSaveResult, QueryError> {
    // Refuse ReadOnly up-front.
    let (schema, table) = match &ctx.row_key {
        RowKey::Pk { schema, table, .. } | RowKey::Ctid { schema, table, .. } => {
            (schema.clone(), table.clone())
        }
        RowKey::ReadOnly { reason } => {
            return Err(QueryError::ReadOnlyResult { reason: *reason });
        }
    };
    let fq = format!("{schema}.{table}");

    // Production guard.
    if env == Environment::Prod {
        let received = ctx.confirmed_table_name.as_deref();
        let matches = received.is_some_and(|r| r.eq_ignore_ascii_case(&fq));
        if !matches {
            return Err(QueryError::ProductionGuardFailed {
                expected: fq,
                received: received.map(str::to_owned),
            });
        }
    }

    // Defense-in-depth: re-validate old/new are JSON.
    let _: JsonValue =
        serde_json::from_str(&ctx.old_value).map_err(|e| QueryError::JsonbParseError {
            message: format!("old_value: {e}"),
        })?;
    let _: JsonValue =
        serde_json::from_str(&ctx.new_value).map_err(|e| QueryError::JsonbParseError {
            message: format!("new_value: {e}"),
        })?;

    // No-op: nothing to do.
    if diff.ops.is_empty() && !diff.full_replace {
        return Ok(JsonbSaveResult {
            sql_executed: String::new(),
            affected_rows: 0,
            duration_ms: 0,
            new_cell_value: ctx.new_value.clone(),
        });
    }

    let (sql, params, display) = build_update_sql(&ctx.row_key, &ctx.column, diff);
    let client = pool.get().await.map_err(|e| QueryError::PoolError {
        message: e.to_string(),
    })?;

    let started = std::time::Instant::now();

    // Bind params via type-erased trait objects. JSONB binds as
    // `serde_json::Value` (tokio-postgres has `with-serde_json-1` feature
    // enabled). Path arrays bind as `Vec<String>` (text[]). PK values
    // bind as `Option<String>` and rely on `$N::<type>` casts on the
    // SQL side to coerce to the column type.
    let mut bound: Vec<Box<dyn ToSql + Sync + Send>> = Vec::with_capacity(params.len());
    for p in &params {
        match p {
            JsonbParam::Jsonb(v) => bound.push(Box::new(v.clone())),
            JsonbParam::TextArray(arr) => bound.push(Box::new(arr.clone())),
            JsonbParam::PkText { value, .. } => bound.push(Box::new(value.clone())),
        }
    }
    let refs: Vec<&(dyn ToSql + Sync)> = bound
        .iter()
        .map(|b| b.as_ref() as &(dyn ToSql + Sync))
        .collect();

    let affected = client
        .execute(sql.as_str(), &refs[..])
        .await
        .map_err(|e| map_pg_err(&e))?;

    if affected == 0 {
        return Err(QueryError::RowVanished);
    }

    Ok(JsonbSaveResult {
        sql_executed: display,
        affected_rows: affected,
        duration_ms: u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX),
        new_cell_value: ctx.new_value.clone(),
    })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::{
        build_update_sql, compute_diff, inject_ctid_column, looks_like_single_base_table,
        JsonbParam, DIFF_OPS_THRESHOLD,
    };
    use crate::query::types::{JsonbDiff, JsonbOp, PkColumn, RowKey};
    use serde_json::json;

    // ---------------- SBT detector ----------------

    #[test]
    fn sbt_detects_simple_select() {
        assert!(looks_like_single_base_table("SELECT * FROM events"));
        assert!(looks_like_single_base_table(            "SELECT id, data FROM public.events WHERE id = 1"
));
        assert!(looks_like_single_base_table("SELECT * FROM \"Events\""));
        assert!(looks_like_single_base_table(            "SELECT * FROM public.events ORDER BY id LIMIT 10"
));
        assert!(looks_like_single_base_table("SELECT 1 FROM events;"));
    }

    #[test]
    fn sbt_rejects_join_union_subquery() {
        assert!(!looks_like_single_base_table(            "SELECT * FROM events e JOIN users u ON e.uid = u.id"
));
        assert!(!looks_like_single_base_table(            "SELECT * FROM events UNION SELECT * FROM logs"
));
        assert!(!looks_like_single_base_table("SELECT * FROM events, users"));
        assert!(!looks_like_single_base_table(            "SELECT * FROM (SELECT * FROM events) e"
));
        assert!(!looks_like_single_base_table(            "WITH x AS (SELECT 1) SELECT * FROM x"
));
        assert!(!looks_like_single_base_table("SELECT 1"));
        assert!(!looks_like_single_base_table(""));
    }

    #[test]
    fn sbt_rejects_aggregates_and_grouping() {
        // Regression: ctid injection would add a non-aggregate column to a
        // SELECT-list of aggregates, triggering PG's "must appear in the
        // GROUP BY clause" error. Detector must keep these out of the
        // injection path.
        assert!(!looks_like_single_base_table("SELECT count(*) FROM events"));
        assert!(!looks_like_single_base_table("SELECT COUNT(*) FROM events"));
        assert!(!looks_like_single_base_table(            "SELECT sum(amount) FROM orders"
));
        assert!(!looks_like_single_base_table(            "SELECT avg(score) FROM stats"
));
        assert!(!looks_like_single_base_table(            "SELECT max(created_at), min(created_at) FROM events"
));
        assert!(!looks_like_single_base_table(            "SELECT type, count(*) FROM events GROUP BY type"
));
        assert!(!looks_like_single_base_table(            "SELECT type FROM events GROUP BY type HAVING count(*) > 1"
));
        assert!(!looks_like_single_base_table(            "SELECT DISTINCT type FROM events"
));
        assert!(!looks_like_single_base_table(            "SELECT array_agg(id) FROM events"
));
        assert!(!looks_like_single_base_table(            "SELECT json_agg(data) FROM events"
));
        // Regular non-aggregate SELECTs still pass.
        assert!(looks_like_single_base_table("SELECT * FROM events"));
        assert!(looks_like_single_base_table(            "SELECT id, data FROM events WHERE id = 1"
));
    }

    // ---------------- inject_ctid_column ----------------

    #[test]
    fn inject_ctid_into_select_star() {
        let out = inject_ctid_column("SELECT * FROM events").unwrap();
        assert_eq!(out, "SELECT *, ctid::text AS __ctid__ FROM events");
    }

    #[test]
    fn inject_ctid_into_explicit_columns() {
        let out = inject_ctid_column("SELECT id, data FROM events WHERE id = 1").unwrap();
        assert_eq!(            out,
            "SELECT id, data, ctid::text AS __ctid__ FROM events WHERE id = 1"
);
    }

    #[test]
    fn inject_ctid_preserves_order_limit_and_schema_qualified() {
        let out = inject_ctid_column("SELECT * FROM public.events ORDER BY id LIMIT 10").unwrap();
        assert_eq!(            out,
            "SELECT *, ctid::text AS __ctid__ FROM public.events ORDER BY id LIMIT 10"
);
    }

    #[test]
    fn inject_ctid_preserves_double_quoted_identifier() {
        let out = inject_ctid_column(r#"SELECT * FROM "Events""#).unwrap();
        assert_eq!(out, r#"SELECT *, ctid::text AS __ctid__ FROM "Events""#);
    }

    #[test]
    fn inject_ctid_skips_string_literal_with_from_keyword() {
        // The SELECT-list contains 'FROM' as a string literal — must NOT
        // be treated as the FROM clause. Real FROM follows.
        let out = inject_ctid_column("SELECT 'FROM clause' AS lit FROM events").unwrap();
        assert_eq!(            out,
            "SELECT 'FROM clause' AS lit, ctid::text AS __ctid__ FROM events"
);
    }

    #[test]
    fn inject_ctid_skips_line_comment_with_from_keyword() {
        let out = inject_ctid_column("SELECT id -- FROM hint\n FROM events").unwrap();
        assert!(out.contains(", ctid::text AS __ctid__ "));
        assert!(out.contains("FROM events"));
        // Make sure injection didn't land inside the comment.
        let inj = out.find(", ctid::text AS __ctid__ ").unwrap();
        let real_from = out.rfind("FROM events").unwrap();
        assert!(inj < real_from);
    }

    #[test]
    fn inject_ctid_skips_block_comment() {
        let out = inject_ctid_column("SELECT id /* FROM faked */ FROM events").unwrap();
        assert!(out.contains("FROM events"));
        assert!(out.contains(", ctid::text AS __ctid__ "));
    }

    #[test]
    fn inject_ctid_returns_none_when_already_present() {
        // Idempotent — caller never double-injects.
        assert!(inject_ctid_column("SELECT *, ctid AS __ctid__ FROM events").is_none());
    }

    #[test]
    fn inject_ctid_returns_none_without_from() {
        assert!(inject_ctid_column("SELECT 1").is_none());
        assert!(inject_ctid_column("").is_none());
    }

    // ---------------- compute_diff ----------------

    #[test]
    fn diff_identical_inputs_is_empty() {
        let v = json!({"a": 1, "b": "x"});
        let d = compute_diff(&v, &v);
        assert!(d.ops.is_empty());
        assert!(!d.full_replace);
        assert!(d.full_value.is_none());
    }

    #[test]
    fn diff_single_leaf_change_emits_one_set() {
        let old = json!({"a": 1, "b": "x"});
        let new = json!({"a": 1, "b": "y"});
        let d = compute_diff(&old, &new);
        assert_eq!(d.ops.len(), 1);
        match &d.ops[0] {
            JsonbOp::Set { path, value } => {
                assert_eq!(path, &vec!["b".to_string()]);
                assert_eq!(value, &json!("y"));
            }
            JsonbOp::Delete { .. } => panic!("expected Set"),
        }
    }

    #[test]
    fn diff_deep_nested_path() {
        let old = json!({"a": {"b": {"c": 1}}});
        let new = json!({"a": {"b": {"c": 2}}});
        let d = compute_diff(&old, &new);
        assert_eq!(d.ops.len(), 1);
        match &d.ops[0] {
            JsonbOp::Set { path, .. } => {
                assert_eq!(path, &vec!["a".to_string(), "b".into(), "c".into()]);
            }
            JsonbOp::Delete { .. } => panic!(),
        }
    }

    #[test]
    fn diff_add_key_emits_set() {
        let old = json!({"a": 1});
        let new = json!({"a": 1, "b": 2});
        let d = compute_diff(&old, &new);
        assert_eq!(d.ops.len(), 1);
        assert!(matches!(&d.ops[0], JsonbOp::Set { path, .. } if path == &vec!["b".to_string()]));
    }

    #[test]
    fn diff_delete_key_emits_delete() {
        let old = json!({"a": 1, "b": 2});
        let new = json!({"a": 1});
        let d = compute_diff(&old, &new);
        assert_eq!(d.ops.len(), 1);
        assert!(matches!(&d.ops[0], JsonbOp::Delete { path } if path == &vec!["b".to_string()]));
    }

    #[test]
    fn diff_threshold_triggers_full_replace() {
        let old = json!({
            "a":1,"b":1,"c":1,"d":1,"e":1,"f":1,"g":1,"h":1,"i":1
        });
        let new = json!({
            "a":2,"b":2,"c":2,"d":2,"e":2,"f":2,"g":2,"h":2,"i":2
        });
        let d = compute_diff(&old, &new);
        assert!(d.full_replace);
        assert!(d.ops.is_empty());
        assert_eq!(d.full_value.as_ref().unwrap(), &new);
    }

    #[test]
    fn diff_root_type_change_full_replace() {
        let old = json!({"a": 1});
        let new = json!([1, 2, 3]);
        let d = compute_diff(&old, &new);
        assert!(d.full_replace);
        assert_eq!(d.full_value.as_ref().unwrap(), &new);
    }

    #[test]
    fn diff_array_length_change_full_replace() {
        let old = json!({"items": [1, 2, 3]});
        let new = json!({"items": [1, 2, 3, 4]});
        let d = compute_diff(&old, &new);
        assert!(d.full_replace);
    }

    #[test]
    fn diff_root_scalar_change_full_replace() {
        let old = json!("hello");
        let new = json!("world");
        let d = compute_diff(&old, &new);
        assert!(d.full_replace);
    }

    #[test]
    fn diff_object_reorder_same_kv_is_empty() {
        let old: serde_json::Value = serde_json::from_str(r#"{"a":1,"b":2}"#).unwrap();
        let new: serde_json::Value = serde_json::from_str(r#"{"b":2,"a":1}"#).unwrap();
        let d = compute_diff(&old, &new);
        assert!(d.ops.is_empty());
        assert!(!d.full_replace);
    }

    // ---------------- build_update_sql ----------------

    #[test]
    fn build_update_full_replace_with_pk() {
        let rk = RowKey::Pk {
            schema: "public".into(),
            table: "events".into(),
            columns: vec![PkColumn {
                name: "id".into(),
                value: Some("42".into()),
                type_name: "int4".into(),
            }],
        };
        let diff = JsonbDiff {
            ops: vec![],
            full_replace: true,
            full_value: Some(serde_json::json!({"a": 1})),
        };
        let (sql, params, display) = build_update_sql(&rk, "data", &diff);
        assert_eq!(            sql,
            r#"UPDATE "public"."events" SET "data" = $1::jsonb WHERE "id" = $2::text::int4"#
);
        assert_eq!(params.len(), 2);
        assert!(matches!(params[0], JsonbParam::Jsonb(_)));
        assert!(            matches!(&params[1], JsonbParam::PkText { value: Some(v), type_name } if v == "42" && type_name == "int4")
);
        assert!(display.contains("'{\"a\":1}'") || display.contains("'{\"a\": 1}'"));
        assert!(display.contains("\"id\" = 42"));
    }

    #[test]
    fn build_update_composed_with_ctid() {
        let rk = RowKey::Ctid {
            schema: "public".into(),
            table: "events".into(),
            ctid: "(0,5)".into(),
        };
        let diff = JsonbDiff {
            ops: vec![
                JsonbOp::Set {
                    path: vec!["theme".into()],
                    value: serde_json::json!("dark"),
                },
                JsonbOp::Delete {
                    path: vec!["legacy".into()],
                },
            ],
            full_replace: false,
            full_value: None,
        };
        let (sql, params, _display) = build_update_sql(&rk, "data", &diff);
        assert!(sql.starts_with(r#"UPDATE "public"."events" SET "data" = "#));
        assert!(sql.contains("jsonb_set"));
        assert!(sql.contains("#-"));
        assert!(sql.ends_with("WHERE ctid = $4::text::tid"));
        assert_eq!(params.len(), 4);
    }

    #[test]
    fn build_update_pk_with_null_uses_is_null() {
        let rk = RowKey::Pk {
            schema: "public".into(),
            table: "events".into(),
            columns: vec![
                PkColumn {
                    name: "tenant_id".into(),
                    value: None,
                    type_name: "int4".into(),
                },
                PkColumn {
                    name: "id".into(),
                    value: Some("42".into()),
                    type_name: "int4".into(),
                },
            ],
        };
        let diff = JsonbDiff {
            ops: vec![],
            full_replace: true,
            full_value: Some(serde_json::json!(1)),
        };
        let (sql, params, _) = build_update_sql(&rk, "data", &diff);
        assert!(sql.contains(r#""tenant_id" IS NULL"#));
        assert!(sql.contains(r#""id" = $2::text::int4"#));
        assert_eq!(params.len(), 2); // jsonb + 1 non-null pk
    }

    #[test]
    fn build_update_quotes_identifiers() {
        let rk = RowKey::Pk {
            schema: r#"weird"sch"#.into(),
            table: "weird;tbl".to_string(),
            columns: vec![PkColumn {
                name: r#"id"col"#.into(),
                value: Some("1".into()),
                type_name: "int4".into(),
            }],
        };
        let diff = JsonbDiff {
            ops: vec![],
            full_replace: true,
            full_value: Some(serde_json::json!(null)),
        };
        let (sql, _, _) = build_update_sql(&rk, r#"data"col"#, &diff);
        assert!(sql.contains(r#""weird""sch"."weird;tbl""#));
        assert!(sql.contains(r#""data""col""#));
        assert!(sql.contains(r#""id""col""#));
    }

    #[test]
    fn shell_compiles_and_constants_exist() {
        assert_eq!(DIFF_OPS_THRESHOLD, 8);
    }

    // ---------------- Property tests (proptest) ----------------

    use proptest::prelude::*;

    fn arb_json(depth: u32) -> impl Strategy<Value = serde_json::Value> {
        let leaf = prop_oneof![
            Just(serde_json::Value::Null),
            any::<bool>().prop_map(serde_json::Value::Bool),
            any::<i32>().prop_map(|n| serde_json::json!(n)),
            "[a-zA-Z0-9]{0,16}".prop_map(serde_json::Value::String),
        ];
        leaf.prop_recursive(depth, 32, 6, |inner| {
            prop_oneof![
                proptest::collection::vec(inner.clone(), 0..4).prop_map(serde_json::Value::Array),
                proptest::collection::hash_map("[a-z]{1,6}", inner, 0..4).prop_map(|m| {
                    let mut o = serde_json::Map::new();
                    for (k, v) in m {
                        o.insert(k, v);
                    }
                    serde_json::Value::Object(o)
                }),
            ]
        })
    }

    /// Apply a diff to `old` and check we get `new` (semantically).
    /// Mirrors the SQL-side semantics of `jsonb_set` / `#-`.
    fn apply_diff(old: &serde_json::Value, diff: &JsonbDiff) -> serde_json::Value {
        if diff.full_replace {
            return diff.full_value.clone().unwrap_or_else(|| old.clone());
        }
        let mut cur = old.clone();
        for op in &diff.ops {
            match op {
                JsonbOp::Set { path, value } => set_path(&mut cur, path, value.clone()),
                JsonbOp::Delete { path } => del_path(&mut cur, path),
            }
        }
        cur
    }

    fn set_path(cur: &mut serde_json::Value, path: &[String], value: serde_json::Value) {
        if path.is_empty() {
            *cur = value;
            return;
        }
        let (head, tail) = path.split_first().unwrap();
        match cur {
            serde_json::Value::Object(m) => {
                let entry = m.entry(head.clone()).or_insert(serde_json::Value::Null);
                set_path(entry, tail, value);
            }
            serde_json::Value::Array(a) => {
                let idx: usize = head.parse().expect("array path must be index");
                if idx < a.len() {
                    set_path(&mut a[idx], tail, value);
                }
            }
            _ => *cur = value,
        }
    }

    fn del_path(cur: &mut serde_json::Value, path: &[String]) {
        if path.is_empty() {
            return;
        }
        if path.len() == 1 {
            match cur {
                serde_json::Value::Object(m) => {
                    m.remove(&path[0]);
                }
                serde_json::Value::Array(a) => {
                    if let Ok(idx) = path[0].parse::<usize>() {
                        if idx < a.len() {
                            a.remove(idx);
                        }
                    }
                }
                _ => {}
            }
            return;
        }
        let (head, tail) = path.split_first().unwrap();
        match cur {
            serde_json::Value::Object(m) => {
                if let Some(child) = m.get_mut(head) {
                    del_path(child, tail);
                }
            }
            serde_json::Value::Array(a) => {
                if let Ok(idx) = head.parse::<usize>() {
                    if let Some(child) = a.get_mut(idx) {
                        del_path(child, tail);
                    }
                }
            }
            _ => {}
        }
    }

    proptest! {
        #![proptest_config(ProptestConfig {
            cases: 200,
            .. ProptestConfig::default()
        })]

        #[test]
        fn diff_round_trip(a in arb_json(4), b in arb_json(4)) {
            let d = compute_diff(&a, &b);
            let applied = apply_diff(&a, &d);
            prop_assert_eq!(applied, b);
        }

        #[test]
        fn diff_identical_is_empty(a in arb_json(4)) {
            let d = compute_diff(&a, &a);
            prop_assert!(d.ops.is_empty());
            prop_assert!(!d.full_replace);
        }
    }
}
