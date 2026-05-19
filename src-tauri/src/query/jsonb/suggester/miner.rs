//! — Regex-based mining of `pg_stat_statements` for JSONB operations.
//!
//! [`mine`] runs a single query against `pg_stat_statements`, then applies
//! regex extraction per row to identify JSONB operations and the column names
//! they target.  Hits are cross-referenced against the caller-supplied
//! `jsonb_columns` list (derived from the `is_jsonb=true` autocomplete
//! snapshot) to discard false positives.

#![allow(
    clippy::missing_errors_doc,
    clippy::missing_panics_doc,
    clippy::doc_markdown
)]

use regex::Regex;
use std::sync::OnceLock;

use crate::query::jsonb::suggester::types::SuggesterError;

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

/// The category of JSONB operation a `pg_stat_statements` query uses.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MinedOp {
    /// `@>` containment
    Containment,
    /// `?` / `?|` / `?&` existence
    Existence,
    /// `@?` / `@@` path predicate
    PathPredicate,
    /// `->>'key'` text extraction (expression index target)
    TextExtract,
}

/// A single match from the mining phase.
#[derive(Debug, Clone)]
pub struct MinedHit {
    pub schema: String,
    pub table: String,
    pub column: String,
    pub op: MinedOp,
    /// Present only for `TextExtract` — the extracted key name.
    pub key: Option<String>,
    pub query_text: String,
    pub calls: i64,
    pub mean_exec_time_ms: f64,
    pub total_exec_time_ms: f64,
}

// ─────────────────────────────────────────────────────────────────────────────
// SQL
// ─────────────────────────────────────────────────────────────────────────────

/// Single-query: fetch rows from `pg_stat_statements` that mention JSONB ops.
///
/// The regex uses PostgreSQL word-boundary assertions so that plain
/// identifiers like `my_table` are not matched by a `->` in the middle.
const MINING_SQL: &str = r"SELECT query, calls, mean_exec_time, total_exec_time \
    FROM pg_stat_statements \
    WHERE query ~ '\m(jsonb|->|@>|@\?|\?[|&]?|@@|jsonb_path_query)\M' \
    LIMIT 1000";

// ─────────────────────────────────────────────────────────────────────────────
// Compiled regexes (static, zero-cost after first use)
// ─────────────────────────────────────────────────────────────────────────────

/// All compiled patterns used for per-row extraction.
struct Patterns {
    containment: Regex,
    existence: Regex,
    path_predicate: Regex,
    text_extract: Regex,
}

fn patterns() -> &'static Patterns {
    static CACHE: OnceLock<Patterns> = OnceLock::new();
    CACHE.get_or_init(|| Patterns {
        // `column @> …`  (word boundary before column name)
        containment: Regex::new(r"\b(\w+)\s+@>").expect("containment regex"),
        // `column ? …` / `column ?| …` / `column ?& …`
        existence: Regex::new(r"\b(\w+)\s+(\?|\?\||\?&)[\s({]").expect("existence regex"),
        // `column @? …` / `column @@ …`
        path_predicate: Regex::new(r"\b(\w+)\s+(@\?|@@)").expect("path_predicate regex"),
        // `column->>'key'`  (key captured)
        text_extract: Regex::new(r"\b(\w+)->>'(\w+)'").expect("text_extract regex"),
    })
}

// ─────────────────────────────────────────────────────────────────────────────
// Public entry point
// ─────────────────────────────────────────────────────────────────────────────

