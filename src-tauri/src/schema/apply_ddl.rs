//! — `schema_apply_ddl` command.
//!
//! Wraps a frontend-generated multi-statement DDL script in
//! `BEGIN; ...; COMMIT;` and runs it via `batch_execute`. On any error PG
//! auto-rolls-back the TX; we return a structured [`ApplyError`] so the
//! editor can highlight the failing statement.

use serde::{Deserialize, Serialize};
use std::time::Instant;
use tauri::State;
use tokio_postgres::error::ErrorPosition;

use crate::AppState;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyResult {
    pub statements_executed: usize,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyError {
    pub failing_statement_index: Option<usize>,
    pub failing_sql: String,
    pub pg_error_code: String,
    pub pg_message: String,
    pub pg_hint: Option<String>,
}

/// Apply a multi-statement DDL script atomically.
///
/// # Errors
/// Returns [`ApplyError`] when:
/// - the connection pool is missing or unavailable for `conn_id`,
/// - any statement in the script fails (PG auto-rolls-back the TX).
#[tauri::command]
pub async fn schema_apply_ddl(    state: State<'_, AppState>,
    conn_id: String,
    sql_script: String,
) -> Result<ApplyResult, ApplyError> {
    let started = Instant::now();
    let trimmed = sql_script.trim();
    if trimmed.is_empty() {
        return Ok(ApplyResult {
            statements_executed: 0,
            duration_ms: 0,
        });
    }
    let pool = state.pools.get(&conn_id).await.ok_or_else(|| ApplyError {
        failing_statement_index: None,
        failing_sql: String::new(),
        pg_error_code: "08000".into(),
        pg_message: format!("not connected: {conn_id}"),
        pg_hint: None,
    })?;
    let client = pool.get().await.map_err(|e| ApplyError {
        failing_statement_index: None,
        failing_sql: String::new(),
        pg_error_code: "08000".into(),
        pg_message: format!("pool error: {e}"),
        pg_hint: None,
    })?;
    let wrapped = format!("BEGIN;\n{trimmed}\nCOMMIT;");
    let stmt_count = count_statements(trimmed);
    match client.batch_execute(&wrapped).await {
        Ok(()) => Ok(ApplyResult {
            statements_executed: stmt_count,
            duration_ms: u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX),
        }),
        Err(e) => {
            let _ = client.batch_execute("ROLLBACK").await;
            Err(map_apply_error(trimmed, &e))
        }
    }
}

/// Count `;` statement terminators outside string literals + line comments.
///
/// Best-effort; false-positives in pathological cases produce a slightly
/// inflated count, which is fine — only used for the success-path metric.
pub(crate) fn count_statements(sql: &str) -> usize {
    let mut count = 0usize;
    let mut in_str = false;
    let mut chars = sql.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '\'' if !in_str => in_str = true,
            '\'' if in_str => {
                if chars.peek() == Some(&'\'') {
                    chars.next();
                } else {
                    in_str = false;
                }
            }
            '-' if !in_str && chars.peek() == Some(&'-') => {
                while let Some(&c2) = chars.peek() {
                    chars.next();
                    if c2 == '\n' {
                        break;
                    }
                }
            }
            ';' if !in_str => count += 1,
            _ => {}
        }
    }
    count.max(1)
}

fn map_apply_error(sql: &str, e: &tokio_postgres::Error) -> ApplyError {
    let db_err = e.as_db_error();
    let code = db_err.map_or_else(|| "XX000".into(), |d| d.code().code().to_string());
    let msg = db_err.map_or_else(|| e.to_string(), |d| d.message().to_string());
    let hint = db_err.and_then(|d| d.hint().map(ToString::to_string));
    let position_byte = db_err.and_then(|d| match d.position() {
        Some(ErrorPosition::Original(n) | ErrorPosition::Internal { position: n, .. }) => {
            usize::try_from(*n).ok()
        }
        None => None,
    });
    let (failing_statement_index, failing_sql) = position_byte.map_or_else(        || (None, String::new()),
        |byte_pos| statement_at_byte(sql, byte_pos.saturating_sub(1)),
);
    ApplyError {
        failing_statement_index,
        failing_sql,
        pg_error_code: code,
        pg_message: msg,
        pg_hint: hint,
    }
}

fn statement_at_byte(sql: &str, byte: usize) -> (Option<usize>, String) {
    let mut idx = 0usize;
    let mut start = 0usize;
    for (i, c) in sql.char_indices() {
        if c == ';' {
            if byte <= i {
                return (Some(idx), sql[start..=i].to_string());
            }
            idx += 1;
            start = i + 1;
        }
    }
    (Some(idx), sql[start..].to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn count_statements_basic() {
        assert_eq!(count_statements("SELECT 1;"), 1);
        assert_eq!(count_statements("SELECT 1; SELECT 2;"), 2);
        assert_eq!(count_statements("-- comment;\nSELECT 1;"), 1);
        assert_eq!(count_statements("SELECT ';'; SELECT 1;"), 2);
    }

    #[test]
    fn count_statements_handles_no_terminator() {
        assert_eq!(count_statements("SELECT 1"), 1);
        assert_eq!(count_statements(""), 1);
    }

    #[test]
    fn count_statements_handles_escaped_quote() {
        // 'it''s' is a single literal containing one `'`; no ; outside the quote.
        assert_eq!(count_statements("SELECT 'it''s'; SELECT 2;"), 2);
    }

    #[test]
    fn statement_at_byte_locates_correct_index() {
        let sql = "A;\nB;\nC;";
        let (idx, s) = statement_at_byte(sql, 4);
        assert_eq!(idx, Some(1));
        assert!(s.contains('B'));
    }

    #[test]
    fn statement_at_byte_first_statement() {
        let sql = "A;\nB;";
        let (idx, s) = statement_at_byte(sql, 0);
        assert_eq!(idx, Some(0));
        assert!(s.contains('A'));
    }

    #[test]
    fn statement_at_byte_last_without_terminator() {
        let sql = "A;\nB";
        let (idx, s) = statement_at_byte(sql, 3);
        assert_eq!(idx, Some(1));
        assert!(s.contains('B'));
    }
}
