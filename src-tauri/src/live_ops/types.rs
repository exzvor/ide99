use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, thiserror::Error)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum LiveOpsError {
    #[error("not connected")]
    NotConnected,
    // Per-variant `rename_all = "camelCase"` is required so `install_sql`
    // serialises as `installSql` to match the frontend zod schema. Without
    // it, safeParse falls through and the user sees "[object Object]".
    // Same fix as `health::types::CardError`.
    #[error("extension {extension} not installed")]
    #[serde(rename_all = "camelCase")]
    Unavailable {
        extension: String,
        install_sql: String,
    },
    #[error("forbidden: requires {required_role}")]
    #[serde(rename_all = "camelCase")]
    Forbidden { required_role: String },
    #[error("query failed [{sqlstate}]: {message}")]
    QueryFailed { sqlstate: String, message: String },
}

// Sessions ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SessionsMode {
    All,
    Blocked,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub pid: i32,
    pub state: String,
    pub username: String,
    pub application_name: Option<String>,
    pub client_addr: Option<String>,
    pub query: String,
    pub query_start: Option<String>,
    pub duration_seconds: Option<f64>,
    pub wait_event_type: Option<String>,
    pub wait_event: Option<String>,
    pub backend_type: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockingEdge {
    pub blocker_pid: i32,
    pub blocked_pid: i32,
    pub lock_mode: Option<String>,
    pub lock_type: Option<String>,
    pub relation: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionsSnapshot {
    pub sessions: Vec<Session>,
    pub blocking_edges: Vec<BlockingEdge>,
    pub fetched_at: String,
    pub truncated: bool,
}

// Slow ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SlowSortBy {
    MeanExecTime,
    TotalExecTime,
    Calls,
    MeanRows,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SlowQuery {
    pub query: String,
    pub mean_exec_time_ms: f64,
    pub total_exec_time_ms: f64,
    pub calls: i64,
    pub mean_rows: f64,
    pub rolname: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SlowSnapshot {
    pub rows: Vec<SlowQuery>,
    pub sort_by: SlowSortBy,
    pub fetched_at: String,
}

// Replication ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplicationSlotRow {
    pub slot_name: String,
    pub slot_type: String,
    pub database: Option<String>,
    pub active: bool,
    pub wal_status: Option<String>,
    pub lag_bytes: Option<i64>,
    pub lag_seconds: Option<f64>,
    pub state: Option<String>,
    pub retention_bytes: Option<i64>,
    pub retention_pct_of_max: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[allow(clippy::struct_excessive_bools)] // mirrors pg_publication's 5 boolean rule flags
pub struct PublicationRow {
    pub pubname: String,
    pub puballtables: bool,
    pub pubinsert: bool,
    pub pubupdate: bool,
    pub pubdelete: bool,
    pub pubtruncate: bool,
    pub table_count: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubscriptionStat {
    pub received_lsn: Option<String>,
    pub last_msg_send_time: Option<String>,
    pub latest_end_time: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubscriptionRow {
    pub subname: String,
    pub subenabled: bool,
    pub subconninfo_redacted: String,
    pub publications: Vec<String>,
    pub stat: Option<SubscriptionStat>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplicationOverview {
    pub slots: Vec<ReplicationSlotRow>,
    pub publications: Vec<PublicationRow>,
    pub subscriptions: Vec<SubscriptionRow>,
    pub fetched_at: String,
}

#[cfg(test)]
mod error_serde_tests {
    //! Pin the JSON shape of `LiveOpsError` so the frontend zod schema in
    //! `src/lib/tauri.ts` (`liveOpsErrorSchema`) keeps matching. A regression
    //! in either side would surface in the UI as
    //! a stringified `[object Object]` because the frontend's safeParse
    //! falls through to `String(e)` on any shape mismatch.
    use super::LiveOpsError;
    use serde_json::json;

    #[test]
    fn unavailable_serializes_install_sql_as_camel_case() {
        let e = LiveOpsError::Unavailable {
            extension: "pg_stat_statements".into(),
            install_sql: "CREATE EXTENSION pg_stat_statements;".into(),
        };
        let v = serde_json::to_value(&e).unwrap();
        assert_eq!(
            v,
            json!({
                "kind": "unavailable",
                "extension": "pg_stat_statements",
                "installSql": "CREATE EXTENSION pg_stat_statements;",
            })
        );
    }

    #[test]
    fn forbidden_serializes_required_role_as_camel_case() {
        let e = LiveOpsError::Forbidden {
            required_role: "pg_monitor".into(),
        };
        let v = serde_json::to_value(&e).unwrap();
        assert_eq!(
            v,
            json!({
                "kind": "forbidden",
                "requiredRole": "pg_monitor",
            })
        );
    }

    #[test]
    fn query_failed_serializes_with_sqlstate_and_message() {
        let e = LiveOpsError::QueryFailed {
            sqlstate: "42P01".into(),
            message: "relation \"x\" does not exist".into(),
        };
        let v = serde_json::to_value(&e).unwrap();
        assert_eq!(
            v,
            json!({
                "kind": "queryFailed",
                "sqlstate": "42P01",
                "message": "relation \"x\" does not exist",
            })
        );
    }

    #[test]
    fn not_connected_is_just_kind() {
        let v = serde_json::to_value(LiveOpsError::NotConnected).unwrap();
        assert_eq!(v, json!({ "kind": "notConnected" }));
    }
}
