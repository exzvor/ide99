//! — Pure op-class derivation and index naming helpers.
//!
//! Given a slice of [`MinedHit`]s, [`derive`] groups them by
//! `(schema, table, column)`, determines the most appropriate `OpClass`, and
//! returns a ranked list of [`RankedSuggestion`]s.
//!
//! All functions here are pure (no I/O), which makes them trivially testable.

#![allow(    clippy::missing_errors_doc,
    clippy::missing_panics_doc,
    clippy::cast_precision_loss,
    clippy::too_many_lines
)]

use std::collections::HashMap;

use crate::health::actions::{quote_ident, quote_qualified};
use crate::query::jsonb::suggester::miner::{MinedHit, MinedOp};
use crate::query::jsonb::suggester::types::OpClass;

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

/// A ranked index suggestion derived from mined hits.
#[derive(Debug, Clone)]
pub struct RankedSuggestion {
    pub schema: String,
    pub table: String,
    pub column: String,
    pub op_class: OpClass,
    /// Score: `Σ (calls × mean_exec_time_ms)` — higher is more impactful.
    pub score: f64,
    pub calls: i64,
    pub total_exec_time_ms: f64,
    /// Distinct op symbols seen for this column (e.g. `["@>", "?"]`).
    pub ops_seen: Vec<String>,
    /// Verbatim query text from the highest-scoring hit.
    pub representative_query: Option<String>,
}

// ─────────────────────────────────────────────────────────────────────────────
// derive
// ─────────────────────────────────────────────────────────────────────────────

/// Derive ranked index suggestions from a set of mined hits.
///
/// Rules (from spec §5.2 step 3):
/// - Only `Containment` / `Existence` ops → `JsonbOps`.
/// - Only `PathPredicate` ops → `JsonbPathOps`.
/// - Mixed containment/existence + path-predicate → `JsonbOps` (covers more).
/// - `TextExtract` ops → one `Expression` suggestion per top-3 distinct keys
/// (by frequency).  These are emitted separately from the structural index.
pub fn derive(hits: &[MinedHit]) -> Vec<RankedSuggestion> {
    type GroupKey = (String, String, String);

    struct Group {
        has_containment_or_existence: bool,
        has_path_predicate: bool,
        total_score: f64,
        total_calls: i64,
        total_exec_ms: f64,
        ops_seen: Vec<String>,
        best_hit_score: f64,
        representative_query: Option<String>,
        text_extract_keys: HashMap<String, u64>,
        text_extract_best_score: f64,
        text_extract_rep_query: Option<String>,
    }

    impl Group {
        fn new() -> Self {
            Self {
                has_containment_or_existence: false,
                has_path_predicate: false,
                total_score: 0.0,
                total_calls: 0,
                total_exec_ms: 0.0,
                ops_seen: Vec::new(),
                best_hit_score: 0.0,
                representative_query: None,
                text_extract_keys: HashMap::new(),
                text_extract_best_score: 0.0,
                text_extract_rep_query: None,
            }
        }
    }

    let mut groups: HashMap<GroupKey, Group> = HashMap::new();

    for hit in hits {
        let key = (hit.schema.clone(), hit.table.clone(), hit.column.clone());
        let g = groups.entry(key).or_insert_with(Group::new);

        let hit_score = (hit.calls as f64) * hit.mean_exec_time_ms;

        if hit.op == MinedOp::TextExtract {
            if let Some(k) = &hit.key {
                *g.text_extract_keys.entry(k.clone()).or_insert(0) += 1;
            }
            if hit_score > g.text_extract_best_score {
                g.text_extract_best_score = hit_score;
                g.text_extract_rep_query = Some(hit.query_text.clone());
            }
        } else {
            g.total_score += hit_score;
            g.total_calls += hit.calls;
            g.total_exec_ms += hit.total_exec_time_ms;

            let op_sym = op_symbol(&hit.op);
            if !g.ops_seen.contains(&op_sym) {
                g.ops_seen.push(op_sym);
            }

            if hit_score > g.best_hit_score {
                g.best_hit_score = hit_score;
                g.representative_query = Some(hit.query_text.clone());
            }

            match &hit.op {
                MinedOp::Containment | MinedOp::Existence => {
                    g.has_containment_or_existence = true;
                }
                MinedOp::PathPredicate => {
                    g.has_path_predicate = true;
                }
                MinedOp::TextExtract => unreachable!(),
            }
        }
    }

    let mut results: Vec<RankedSuggestion> = Vec::new();

    for ((schema, table, column), g) in &groups {
        // ── Structural index suggestion ───────────────────────────────────
        if g.has_containment_or_existence || g.has_path_predicate {
            let op_class = if g.has_containment_or_existence {
                OpClass::JsonbOps
            } else {
                OpClass::JsonbPathOps
            };

            results.push(RankedSuggestion {
                schema: schema.clone(),
                table: table.clone(),
                column: column.clone(),
                op_class,
                score: g.total_score,
                calls: g.total_calls,
                total_exec_time_ms: g.total_exec_ms,
                ops_seen: g.ops_seen.clone(),
                representative_query: g.representative_query.clone(),
            });
        }

        // ── Expression index suggestions (top-3 keys by frequency) ────────
        let mut key_freq: Vec<(String, u64)> = g.text_extract_keys.clone().into_iter().collect();
        key_freq.sort_by(|a, b| b.1.cmp(&a.1));

        for (key, _) in key_freq.into_iter().take(3) {
            let expr = format!("({column}->>''{key}'')");
            results.push(RankedSuggestion {
                schema: schema.clone(),
                table: table.clone(),
                column: column.clone(),
                op_class: OpClass::Expression { expr },
                score: g.text_extract_best_score,
                calls: 0,
                total_exec_time_ms: 0.0,
                ops_seen: vec!["->>".to_string()],
                representative_query: g.text_extract_rep_query.clone(),
            });
        }
    }

    // Sort descending by score, then stable alphabetically for determinism.
    results.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.schema.cmp(&b.schema))
            .then_with(|| a.table.cmp(&b.table))
            .then_with(|| a.column.cmp(&b.column))
    });

    results
}

