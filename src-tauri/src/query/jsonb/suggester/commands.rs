//! Tauri command surface for the GIN Index Suggester.

#![allow(    clippy::missing_errors_doc,
    clippy::missing_panics_doc,
    clippy::too_many_lines
)]

use crate::query::jsonb::suggester::hypopg;
use crate::query::jsonb::suggester::miner;
use crate::query::jsonb::suggester::op_class::{derive, make_index_name, make_recommended_sql};
use crate::query::jsonb::suggester::size_estimate;
use crate::query::jsonb::suggester::types::{
    ExtensionAvailability, ExtensionStatus, HypoPgEstimate, HypoPgUnavailableReason, OpClass,
    SuggesterError, SuggesterRequest, SuggesterResult, SuggesterScope, Suggestion,
    SuggestionRationale,
};

// ─────────────────────────────────────────────────────────────────────────────
// jsonb_suggester_run
// ─────────────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn jsonb_suggester_run(    req: SuggesterRequest,
    state: tauri::State<'_, crate::AppState>,
) -> Result<SuggesterResult, SuggesterError> {
    let pool = state
        .pools
        .get(&req.conn_id)
        .await
        .ok_or(SuggesterError::NotConnected)?;

    let client = pool.get().await.map_err(|_| SuggesterError::NotConnected)?;

    // ── 1. Probe extensions ──────────────────────────────────────────────
    let pg_stat_avail = probe_extension(&client, "pg_stat_statements").await;
    let hypopg_avail = probe_extension(&client, "hypopg").await;
    let ver_num = probe_server_version(&client).await;
    let generic_plan = ver_num >= 160_000;

    let extensions = ExtensionStatus {
        pg_stat_statements: if pg_stat_avail {
            ExtensionAvailability::Available
        } else {
            ExtensionAvailability::Unavailable {
                install_sql: "CREATE EXTENSION pg_stat_statements;".into(),
            }
        },
        hypopg: if hypopg_avail {
            ExtensionAvailability::Available
        } else {
            ExtensionAvailability::Unavailable {
                install_sql: "CREATE EXTENSION hypopg;".into(),
            }
        },
        generic_plan,
    };

    // ── 2. Build JSONB column list from autocomplete snapshot ────────────
    // Best-effort: if snapshot query fails we fall back to an empty list.
    let jsonb_columns: Vec<(String, String, String)> =
        match state.schema_get_autocomplete_snapshot(&req.conn_id).await {
            Ok(snap) => snap
                .relations
                .iter()
                .flat_map(|rel| {
                    rel.columns
                        .iter()
                        .filter(|c| c.is_jsonb)
                        .map(|c| (rel.schema.clone(), rel.name.clone(), c.name.clone()))
                })
                .collect(),
            Err(_) => Vec::new(),
        };

    // ── 3. Mine pg_stat_statements (if available) ────────────────────────
    let mut suggestions: Vec<Suggestion> = Vec::new();

    if pg_stat_avail {
        let hits = miner::mine(&client, &jsonb_columns)
            .await
            .unwrap_or_default();

        let mut ranked = derive(&hits);

        // Filter by scope.
        if let SuggesterScope::Column {
            schema,
            table,
            column,
        } = &req.scope
        {
            ranked.retain(|s| s.schema == *schema && s.table == *table && s.column == *column);
        }

        // Keep top-5.
        ranked.truncate(5);

        for rs in ranked {
            let key = if let OpClass::Expression { ref expr } = rs.op_class {
                // Extract key from `(col->>'key')` shape.
                extract_expression_key(expr)
            } else {
                None
            };

            let index_name = make_index_name(&rs.table, &rs.column, key.as_deref());
            let recommended_sql =
                make_recommended_sql(&rs.schema, &rs.table, &rs.column, &rs.op_class, &index_name);

            // Size estimate (best-effort).
            let estimated_size_bytes =
                size_estimate::estimate(&client, &rs.schema, &rs.table, &rs.column).await;

            suggestions.push(Suggestion {
                schema: rs.schema,
                table: rs.table,
                column: rs.column,
                op_class: rs.op_class,
                recommended_sql,
                index_name,
                rationale: SuggestionRationale::Mined {
                    calls: rs.calls,
                    total_exec_time_ms: rs.total_exec_time_ms,
                    ops_seen: rs.ops_seen,
                },
                estimated_size_bytes,
                representative_query: rs.representative_query,
            });
        }
    }

    // ── 4. Generic fallback for Column scope with no mined hits ──────────
    if suggestions.is_empty() {
        if let SuggesterScope::Column {
            schema,
            table,
            column,
        } = &req.scope
        {
            let index_name = make_index_name(table, column, None);
            let recommended_sql =
                make_recommended_sql(schema, table, column, &OpClass::JsonbOps, &index_name);

            // Size estimate for generic fallback too.
            let estimated_size_bytes =
                size_estimate::estimate(&client, schema, table, column).await;

            suggestions.push(Suggestion {
                schema: schema.clone(),
                table: table.clone(),
                column: column.clone(),
                op_class: OpClass::JsonbOps,
                recommended_sql,
                index_name,
                rationale: SuggestionRationale::Generic,
                estimated_size_bytes,
                representative_query: None,
            });
        }
    }

    let generated_at = chrono::Utc::now().timestamp_millis();

    Ok(SuggesterResult {
        extensions,
        suggestions,
        generated_at,
    })
}