/// Mine `pg_stat_statements` for JSONB operations, cross-referencing against
/// the list of known JSONB columns.
///
/// `jsonb_columns` is a flat list of `(schema, table, column)` triples derived
/// from the `is_jsonb=true` autocomplete snapshot.  Only hits whose column name
/// appears in that list are returned — false-positive matches on shared column
/// names (e.g. `data`) across multiple tables are tolerated for v1.
pub async fn mine(
    client: &impl deadpool_postgres::GenericClient,
    jsonb_columns: &[(String, String, String)],
) -> Result<Vec<MinedHit>, SuggesterError> {
    let rows = client
        .query(MINING_SQL, &[])
        .await
        .map_err(|e| SuggesterError::Postgres {
            message: e.to_string(),
        })?;

    // Build a fast lookup set of column names (lower-cased for case-insensitive match).
    let known_columns: std::collections::HashSet<String> = jsonb_columns
        .iter()
        .map(|(_, _, col)| col.to_lowercase())
        .collect();

    let mut hits: Vec<MinedHit> = Vec::new();

    for row in &rows {
        let query_text: String = row.try_get("query").unwrap_or_default();
        let calls: i64 = row.try_get("calls").unwrap_or(0);
        let mean_exec_time_ms: f64 = row.try_get("mean_exec_time").unwrap_or(0.0);
        let total_exec_time_ms: f64 = row.try_get("total_exec_time").unwrap_or(0.0);

        extract_hits(
            &query_text,
            calls,
            mean_exec_time_ms,
            total_exec_time_ms,
            &known_columns,
            jsonb_columns,
            &mut hits,
        );
    }

    Ok(hits)
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-row extraction (pure — exposed for testing)
// ─────────────────────────────────────────────────────────────────────────────

/// Extract all JSONB op hits from a single query-text string.
///
/// Exposed as `pub(crate)` so unit-tests can drive it without a real
/// database connection.
pub(crate) fn extract_hits(
    query_text: &str,
    calls: i64,
    mean_exec_time_ms: f64,
    total_exec_time_ms: f64,
    known_columns: &std::collections::HashSet<String>,
    jsonb_columns: &[(String, String, String)],
    out: &mut Vec<MinedHit>,
) {
    let p = patterns();

    // ── TextExtract first (most specific: col->>'key') ────────────────────
    for cap in p.text_extract.captures_iter(query_text) {
        let col_raw = cap[1].to_string();
        if !known_columns.contains(&col_raw.to_lowercase()) {
            continue;
        }
        let key = cap[2].to_string();
        let (schema, table, column) = resolve_column(&col_raw, jsonb_columns);
        out.push(MinedHit {
            schema,
            table,
            column,
            op: MinedOp::TextExtract,
            key: Some(key),
            query_text: query_text.to_string(),
            calls,
            mean_exec_time_ms,
            total_exec_time_ms,
        });
    }

    // ── Containment: col @> ───────────────────────────────────────────────
    for cap in p.containment.captures_iter(query_text) {
        let col_raw = cap[1].to_string();
        if !known_columns.contains(&col_raw.to_lowercase()) {
            continue;
        }
        let (schema, table, column) = resolve_column(&col_raw, jsonb_columns);
        out.push(MinedHit {
            schema,
            table,
            column,
            op: MinedOp::Containment,
            key: None,
            query_text: query_text.to_string(),
            calls,
            mean_exec_time_ms,
            total_exec_time_ms,
        });
    }

    // ── Existence: col ? / ?| / ?& ────────────────────────────────────────
    for cap in p.existence.captures_iter(query_text) {
        let col_raw = cap[1].to_string();
        if !known_columns.contains(&col_raw.to_lowercase()) {
            continue;
        }
        let (schema, table, column) = resolve_column(&col_raw, jsonb_columns);
        out.push(MinedHit {
            schema,
            table,
            column,
            op: MinedOp::Existence,
            key: None,
            query_text: query_text.to_string(),
            calls,
            mean_exec_time_ms,
            total_exec_time_ms,
        });
    }

    // ── PathPredicate: col @? / @@ ────────────────────────────────────────
    for cap in p.path_predicate.captures_iter(query_text) {
        let col_raw = cap[1].to_string();
        if !known_columns.contains(&col_raw.to_lowercase()) {
            continue;
        }
        let (schema, table, column) = resolve_column(&col_raw, jsonb_columns);
        out.push(MinedHit {
            schema,
            table,
            column,
            op: MinedOp::PathPredicate,
            key: None,
            query_text: query_text.to_string(),
            calls,
            mean_exec_time_ms,
            total_exec_time_ms,
        });
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/// Resolve a bare column name to its `(schema, table, column)` triple.
///
/// Best-effort: returns the first match from `jsonb_columns` (case-insensitive
/// column comparison). Falls back to `("public", col_raw, col_raw)` if no
/// match is found (should never happen after `known_columns` filtering).
fn resolve_column(
    col_raw: &str,
    jsonb_columns: &[(String, String, String)],
) -> (String, String, String) {
    let lower = col_raw.to_lowercase();
    jsonb_columns
        .iter()
        .find(|(_, _, col)| col.to_lowercase() == lower)
        .map_or_else(
            || {
                (
                    "public".to_string(),
                    col_raw.to_string(),
                    col_raw.to_string(),
                )
            },
            |(s, t, c)| (s.clone(), t.clone(), c.clone()),
        )
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    fn cols(names: &[&str]) -> Vec<(String, String, String)> {
        names
            .iter()
            .map(|n| ("public".to_string(), "t".to_string(), (*n).to_string()))
            .collect()
    }

    fn known(cols: &[(String, String, String)]) -> HashSet<String> {
        cols.iter().map(|(_, _, c)| c.to_lowercase()).collect()
    }

    fn extract(query: &str, col_names: &[&str]) -> Vec<MinedHit> {
        let jcols = cols(col_names);
        let k = known(&jcols);
        let mut out = Vec::new();
        extract_hits(query, 10, 1.0, 10.0, &k, &jcols, &mut out);
        out
    }

    // ── Containment ──────────────────────────────────────────────────────────

    #[test]
    fn detects_containment() {
        let hits = extract("SELECT * FROM t WHERE data @> '{}'", &["data"]);
        assert!(hits.iter().any(|h| h.op == MinedOp::Containment));
    }

    #[test]
    fn containment_cross_reference_drop() {
        // 'data' column not in list → filtered out
        let hits = extract("SELECT * FROM t WHERE data @> '{}'", &["profile"]);
        assert!(hits.is_empty(), "expected empty, got {hits:?}");
    }

    // ── Existence ────────────────────────────────────────────────────────────

    #[test]
    fn detects_existence_question() {
        let hits = extract("SELECT * FROM t WHERE data ? 'key'", &["data"]);
        assert!(hits.iter().any(|h| h.op == MinedOp::Existence), "{hits:?}");
    }

    #[test]
    fn detects_existence_question_pipe() {
        let hits = extract("SELECT * FROM t WHERE data ?| array['a','b']", &["data"]);
        assert!(hits.iter().any(|h| h.op == MinedOp::Existence), "{hits:?}");
    }

    #[test]
    fn detects_existence_question_amp() {
        let hits = extract("SELECT * FROM t WHERE data ?& array['a','b']", &["data"]);
        assert!(hits.iter().any(|h| h.op == MinedOp::Existence), "{hits:?}");
    }

    // ── PathPredicate ─────────────────────────────────────────────────────────

    #[test]
    fn detects_path_predicate_at_question() {
        let hits = extract("SELECT * FROM t WHERE data @? '$.x'", &["data"]);
        assert!(
            hits.iter().any(|h| h.op == MinedOp::PathPredicate),
            "{hits:?}"
        );
    }

    #[test]
    fn detects_path_predicate_double_at() {
        let hits = extract("SELECT * FROM t WHERE data @@ '$.x > 0'", &["data"]);
        assert!(
            hits.iter().any(|h| h.op == MinedOp::PathPredicate),
            "{hits:?}"
        );
    }

    // ── TextExtract ──────────────────────────────────────────────────────────

    #[test]
    fn detects_text_extract_with_key() {
        let hits = extract("SELECT data->>'email' FROM t", &["data"]);
        let te: Vec<_> = hits
            .iter()
            .filter(|h| h.op == MinedOp::TextExtract)
            .collect();
        assert!(!te.is_empty(), "{hits:?}");
        assert_eq!(te[0].key.as_deref(), Some("email"));
    }

    // ── Negative tests ────────────────────────────────────────────────────────

    #[test]
    fn comment_style_match_still_extracted_column_filter_drops_it() {
        // The query mentions @> but the column is not in our jsonb list.
        let hits = extract("-- my_table @> '{}' in a comment", &["data"]);
        assert!(
            hits.is_empty(),
            "expected empty; comment-like match should be filtered: {hits:?}"
        );
    }

    #[test]
    fn identifier_collision_filtered_by_cross_reference() {
        // `my_jsonb_table` would not be in our column list
        let hits = extract("SELECT * FROM t WHERE my_jsonb_table @> '{}'", &["data"]);
        assert!(hits.is_empty(), "{hits:?}");
    }

    // ── Case-folding ──────────────────────────────────────────────────────────

    #[test]
    fn case_insensitive_column_cross_reference() {
        // Column in list is lower-case "data", query uses "Data" (unlikely in PG
        // but our regex captures it and we lower-case for comparison).
        let hits = extract("SELECT * FROM t WHERE Data @> '{}'", &["data"]);
        // regex is case-sensitive but PG identifiers are lower-cased unless quoted.
        // Our known-set is lower-cased so "Data".to_lowercase() == "data" → match.
        assert!(
            hits.iter().any(|h| h.op == MinedOp::Containment),
            "{hits:?}"
        );
    }

    // ── proptest: random texts never panic ────────────────────────────────────

    proptest::proptest! {
        #[test]
        fn random_query_text_does_not_panic(query in proptest::string::string_regex(".{0,200}").unwrap()) {
            let jcols = cols(&["data", "profile"]);
            let k = known(&jcols);
            let mut out = Vec::new();
            extract_hits(&query, 1, 0.0, 0.0, &k, &jcols, &mut out);
            // No assertion — we just verify no panic.
        }
    }
}