// ─────────────────────────────────────────────────────────────────────────────
// Index name + recommended SQL helpers
// ─────────────────────────────────────────────────────────────────────────────

/// Stable index name: `idx_<table>_<col>_gin` (or `idx_<table>_<col>_<key>`
/// for expression indexes), truncated to 63 characters (PG identifier limit).
#[must_use]
pub fn make_index_name(table: &str, column: &str, key: Option<&str>) -> String {
    let raw = key.map_or_else(        || format!("idx_{table}_{column}_gin"),
        |k| format!("idx_{table}_{column}_{k}"),
);
    if raw.len() > 63 {
        raw[..63].to_string()
    } else {
        raw
    }
}

/// Build the `CREATE INDEX CONCURRENTLY` SQL statement for a suggestion.
///
/// Uses [`quote_qualified`] / [`quote_ident`] for identifier safety.
#[must_use]
pub fn make_recommended_sql(    schema: &str,
    table: &str,
    column: &str,
    op_class: &OpClass,
    index_name: &str,
) -> String {
    let fqt = quote_qualified(schema, table).unwrap_or_else(|_| format!("{schema}.{table}"));
    let col_q = quote_ident(column).unwrap_or_else(|_| column.to_string());
    let idx_q = quote_ident(index_name).unwrap_or_else(|_| index_name.to_string());

    match op_class {
        OpClass::JsonbOps => {
            format!("CREATE INDEX CONCURRENTLY {idx_q} ON {fqt} USING GIN ({col_q} jsonb_ops);")
        }
        OpClass::JsonbPathOps => {
            format!(                "CREATE INDEX CONCURRENTLY {idx_q} ON {fqt} USING GIN ({col_q} jsonb_path_ops);"
)
        }
        OpClass::Expression { expr } => {
            format!("CREATE INDEX CONCURRENTLY {idx_q} ON {fqt} USING GIN ({expr});")
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Private helpers
// ─────────────────────────────────────────────────────────────────────────────

fn op_symbol(op: &MinedOp) -> String {
    match op {
        MinedOp::Containment => "@>".to_string(),
        MinedOp::Existence => "?".to_string(),
        MinedOp::PathPredicate => "@?".to_string(),
        MinedOp::TextExtract => "->>".to_string(),
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
#[allow(clippy::cast_precision_loss)]
mod tests {
    use super::*;
    use crate::query::jsonb::suggester::miner::{MinedHit, MinedOp};

    fn hit(col: &str, op: MinedOp, key: Option<&str>, calls: i64, mean_ms: f64) -> MinedHit {
        MinedHit {
            schema: "public".into(),
            table: "events".into(),
            column: col.into(),
            op,
            key: key.map(str::to_string),
            query_text: format!("SELECT * FROM events WHERE {col} <op>"),
            calls,
            mean_exec_time_ms: mean_ms,
            total_exec_time_ms: (calls as f64) * mean_ms,
        }
    }

    // ── op_class derivation ───────────────────────────────────────────────────

    #[test]
    fn only_containment_ops_gives_jsonb_ops() {
        let hits = vec![
            hit("data", MinedOp::Containment, None, 100, 10.0),
            hit("data", MinedOp::Containment, None, 50, 5.0),
        ];
        let sug = derive(&hits);
        assert_eq!(sug.len(), 1);
        assert!(            matches!(sug[0].op_class, OpClass::JsonbOps),
            "{:?}",
            sug[0].op_class
);
    }

    #[test]
    fn only_existence_ops_gives_jsonb_ops() {
        let hits = vec![hit("data", MinedOp::Existence, None, 100, 10.0)];
        let sug = derive(&hits);
        assert_eq!(sug.len(), 1);
        assert!(matches!(sug[0].op_class, OpClass::JsonbOps));
    }

    #[test]
    fn only_path_predicate_gives_jsonb_path_ops() {
        let hits = vec![
            hit("data", MinedOp::PathPredicate, None, 100, 10.0),
            hit("data", MinedOp::PathPredicate, None, 50, 5.0),
        ];
        let sug = derive(&hits);
        assert_eq!(sug.len(), 1);
        assert!(matches!(sug[0].op_class, OpClass::JsonbPathOps));
    }

    #[test]
    fn mixed_ops_gives_jsonb_ops() {
        let hits = vec![
            hit("data", MinedOp::Containment, None, 100, 10.0),
            hit("data", MinedOp::PathPredicate, None, 200, 8.0),
        ];
        let sug = derive(&hits);
        let structural: Vec<_> = sug
            .iter()
            .filter(|s| !matches!(s.op_class, OpClass::Expression { .. }))
            .collect();
        assert_eq!(structural.len(), 1);
        assert!(matches!(structural[0].op_class, OpClass::JsonbOps));
    }

    #[test]
    fn text_extract_single_key_gives_expression_suggestion() {
        let hits = vec![hit(            "profile",
            MinedOp::TextExtract,
            Some("email"),
            200,
            5.0,
)];
        let sug = derive(&hits);
        let expr: Vec<_> = sug
            .iter()
            .filter(|s| matches!(s.op_class, OpClass::Expression { .. }))
            .collect();
        assert_eq!(expr.len(), 1);
        if let OpClass::Expression { expr } = &expr[0].op_class {
            assert!(expr.contains("email"), "expr: {expr}");
        }
    }

    #[test]
    fn text_extract_multiple_keys_top_3_only() {
        let mut hits = Vec::new();
        for key in &["a", "b", "c", "d"] {
            for _ in 0..10_usize {
                hits.push(hit("profile", MinedOp::TextExtract, Some(key), 10, 1.0));
            }
        }
        let sug = derive(&hits);
        let expr_count = sug
            .iter()
            .filter(|s| matches!(s.op_class, OpClass::Expression { .. }))
            .count();
        assert!(            expr_count <= 3,
            "expected at most 3 expression suggestions, got {expr_count}"
);
    }

    // ── index name helpers ────────────────────────────────────────────────────

    #[test]
    fn make_index_name_basic() {
        assert_eq!(            make_index_name("events", "data", None),
            "idx_events_data_gin"
);
    }

    #[test]
    fn make_index_name_with_key() {
        assert_eq!(            make_index_name("profile", "profile", Some("email")),
            "idx_profile_profile_email"
);
    }

    #[test]
    fn make_index_name_truncates_at_63() {
        let long_table = "a".repeat(60);
        let name = make_index_name(&long_table, "c", None);
        assert_eq!(name.len(), 63, "name: {name}");
    }

    // ── recommended SQL helpers ───────────────────────────────────────────────

    #[test]
    fn recommended_sql_jsonb_ops() {
        let sql = make_recommended_sql(            "public",
            "events",
            "data",
            &OpClass::JsonbOps,
            "idx_events_data_gin",
);
        assert!(sql.contains("USING GIN"), "sql: {sql}");
        assert!(sql.contains("jsonb_ops"), "sql: {sql}");
        assert!(sql.contains("CONCURRENTLY"), "sql: {sql}");
    }

    #[test]
    fn recommended_sql_jsonb_path_ops() {
        let sql = make_recommended_sql(            "public",
            "events",
            "data",
            &OpClass::JsonbPathOps,
            "idx_events_data_gin",
);
        assert!(sql.contains("jsonb_path_ops"), "sql: {sql}");
    }

    #[test]
    fn recommended_sql_expression() {
        let sql = make_recommended_sql(            "public",
            "profile",
            "profile",
            &OpClass::Expression {
                expr: "(profile->>'email')".into(),
            },
            "idx_profile_profile_email",
);
        assert!(sql.contains("profile->>'email'"), "sql: {sql}");
        assert!(sql.contains("USING GIN"), "sql: {sql}");
    }
}