// ─────────────────────────────────────────────────────────────────────────────
// jsonb_suggester_hypothetical_explain
// ─────────────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn jsonb_suggester_hypothetical_explain(    conn_id: String,
    recommended_sql: String,
    representative_query: String,
    state: tauri::State<'_, crate::AppState>,
) -> Result<HypoPgEstimate, SuggesterError> {
    // Immediate guard: empty representative_query means we can't EXPLAIN.
    if representative_query.trim().is_empty() {
        return Ok(HypoPgEstimate::Unavailable {
            reason: HypoPgUnavailableReason::NoRepresentativeQuery,
        });
    }

    let pool = state
        .pools
        .get(&conn_id)
        .await
        .ok_or(SuggesterError::NotConnected)?;

    hypopg::hypothetical_explain(&pool, &recommended_sql, &representative_query).await
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/// Check whether a named extension is present in `pg_extension`.
async fn probe_extension(client: &impl deadpool_postgres::GenericClient, extname: &str) -> bool {
    client
        .query_opt("SELECT 1 FROM pg_extension WHERE extname = $1", &[&extname])
        .await
        .map(|r| r.is_some())
        .unwrap_or(false)
}

/// Return `server_version_num` as an integer, or 0 on error.
async fn probe_server_version(client: &impl deadpool_postgres::GenericClient) -> i64 {
    let Ok(row) = client.query_one("SHOW server_version_num", &[]).await else {
        return 0;
    };
    let s: String = row.try_get(0).unwrap_or_default();
    s.trim().parse().unwrap_or(0)
}

/// Extract the key from an expression like `(col->>'key')`.
fn extract_expression_key(expr: &str) -> Option<String> {
    // Pattern: `(col->>'key')` — find the `>>'` ... `'` portion.
    let start = expr.find("->>'")? + 4;
    let end = expr[start..].find('\'')?;
    Some(expr[start..start + end].to_string())
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_expression_key_basic() {
        assert_eq!(            extract_expression_key("(data->>'email')"),
            Some("email".to_string())
);
    }

    #[test]
    fn extract_expression_key_no_match() {
        assert_eq!(extract_expression_key("(data->'tags')"), None);
    }

    #[test]
    fn extract_expression_key_missing_closing_quote() {
        // Malformed expr — None rather than panic.
        assert_eq!(extract_expression_key("(data->>'email"), None);
    }
}
