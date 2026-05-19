//! Query DTOs. All fields camelCase on the wire.

use serde::{Deserialize, Serialize};

/// Opaque identifier for a live or just-closed `query_open_cursor` result.
///
/// `<inline>` is the sentinel returned by DML / DDL paths that never opened
/// a server-side cursor (no rowset). For row-returning queries — including
/// the single-page exhausted case — the real `c_<uuid>` id is returned so
/// `jsonb_resolve_row_key` can look up `column_sources` / `ctid_values` from
/// the finished-cursor side table even after the cursor has been auto-closed.
pub type CursorId = String;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    pub columns: Vec<ColumnMeta>,
    pub rows: Vec<Vec<Option<String>>>,
    pub truncated: bool,
    pub duration_ms: u64,
    pub affected_rows: Option<u64>,
    pub status_message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnMeta {
    pub name: String,
    pub type_name: String,
    pub is_numeric: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchPage {
    /// Same row encoding as `QueryResult::rows` — outer Vec is rows,
    /// inner is column values, `None` is SQL NULL, everything else is
    /// pre-stringified via `format::cell_to_string`.
    pub rows: Vec<Vec<Option<String>>>,
    /// True when the server has no more rows for the cursor. Backend
    /// has already closed + committed the cursor before returning this.
    pub exhausted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenCursorResult {
    /// Stable handle for follow-up `query_fetch_page` / `query_cancel`
    /// / `query_close_cursor` calls. The literal string `"<inline>"` is
    /// returned only for DML/DDL paths that never opened a server-side
    /// cursor. Row-returning queries always get a real `c_<uuid>` even
    /// when `first_page.exhausted = true` (: the id keeps the
    /// finished-cursor metadata reachable for `jsonb_resolve_row_key`).
    pub cursor_id: CursorId,
    pub columns: Vec<ColumnMeta>,
    pub first_page: FetchPage,
    /// Time-to-first-page in milliseconds. Not the total time to drain
    /// the cursor — that only ends on `exhausted`.
    pub duration_ms: u64,
    /// Set only on the inline DML/DDL path (no rowset). Mirrors PG's
    /// `INSERT 0 5` etc.
    pub affected_rows: Option<u64>,
    /// PG-style status string ("SELECT", "INSERT 0 5", "OK").
    pub status_message: String,
}

// ---------------------------------------------------------------------------
// Post-S14 — Multi-statement batch execution
// ---------------------------------------------------------------------------

/// Frontend-supplied list of pre-split statements + flag for whether the
/// last rowset should open a cursor (true for editor runs, false for
/// fire-and-forget batches if any).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchInput {
    pub conn_id: String,
    pub statements: Vec<String>,
    pub cursor_for_last: bool,
}

/// One statement's outcome inside a batch. Discriminator `kind` matches the
/// frontend `statementResultSchema` zod union.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum StatementResult {
    /// SELECT or RETURNING — yielded rows.
    #[serde(rename_all = "camelCase")]
    Rowset {
        index: u32,
        sql: String,
        columns: Vec<ColumnMeta>,
        rows: Vec<Vec<Option<String>>>,
        /// true when an intermediate rowset was capped at 500 rows.
        truncated: bool,
        /// Some only when this is the LAST rowset AND `cursor_for_last=true`.
        /// a real `c_<uuid>` is set even when `exhausted=true`,
        /// so `jsonb_resolve_row_key` can find finished-cursor metadata.
        /// Frontend gates further fetching on `exhausted`, not `cursor_id`.
        cursor_id: Option<String>,
        /// true when the cursor was auto-closed on the first
        /// FETCH (`rows.len() < 1000`) AND there is nothing more to fetch.
        /// Always true for inline DML, irrelevant for cursor-less paths.
        #[serde(default)]
        exhausted: bool,
        duration_ms: u64,
        status_message: String,
    },
    /// DML / DDL — no rowset.
    #[serde(rename_all = "camelCase")]
    Dml {
        index: u32,
        sql: String,
        affected_rows: Option<u64>,
        duration_ms: u64,
        status_message: String,
    },
    /// Error — batch stopped here. `index` is 0-based.
    #[serde(rename_all = "camelCase")]
    Error {
        index: u32,
        sql: String,
        error: QueryError,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchResult {
    pub statements: Vec<StatementResult>,
    pub total_duration_ms: u64,
    /// 0-based index of the failed statement, or None when the batch ran to completion.
    pub failed_at: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorTabRow {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub content: String,
    pub connection_id: Option<String>,
    pub node_key: Option<String>,
    pub cursor_line: i32,
    pub cursor_col: i32,
    pub created_at: String,
    pub updated_at: String,
}

/// Discriminated error envelope for query operations. Serialized via
/// `tag = "kind"` to match the existing `ConnectionError` pattern.
#[derive(Debug, Clone, thiserror::Error, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum QueryError {
    #[error("connection not active: {conn_id}")]
    #[serde(rename_all = "camelCase")]
    NotConnected { conn_id: String },

    #[error("postgres error: {message}")]
    #[serde(rename_all = "camelCase")]
    PostgresError {
        message: String,
        position: Option<u32>,
        /// Five-character SQLSTATE (e.g. "23505") when the server returned
        /// a `DbError`. The frontend uses it to map to a plain-English
        /// explanation. `None` if the error did not originate from the
        /// PG server (pool / network errors etc.).
        sqlstate: Option<String>,
    },

    #[error("pool error: {message}")]
    #[serde(rename_all = "camelCase")]
    PoolError { message: String },

    #[error("storage error: {message}")]
    #[serde(rename_all = "camelCase")]
    StorageError { message: String },

    #[error("cursor not found: {cursor_id}")]
    #[serde(rename_all = "camelCase")]
    CursorNotFound { cursor_id: String },

    #[error("query cancelled")]
    Cancelled,

    #[error("production guard failed: confirmation token does not match table name")]
    #[serde(rename_all = "camelCase")]
    ProductionGuardFailed {
        expected: String,
        received: Option<String>,
    },

    #[error("jsonb parse error: {message}")]
    #[serde(rename_all = "camelCase")]
    JsonbParseError { message: String },

    #[error("read-only result: {reason:?}")]
    #[serde(rename_all = "camelCase")]
    ReadOnlyResult { reason: ReadOnlyReason },

    #[error("row not found (concurrent delete?)")]
    RowVanished,
}

// ---------------------------------------------------------------------------
// — Query History
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum HistoryStatus {
    Ok,
    Error,
    Cancelled,
}

impl HistoryStatus {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Ok => "ok",
            Self::Error => "error",
            Self::Cancelled => "cancelled",
        }
    }

    #[must_use]
    pub fn from_token(s: &str) -> Option<Self> {
        match s {
            "ok" => Some(Self::Ok),
            "error" => Some(Self::Error),
            "cancelled" => Some(Self::Cancelled),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HistoryRow {
    pub id: String,
    pub connection_id: String,
    pub connection_name: String,
    pub sql: String,
    pub executed_at: String,
    pub duration_ms: u64,
    pub status: HistoryStatus,
    pub rows_affected: Option<u64>,
    pub rows_returned: Option<u64>,
    pub truncated: bool,
    pub error_message: Option<String>,
    pub tag: Option<String>,
    pub comment: Option<String>,
    pub pinned: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewHistoryRecord {
    pub connection_id: String,
    pub connection_name: String,
    pub sql: String,
    pub executed_at: String,
    pub duration_ms: u64,
    pub status: HistoryStatus,
    pub rows_affected: Option<u64>,
    pub rows_returned: Option<u64>,
    pub truncated: bool,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistorySearchFilter {
    #[serde(default)]
    pub query: Option<String>,
    #[serde(default)]
    pub connection_id: Option<String>,
    #[serde(default)]
    pub status: Option<HistoryStatus>,
    #[serde(default)]
    pub pinned_only: bool,
    #[serde(default)]
    pub since: Option<String>,
    #[serde(default)]
    pub until: Option<String>,
    #[serde(default = "default_history_limit")]
    pub limit: u32,
    #[serde(default)]
    pub offset: u32,
}

const fn default_history_limit() -> u32 {
    200
}

impl Default for HistorySearchFilter {
    /// Default uses [`default_history_limit`] (200) for `limit`, matching the
    /// `#[serde(default …)]` semantics. The derived `Default` would set
    /// `limit = 0`, which `search()` then clamps to zero rows — surprising
    /// for direct Rust callers (especially tests), so we provide an explicit
    /// impl instead.
    fn default() -> Self {
        Self {
            query: None,
            connection_id: None,
            status: None,
            pinned_only: false,
            since: None,
            until: None,
            limit: default_history_limit(),
            offset: 0,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistorySearchResult {
    pub rows: Vec<HistoryRow>,
    pub total_matched: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryExportResult {
    pub path: String,
    pub count: u64,
    pub bytes: u64,
}

// ---------- — Recent Plans ----------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RecentPlanMode {
    Explain,
    Analyze,
}

impl RecentPlanMode {
    #[must_use]
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Explain => "explain",
            Self::Analyze => "analyze",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentPlanRow {
    pub id: String,
    pub connection_id: String,
    pub connection_name: String,
    pub sql: String,
    /// Plan JSON kept as a string — frontend parses on open. Avoids a
    /// pointless serde round-trip (the JSON came from Postgres → was
    /// stored → frontend wants it as a string for postMessage anyway).
    pub plan_json: String,
    pub executed_at: String,
    pub duration_ms: u64,
    pub total_cost: Option<f64>,
    pub mode: RecentPlanMode,
    pub options_json: String,
    pub involved_tables: Vec<String>,
    pub pinned: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewRecentPlan {
    pub connection_id: String,
    pub connection_name: String,
    pub sql: String,
    /// Parsed plan JSON. We accept Value here (not String) so the backend
    /// can derive `total_cost` and `involved_tables` without parsing
    /// twice.
    pub plan_json: serde_json::Value,
    pub duration_ms: u64,
    pub mode: RecentPlanMode,
    pub options_json: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentPlansFilter {
    #[serde(default)]
    pub query: Option<String>,
    #[serde(default)]
    pub table: Option<String>,
    #[serde(default)]
    pub cost_min: Option<f64>,
    #[serde(default)]
    pub cost_max: Option<f64>,
    #[serde(default)]
    pub connection_id: Option<String>,
    #[serde(default = "default_recent_plans_limit")]
    pub limit: u32,
    #[serde(default)]
    pub offset: u32,
}

const fn default_recent_plans_limit() -> u32 {
    50
}

impl Default for RecentPlansFilter {
    fn default() -> Self {
        Self {
            query: None,
            table: None,
            cost_min: None,
            cost_max: None,
            connection_id: None,
            limit: default_recent_plans_limit(),
            offset: 0,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentPlansSearchResult {
    pub rows: Vec<RecentPlanRow>,
    pub total: u64,
}

// ---------------------------------------------------------------------------
// — JSONB Tree Editor write path
// ---------------------------------------------------------------------------

/// How to address the row to UPDATE.
///
/// Resolution order: PK (preferred) → `ctid` (heap fallback) → `ReadOnly`.
/// Backend never auto-degrades — frontend gets the enum and renders
/// accordingly. See `query/jsonb.rs::resolve_row_key`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RowKey {
    /// All PK columns resolved; UPDATE … WHERE pk1=$1 AND pk2=$2.
    #[serde(rename_all = "camelCase")]
    Pk {
        schema: String,
        table: String,
        columns: Vec<PkColumn>,
    },
    /// Heap table without PK — UPDATE … WHERE ctid='(0,5)'.
    #[serde(rename_all = "camelCase")]
    Ctid {
        schema: String,
        table: String,
        ctid: String,
    },
    /// Result is not safely updatable from this context.
    #[serde(rename_all = "camelCase")]
    ReadOnly { reason: ReadOnlyReason },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PkColumn {
    pub name: String,
    /// Stringified value, exactly as `format::cell_to_string` would emit.
    /// `None` is SQL NULL → backend uses `IS NULL` in WHERE.
    pub value: Option<String>,
    /// PG type name (`int4`, `uuid`, `text`, …) for typed parameter binding.
    pub type_name: String,
}

/// Why a result is read-only. UI maps this to an i18n key
/// (`jsonb.readonly.reason.<variant>`).
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ReadOnlyReason {
    /// All result columns are computed (no `table_oid` from PG wire).
    NoBaseTable,
    /// Multiple distinct `table_oid` values across columns (JOIN, UNION).
    MultipleTables,
    /// Materialized view — direct UPDATE not supported.
    Matview,
    /// Foreign table — S15 deferral.
    ForeignTable,
    /// View has no underlying PK we can map. Could be relaxed in future
    /// once we follow `pg_rewrite` to base relations.
    ViewWithoutPk,
    /// Partitioned root without PK; would require leaf-partition resolution.
    PartitionedNoPk,
    /// Cursor session lost `RowDescription` metadata (unexpected;
    /// post-Phase-B safety).
    NoColumnMetadata,
}

/// Single change in a `JsonbDiff`. `path` is a JSON pointer represented
/// as a sequence of object keys / array index strings.
//
// `Eq` is intentionally NOT derived: `serde_json::Value` doesn't impl
// `Eq` (because `Number` may carry an `f64`), so `PartialEq` is the
// strongest equality we can offer.
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum JsonbOp {
    /// `jsonb_set(col, path, value, create_missing=true)` — covers both
    /// "edit existing leaf" and "add new key".
    #[serde(rename_all = "camelCase")]
    Set {
        path: Vec<String>,
        value: serde_json::Value,
    },
    /// `col #- path` — remove key (object) or element (array tail only).
    #[serde(rename_all = "camelCase")]
    Delete { path: Vec<String> },
}

/// Output of `compute_diff(old, new)`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsonbDiff {
    /// Composed-strategy ops. Empty when `full_replace = true` OR identical inputs.
    pub ops: Vec<JsonbOp>,
    /// True when ops would exceed threshold (8) OR root type changed
    /// OR an array length changed.
    pub full_replace: bool,
    /// Set only when `full_replace = true`. Carries the new value verbatim.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub full_value: Option<serde_json::Value>,
}

/// Frontend → backend save context. Comes from the modal store; backend
/// re-validates everything (defense in depth).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsonbWriteContext {
    pub conn_id: String,
    pub row_key: RowKey,
    pub column: String,
    pub old_value: String,
    pub new_value: String,
    /// Only set when env=Prod and user passed the typing-confirm modal.
    /// Backend rejects prod saves with `None` here.
    pub confirmed_table_name: Option<String>,
}

/// Backend → frontend save result.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsonbSaveResult {
    /// SQL with parameter values inlined for display (NOT actually executed —
    /// used for the toast "Saved (1 row, X ms)" + audit log).
    pub sql_executed: String,
    pub affected_rows: u64,
    pub duration_ms: u64,
    /// Authoritative new value re-fetched after UPDATE — the result-grid
    /// uses this to refresh in-memory rows[idx][col].
    pub new_cell_value: String,
}

#[cfg(test)]
mod query_error_tests {
    use super::QueryError;
    use serde_json::json;

    #[test]
    fn cancelled_serializes_with_only_kind() {
        let e = QueryError::Cancelled;
        assert_eq!(
            serde_json::to_value(&e).unwrap(),
            json!({"kind": "cancelled"})
        );
    }

    #[test]
    fn cursor_not_found_serializes_with_camel_case_id() {
        let e = QueryError::CursorNotFound {
            cursor_id: "abc-123".into(),
        };
        assert_eq!(
            serde_json::to_value(&e).unwrap(),
            json!({"kind": "cursorNotFound", "cursorId": "abc-123"})
        );
    }

    #[test]
    fn production_guard_failed_serializes_camel_case() {
        let e = QueryError::ProductionGuardFailed {
            expected: "public.events".into(),
            received: Some("typo".into()),
        };
        let v = serde_json::to_value(&e).unwrap();
        assert_eq!(v["kind"], "productionGuardFailed");
        assert_eq!(v["expected"], "public.events");
        assert_eq!(v["received"], "typo");
    }

    #[test]
    fn read_only_result_kind_serializes_with_reason() {
        let e = QueryError::ReadOnlyResult {
            reason: super::ReadOnlyReason::ViewWithoutPk,
        };
        let v = serde_json::to_value(&e).unwrap();
        assert_eq!(v["kind"], "readOnlyResult");
        assert_eq!(v["reason"], "viewWithoutPk");
    }

    #[test]
    fn jsonb_parse_error_serializes_with_message() {
        let e = QueryError::JsonbParseError {
            message: "expected value at line 1".into(),
        };
        let v = serde_json::to_value(&e).unwrap();
        assert_eq!(v["kind"], "jsonbParseError");
        assert_eq!(v["message"], "expected value at line 1");
    }

    #[test]
    fn row_vanished_serializes_with_only_kind() {
        let e = QueryError::RowVanished;
        let v = serde_json::to_value(&e).unwrap();
        assert_eq!(v["kind"], "rowVanished");
    }
}

#[cfg(test)]
mod dto_tests {
    use super::*;

    #[test]
    fn open_cursor_result_serializes_camel_case() {
        let r = OpenCursorResult {
            cursor_id: "<inline>".into(),
            columns: vec![],
            first_page: FetchPage {
                rows: vec![],
                exhausted: true,
            },
            duration_ms: 42,
            affected_rows: Some(5),
            status_message: "OK".into(),
        };
        let v = serde_json::to_value(&r).unwrap();
        assert_eq!(v["cursorId"], "<inline>");
        assert_eq!(v["firstPage"]["exhausted"], true);
        assert_eq!(v["durationMs"], 42);
        assert_eq!(v["affectedRows"], 5);
    }

    #[test]
    fn fetch_page_with_null_cells_round_trips() {
        let p = FetchPage {
            rows: vec![vec![Some("a".into()), None]],
            exhausted: false,
        };
        let v = serde_json::to_value(&p).unwrap();
        assert_eq!(v["rows"][0][0], "a");
        assert!(v["rows"][0][1].is_null());
    }

    // ----- Multi-statement batch ------------------------------------------

    #[test]
    fn batch_result_serializes_with_camel_case_keys() {
        let r = BatchResult {
            statements: vec![StatementResult::Rowset {
                index: 0,
                sql: "SELECT 1".into(),
                columns: vec![],
                rows: vec![],
                truncated: false,
                cursor_id: None,
                exhausted: true,
                duration_ms: 5,
                status_message: "SELECT".into(),
            }],
            total_duration_ms: 5,
            failed_at: None,
        };
        let v = serde_json::to_value(&r).unwrap();
        assert_eq!(v["totalDurationMs"], 5);
        assert!(v["failedAt"].is_null());
        assert_eq!(v["statements"][0]["kind"], "rowset");
        assert_eq!(v["statements"][0]["statusMessage"], "SELECT");
        assert!(v["statements"][0]["cursorId"].is_null());
        assert_eq!(v["statements"][0]["durationMs"], 5);
    }

    #[test]
    fn statement_result_dml_serializes_with_affected_rows() {
        let r = StatementResult::Dml {
            index: 1,
            sql: "INSERT INTO foo VALUES(1)".into(),
            affected_rows: Some(1),
            duration_ms: 3,
            status_message: "OK (1 rows affected)".into(),
        };
        let v = serde_json::to_value(&r).unwrap();
        assert_eq!(v["kind"], "dml");
        assert_eq!(v["affectedRows"], 1);
        assert_eq!(v["durationMs"], 3);
    }

    #[test]
    fn statement_result_error_embeds_query_error_payload() {
        let r = StatementResult::Error {
            index: 2,
            sql: "SELECT * FROM nonexistent".into(),
            error: QueryError::PostgresError {
                message: "relation \"nonexistent\" does not exist".into(),
                position: Some(15),
                sqlstate: Some("42P01".into()),
            },
        };
        let v = serde_json::to_value(&r).unwrap();
        assert_eq!(v["kind"], "error");
        assert_eq!(v["error"]["kind"], "postgresError");
        assert_eq!(v["error"]["position"], 15);
    }

    #[test]
    fn batch_result_failed_at_serializes_as_number() {
        let r = BatchResult {
            statements: vec![],
            total_duration_ms: 100,
            failed_at: Some(2),
        };
        let v = serde_json::to_value(&r).unwrap();
        assert_eq!(v["failedAt"], 2);
    }

    // ----- — RowKey / JsonbDiff / JsonbOp wire shape -----------

    #[test]
    fn row_key_pk_serializes_with_columns() {
        let rk = RowKey::Pk {
            schema: "public".into(),
            table: "events".into(),
            columns: vec![PkColumn {
                name: "id".into(),
                value: Some("42".into()),
                type_name: "int4".into(),
            }],
        };
        let v = serde_json::to_value(&rk).unwrap();
        assert_eq!(v["kind"], "pk");
        assert_eq!(v["schema"], "public");
        assert_eq!(v["columns"][0]["name"], "id");
        assert_eq!(v["columns"][0]["typeName"], "int4");
    }

    #[test]
    fn row_key_ctid_serializes_with_ctid_value() {
        let rk = RowKey::Ctid {
            schema: "public".into(),
            table: "events".into(),
            ctid: "(0,5)".into(),
        };
        let v = serde_json::to_value(&rk).unwrap();
        assert_eq!(v["kind"], "ctid");
        assert_eq!(v["ctid"], "(0,5)");
    }

    #[test]
    fn row_key_read_only_carries_reason() {
        let rk = RowKey::ReadOnly {
            reason: ReadOnlyReason::MultipleTables,
        };
        let v = serde_json::to_value(&rk).unwrap();
        assert_eq!(v["kind"], "readOnly");
        assert_eq!(v["reason"], "multipleTables");
    }

    #[test]
    fn jsonb_op_set_serializes_path_as_array() {
        let op = JsonbOp::Set {
            path: vec!["preferences".into(), "theme".into()],
            value: serde_json::json!("dark"),
        };
        let v = serde_json::to_value(&op).unwrap();
        assert_eq!(v["kind"], "set");
        assert_eq!(v["path"], serde_json::json!(["preferences", "theme"]));
        assert_eq!(v["value"], "dark");
    }

    #[test]
    fn jsonb_op_delete_serializes_with_path() {
        let op = JsonbOp::Delete {
            path: vec!["legacy".into()],
        };
        let v = serde_json::to_value(&op).unwrap();
        assert_eq!(v["kind"], "delete");
        assert_eq!(v["path"], serde_json::json!(["legacy"]));
    }

    #[test]
    fn jsonb_diff_full_replace_skips_full_value_when_none() {
        let d = JsonbDiff {
            ops: vec![],
            full_replace: false,
            full_value: None,
        };
        let v = serde_json::to_value(&d).unwrap();
        // skip_serializing_if = "Option::is_none" ⇒ field absent
        assert!(v.get("fullValue").is_none());
        assert_eq!(v["fullReplace"], false);
    }

    #[test]
    fn jsonb_write_context_round_trips() {
        let ctx = JsonbWriteContext {
            conn_id: "c1".into(),
            row_key: RowKey::Ctid {
                schema: "public".into(),
                table: "t".into(),
                ctid: "(0,5)".into(),
            },
            column: "data".into(),
            old_value: "{}".into(),
            new_value: "{\"a\":1}".into(),
            confirmed_table_name: None,
        };
        let v = serde_json::to_value(&ctx).unwrap();
        assert_eq!(v["connId"], "c1");
        assert_eq!(v["rowKey"]["kind"], "ctid");
        assert!(v["confirmedTableName"].is_null());
    }
}
