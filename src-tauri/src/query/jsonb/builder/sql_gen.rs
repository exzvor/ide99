//! — Pure SQL generator for the JSONB Query Builder.
//!
//! The sole public entry-point is [`generate`], which maps a
//! [`BuilderRequest`] to a [`BuilderPreview`] (or a [`BuilderError`]).
//! No I/O — every function is a pure transformation so it can be
//! exhaustively unit-tested without a database.

#![allow(
    clippy::missing_errors_doc,
    clippy::missing_panics_doc,
    clippy::module_name_repetitions,
    clippy::cast_possible_truncation,
    clippy::doc_markdown
)]

use crate::health::actions::{quote_ident, quote_qualified};
use crate::query::jsonb::builder::types::{
    BuilderError, BuilderOp, BuilderPreview, BuilderRequest, BuilderValue, BuilderWarning,
    Comparator, ExtractMode,
};
use crate::query::jsonb::inference::types::PathSegment;

// ─────────────────────────────────────────────────────────────────────────────
// Public entry point
// ─────────────────────────────────────────────────────────────────────────────

const PATH_DEPTH_LIMIT: usize = 16;

/// Generate a SQL preview for the given builder request.
///
/// Returns `Ok(BuilderPreview)` on success, or a [`BuilderError`] when the
/// request is structurally invalid (too-deep path, invalid JSON literal,
/// non-numeric number value, etc.).
pub fn generate(req: &BuilderRequest) -> Result<BuilderPreview, BuilderError> {
    let depth = req.path.len();

    // Hard error: path exceeds limit.
    if depth > PATH_DEPTH_LIMIT {
        return Err(BuilderError::PathTooDeep {
            limit: PATH_DEPTH_LIMIT as u32,
        });
    }

    let mut warnings: Vec<BuilderWarning> = Vec::new();

    // Warning: path exactly at depth limit.
    if depth == PATH_DEPTH_LIMIT {
        warnings.push(BuilderWarning::PathTooDeep {
            limit: PATH_DEPTH_LIMIT as u32,
        });
    }

    // Qualify the table name.
    let fqt =
        quote_qualified(&req.fqn.schema, &req.fqn.table).map_err(|e| BuilderError::Internal {
            message: e.to_string(),
        })?;

    let col = quote_ident(&req.fqn.column).map_err(|e| BuilderError::Internal {
        message: e.to_string(),
    })?;

    let sql = match &req.op {
        BuilderOp::Existence => {
            let (lhs, key, top_level) = existence_lhs_key(&col, &req.path, &req.value);
            // Warn only when the `?` check is against the column root (top-level),
            // which happens for an empty path, a single-key path, or a path whose
            // last segment is ArrayWildcard (unsupported for existence — fallback).
            if top_level && !req.path.is_empty() {
                warnings.push(BuilderWarning::ExistenceTopLevel);
            }
            let escaped_key = escape_string_literal(&key)?;
            format!("SELECT * FROM {fqt} WHERE {lhs} ? '{escaped_key}' LIMIT 100")
        }

        BuilderOp::Containment => {
            let json_val = containment_object(&req.path, &req.value)?;
            let escaped = escape_string_literal(&json_val)?;
            format!("SELECT * FROM {fqt} WHERE {col} @> '{escaped}'::jsonb LIMIT 100")
        }

        BuilderOp::PathExtract { mode } => match mode {
            ExtractMode::Projection => {
                let path_arr = encode_path_array(&req.path);
                format!("SELECT {col}#>'{path_arr}' AS extracted FROM {fqt} LIMIT 100")
            }
            ExtractMode::Comparison { eq_value } => {
                let path_arr = encode_path_array(&req.path);
                let val_sql = value_as_jsonb_cast(eq_value)?;
                format!("SELECT * FROM {fqt} WHERE {col}#>'{path_arr}' = {val_sql} LIMIT 100")
            }
        },

        BuilderOp::PathPredicate { comparator, rhs } => {
            let pred = jsonpath_predicate(&req.path, *comparator, rhs)?;
            let escaped_pred = escape_jsonpath_string(&pred);
            format!("SELECT * FROM {fqt} WHERE {col} @? '$.{escaped_pred}' LIMIT 100")
        }
    };

    Ok(BuilderPreview { sql, warnings })
}

// ─────────────────────────────────────────────────────────────────────────────
// String-escape helpers
// ─────────────────────────────────────────────────────────────────────────────

/// Escape a Rust string for use as a PostgreSQL string literal (`'...'`).
///
/// Rules:
/// - Single-quote `'` → `''` (PG dollar-quoting is not used here).
/// - NUL byte (`\0`) → rejected with [`BuilderError::InvalidJson`].
/// - All other bytes pass through unchanged (multi-byte UTF-8 is safe).
pub(crate) fn escape_string_literal(s: &str) -> Result<String, BuilderError> {
    if s.contains('\0') {
        return Err(BuilderError::InvalidJson {
            message: "string contains NUL byte".into(),
        });
    }
    Ok(s.replace('\'', "''"))
}

/// Escape a string for use inside a JSONPath literal (`'$...'`).
///
/// In PostgreSQL JSONPath literals, both single-quotes and backslashes must
/// be escaped. NUL bytes are rejected upstream; this function does not check.
pub(crate) fn escape_jsonpath_string(s: &str) -> String {
    s.replace('\\', "\\\\").replace('\'', "\\'")
}

// ─────────────────────────────────────────────────────────────────────────────
// Path helpers
// ─────────────────────────────────────────────────────────────────────────────

/// Encode a path as a PostgreSQL array literal for the `#>` operator.
///
/// Example: `[Key("a"), Key("b")]` → `{a,b}`.
/// [`PathSegment::ArrayWildcard`] segments are encoded as `*`.
pub(crate) fn encode_path_array(path: &[PathSegment]) -> String {
    let parts: Vec<String> = path
        .iter()
        .map(|seg| match seg {
            PathSegment::Key(k) => k.clone(),
            PathSegment::ArrayWildcard => "*".to_string(),
        })
        .collect();
    format!("{{{}}}", parts.join(","))
}

/// Wrap `value` inside a nested JSON object matching the given `path`.
///
/// - Empty path → just the value JSON.
/// - `Key("k")` → `{"k": <inner>}`.
/// - [`PathSegment::ArrayWildcard`] → `[<inner>]`.
pub(crate) fn containment_object(
    path: &[PathSegment],
    value: &BuilderValue,
) -> Result<String, BuilderError> {
    let inner_json = value_to_json(value)?;

    // Build from inside out.
    let result = path.iter().rev().fold(inner_json, |acc, seg| match seg {
        PathSegment::Key(k) => {
            let key_json = serde_json::to_string(k).unwrap_or_else(|_| format!("{k:?}"));
            format!("{{{key_json}: {acc}}}")
        }
        PathSegment::ArrayWildcard => format!("[{acc}]"),
    });

    Ok(result)
}

/// Build the body of a JSONPath expression for `@?`.
///
/// Returns a string like `"a"."b" ? (@ == "value")` which the caller
/// wraps in `'$.<result>'` after JSONPath-escaping.
pub(crate) fn jsonpath_predicate(
    path: &[PathSegment],
    comparator: Comparator,
    rhs: &BuilderValue,
) -> Result<String, BuilderError> {
    let path_str = jsonpath_accessor(path);
    let op_str = comparator_to_jsonpath(comparator);
    let rhs_str = value_to_jsonpath_rhs(rhs)?;
    if path_str.is_empty() {
        Ok(format!("@ {op_str} {rhs_str}"))
    } else {
        Ok(format!("{path_str} ? (@ {op_str} {rhs_str})"))
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Value conversion
// ─────────────────────────────────────────────────────────────────────────────

/// Convert a [`BuilderValue`] to a JSON string (for containment wrapping).
fn value_to_json(value: &BuilderValue) -> Result<String, BuilderError> {
    match value {
        BuilderValue::None | BuilderValue::Null => Ok("null".to_string()),
        BuilderValue::Bool { value } => Ok(if *value { "true" } else { "false" }.to_string()),
        BuilderValue::String { value } => {
            serde_json::to_string(value).map_err(|e| BuilderError::InvalidJson {
                message: e.to_string(),
            })
        }
        BuilderValue::Number { value } => {
            let _: f64 = value.parse().map_err(|_| BuilderError::TypeMismatch {
                expected: "number".into(),
                got: value.clone(),
            })?;
            Ok(value.clone())
        }
        BuilderValue::JsonLiteral { value } => {
            let parsed: serde_json::Value =
                serde_json::from_str(value).map_err(|e| BuilderError::InvalidJson {
                    message: e.to_string(),
                })?;
            serde_json::to_string(&parsed).map_err(|e| BuilderError::InvalidJson {
                message: e.to_string(),
            })
        }
    }
}

/// Convert a [`BuilderValue`] to a `::jsonb`-cast SQL expression.
fn value_as_jsonb_cast(value: &BuilderValue) -> Result<String, BuilderError> {
    let json = value_to_json(value)?;
    let escaped = escape_string_literal(&json)?;
    Ok(format!("'{escaped}'::jsonb"))
}

/// Convert a [`BuilderValue`] to a JSONPath RHS literal.
fn value_to_jsonpath_rhs(value: &BuilderValue) -> Result<String, BuilderError> {
    match value {
        BuilderValue::None | BuilderValue::Null => Ok("null".to_string()),
        BuilderValue::Bool { value } => Ok(if *value { "true" } else { "false" }.to_string()),
        BuilderValue::String { value } => {
            serde_json::to_string(value).map_err(|e| BuilderError::InvalidJson {
                message: e.to_string(),
            })
        }
        BuilderValue::Number { value } => {
            let _: f64 = value.parse().map_err(|_| BuilderError::TypeMismatch {
                expected: "number".into(),
                got: value.clone(),
            })?;
            Ok(value.clone())
        }
        BuilderValue::JsonLiteral { value } => {
            let parsed: serde_json::Value =
                serde_json::from_str(value).map_err(|e| BuilderError::InvalidJson {
                    message: e.to_string(),
                })?;
            serde_json::to_string(&parsed).map_err(|e| BuilderError::InvalidJson {
                message: e.to_string(),
            })
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// JSONPath helpers
// ─────────────────────────────────────────────────────────────────────────────

/// Build the path accessor part of a JSONPath expression.
///
/// `[Key("a"), Key("b"), ArrayWildcard]` → `"a"."b"[*]`.
fn jsonpath_accessor(path: &[PathSegment]) -> String {
    let mut out = String::new();
    for seg in path {
        match seg {
            PathSegment::Key(k) => {
                if !out.is_empty() {
                    out.push('.');
                }
                let escaped = k.replace('"', "\\\"");
                out.push('"');
                out.push_str(&escaped);
                out.push('"');
            }
            PathSegment::ArrayWildcard => {
                out.push_str("[*]");
            }
        }
    }
    out
}

#[must_use]
const fn comparator_to_jsonpath(c: Comparator) -> &'static str {
    match c {
        Comparator::Eq => "==",
        Comparator::Ne => "!=",
        Comparator::Gt => ">",
        Comparator::Lt => "<",
        Comparator::Ge => ">=",
        Comparator::Le => "<=",
        Comparator::LikeRegex => "like_regex",
    }
}

/// Build the LHS expression, the existence key, and whether the check is
/// against the column root (top-level).
///
/// Returns `(lhs, key, is_top_level)` where:
/// - `lhs`           — the SQL expression left of `?` (e.g. `"data"->'preferences'`).
/// - `key`           — the string to the right of `?`.
/// - `is_top_level`  — `true` when no parent-path navigation was added.
///
/// Rules:
/// 1. Empty path or no `Key` segment in path → `lhs = col`, `key` from value
/// fallback, `is_top_level = true`.
/// 2. Path whose last segment is `Key(k)` → walk all segments before the last
/// `Key` as a `->'seg'` chain; `key = k`, `is_top_level = parent chain is empty`.
/// 3. Path whose last segment is `ArrayWildcard` → existence over an array
/// element is semantically undefined; fall back to the last `Key` segment in
/// the path as the key and build the parent chain up to (and including) the
/// ArrayWildcard's predecessor, `is_top_level = true` (caller emits warning).
fn existence_lhs_key(
    col: &str,
    path: &[PathSegment],
    value: &BuilderValue,
) -> (String, String, bool) {
    // Find the index of the last Key segment.
    let last_key_idx: Option<usize> = path
        .iter()
        .enumerate()
        .rev()
        .find_map(|(i, seg)| matches!(seg, PathSegment::Key(_)).then_some(i));

    last_key_idx.map_or_else(
        || {
            // No Key segment at all (empty path, or only ArrayWildcards).
            let key = if let BuilderValue::String { value } = value {
                value.clone()
            } else {
                String::new()
            };
            (col.to_string(), key, true)
        },
        |idx| {
            let PathSegment::Key(last_key) = &path[idx] else {
                unreachable!("idx points to a Key segment")
            };
            // Build the parent chain: all segments BEFORE the last Key.
            let parent_segments = &path[..idx];
            let lhs = build_arrow_chain(col, parent_segments);
            let is_top_level = parent_segments.is_empty();
            (lhs, last_key.clone(), is_top_level)
        },
    )
}

/// Build a `->'seg'` accessor chain: `col->'s1'->'s2'->'s3'`.
///
/// [`PathSegment::ArrayWildcard`] segments are rendered as `->0` (a no-op
/// placeholder — existence on array elements is not meaningful, but we must
/// not panic).
fn build_arrow_chain(col: &str, segments: &[PathSegment]) -> String {
    let mut out = col.to_string();
    for seg in segments {
        match seg {
            PathSegment::Key(k) => {
                // Escape single quotes inside the key name.
                let escaped = k.replace('\'', "''");
                out.push_str("->'");
                out.push_str(&escaped);
                out.push('\'');
            }
            PathSegment::ArrayWildcard => {
                // Array wildcard is not meaningful for `?`; render a 0-index
                // accessor as a safe placeholder.
                out.push_str("->0");
            }
        }
    }
    out
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::query::jsonb::builder::types::{
        BuilderOp, BuilderRequest, BuilderValue, Comparator,
    };
    use crate::query::jsonb::inference::types::{FullyQualifiedColumn, PathSegment};

    fn fqn() -> FullyQualifiedColumn {
        FullyQualifiedColumn {
            schema: "public".into(),
            table: "events".into(),
            column: "data".into(),
        }
    }

    fn req(op: BuilderOp, path: Vec<PathSegment>, value: BuilderValue) -> BuilderRequest {
        BuilderRequest {
            conn_id: "c1".into(),
            fqn: fqn(),
            op,
            path,
            value,
        }
    }

    // ── Existence ────────────────────────────────────────────────────────────

    #[test]
    fn existence_empty_path_uses_string_value() {
        let r = req(
            BuilderOp::Existence,
            vec![],
            BuilderValue::String {
                value: "mykey".into(),
            },
        );
        let p = generate(&r).unwrap();
        assert!(p.sql.contains("? 'mykey'"), "sql: {}", p.sql);
        assert!(p.warnings.is_empty());
    }

    #[test]
    fn existence_single_key_segment_warns() {
        let r = req(
            BuilderOp::Existence,
            vec![PathSegment::Key("user".into())],
            BuilderValue::None,
        );
        let p = generate(&r).unwrap();
        assert!(p.sql.contains("? 'user'"), "sql: {}", p.sql);
        assert!(p
            .warnings
            .iter()
            .any(|w| matches!(w, BuilderWarning::ExistenceTopLevel)));
    }

    #[test]
    fn existence_deep_path_builds_parent_chain_no_warning() {
        // [a, b, c] → LHS = "data"->'a'->'b', key = 'c', no ExistenceTopLevel warning.
        let r = req(
            BuilderOp::Existence,
            vec![
                PathSegment::Key("a".into()),
                PathSegment::Key("b".into()),
                PathSegment::Key("c".into()),
            ],
            BuilderValue::None,
        );
        let p = generate(&r).unwrap();
        assert!(
            p.sql.contains("'a'->'b' ? 'c'"),
            "expected parent chain in sql: {}",
            p.sql
        );
        assert!(
            p.warnings
                .iter()
                .all(|w| !matches!(w, BuilderWarning::ExistenceTopLevel)),
            "should NOT warn ExistenceTopLevel for nested key path"
        );
    }

    // ── Existence — new path-resolution tests () ─────────────────

    #[test]
    fn existence_empty_path_key_from_value() {
        // Empty path → col ? 'k' (key from BuilderValue::String).
        let r = req(
            BuilderOp::Existence,
            vec![],
            BuilderValue::String { value: "k".into() },
        );
        let p = generate(&r).unwrap();
        assert!(p.sql.contains("? 'k'"), "sql: {}", p.sql);
        assert!(p.warnings.is_empty(), "no warnings for empty path");
    }

    #[test]
    fn existence_single_key_path_top_level() {
        // [Key("language")] → "data" ? 'language' (only segment = key, parent empty).
        let r = req(
            BuilderOp::Existence,
            vec![PathSegment::Key("language".into())],
            BuilderValue::None,
        );
        let p = generate(&r).unwrap();
        // LHS is just col ("data"), key is 'language'.
        assert!(p.sql.contains(r#""data" ? 'language'"#), "sql: {}", p.sql);
        // Single-key path: parent chain is empty → still top-level, warn.
        assert!(
            p.warnings
                .iter()
                .any(|w| matches!(w, BuilderWarning::ExistenceTopLevel)),
            "single-key path is still top-level → warn"
        );
    }

    #[test]
    fn existence_two_segment_path_nested() {
        // [Key("preferences"), Key("language")] → "data"->'preferences' ? 'language'.
        let r = req(
            BuilderOp::Existence,
            vec![
                PathSegment::Key("preferences".into()),
                PathSegment::Key("language".into()),
            ],
            BuilderValue::None,
        );
        let p = generate(&r).unwrap();
        assert!(
            p.sql.contains("'preferences' ? 'language'"),
            "sql: {}",
            p.sql
        );
        assert!(
            p.warnings
                .iter()
                .all(|w| !matches!(w, BuilderWarning::ExistenceTopLevel)),
            "two-segment nested path must NOT warn ExistenceTopLevel"
        );
    }

    #[test]
    fn existence_three_segment_path_nested() {
        // [Key("a"), Key("b"), Key("c")] → "data"->'a'->'b' ? 'c'.
        let r = req(
            BuilderOp::Existence,
            vec![
                PathSegment::Key("a".into()),
                PathSegment::Key("b".into()),
                PathSegment::Key("c".into()),
            ],
            BuilderValue::None,
        );
        let p = generate(&r).unwrap();
        assert!(p.sql.contains("'a'->'b' ? 'c'"), "sql: {}", p.sql);
        assert!(
            p.warnings
                .iter()
                .all(|w| !matches!(w, BuilderWarning::ExistenceTopLevel)),
            "three-segment nested path must NOT warn ExistenceTopLevel"
        );
    }

    #[test]
    fn existence_array_wildcard_last_segment_falls_back_and_warns() {
        // Path ends with ArrayWildcard → last Key segment used as key,
        // parent chain includes the ArrayWildcard predecessor; ExistenceTopLevel warned.
        // e.g. [Key("tags"), ArrayWildcard] → last Key idx = 0 ("tags"),
        // parent = [] (empty), so is_top_level = true → warn.
        let r = req(
            BuilderOp::Existence,
            vec![PathSegment::Key("tags".into()), PathSegment::ArrayWildcard],
            BuilderValue::None,
        );
        let p = generate(&r).unwrap();
        // Key is "tags" (last Key segment); parent chain is empty.
        assert!(p.sql.contains("? 'tags'"), "sql: {}", p.sql);
        assert!(
            p.warnings
                .iter()
                .any(|w| matches!(w, BuilderWarning::ExistenceTopLevel)),
            "ArrayWildcard-terminated path must warn ExistenceTopLevel"
        );
    }

    // ── Containment ──────────────────────────────────────────────────────────

    #[test]
    fn containment_empty_path_string_value() {
        let r = req(
            BuilderOp::Containment,
            vec![],
            BuilderValue::String {
                value: "alice".into(),
            },
        );
        let p = generate(&r).unwrap();
        assert!(p.sql.contains("@> '\"alice\"'::jsonb"), "sql: {}", p.sql);
    }

    #[test]
    fn containment_single_key_wraps_in_object() {
        let r = req(
            BuilderOp::Containment,
            vec![PathSegment::Key("user".into())],
            BuilderValue::String {
                value: "alice".into(),
            },
        );
        let p = generate(&r).unwrap();
        assert!(
            p.sql.contains(r#"@> '{"user": "alice"}'::jsonb"#),
            "sql: {}",
            p.sql
        );
    }

    #[test]
    fn containment_three_level_nested() {
        let r = req(
            BuilderOp::Containment,
            vec![
                PathSegment::Key("a".into()),
                PathSegment::Key("b".into()),
                PathSegment::Key("c".into()),
            ],
            BuilderValue::Number { value: "42".into() },
        );
        let p = generate(&r).unwrap();
        assert!(
            p.sql.contains(r#"@> '{"a": {"b": {"c": 42}}}'::jsonb"#),
            "sql: {}",
            p.sql
        );
    }

    #[test]
    fn containment_none_value_uses_null() {
        let r = req(BuilderOp::Containment, vec![], BuilderValue::None);
        let p = generate(&r).unwrap();
        assert!(p.sql.contains("@> 'null'::jsonb"), "sql: {}", p.sql);
    }

    #[test]
    fn containment_null_value() {
        let r = req(BuilderOp::Containment, vec![], BuilderValue::Null);
        let p = generate(&r).unwrap();
        assert!(p.sql.contains("@> 'null'::jsonb"), "sql: {}", p.sql);
    }

    #[test]
    fn containment_bool_true() {
        let r = req(
            BuilderOp::Containment,
            vec![],
            BuilderValue::Bool { value: true },
        );
        let p = generate(&r).unwrap();
        assert!(p.sql.contains("@> 'true'::jsonb"), "sql: {}", p.sql);
    }

    #[test]
    fn containment_bool_false() {
        let r = req(
            BuilderOp::Containment,
            vec![],
            BuilderValue::Bool { value: false },
        );
        let p = generate(&r).unwrap();
        assert!(p.sql.contains("@> 'false'::jsonb"), "sql: {}", p.sql);
    }

    #[test]
    fn containment_json_literal_valid() {
        let r = req(
            BuilderOp::Containment,
            vec![],
            BuilderValue::JsonLiteral {
                value: r#"{"x":1}"#.into(),
            },
        );
        let p = generate(&r).unwrap();
        assert!(p.sql.contains("@>"), "sql: {}", p.sql);
        assert!(p.sql.contains("::jsonb"), "sql: {}", p.sql);
    }

    #[test]
    fn containment_json_literal_invalid_errors() {
        let r = req(
            BuilderOp::Containment,
            vec![],
            BuilderValue::JsonLiteral {
                value: "not json".into(),
            },
        );
        assert!(matches!(
            generate(&r),
            Err(BuilderError::InvalidJson { .. })
        ));
    }

    #[test]
    fn containment_invalid_number_errors() {
        let r = req(
            BuilderOp::Containment,
            vec![],
            BuilderValue::Number {
                value: "abc".into(),
            },
        );
        assert!(matches!(
            generate(&r),
            Err(BuilderError::TypeMismatch { .. })
        ));
    }

    #[test]
    fn containment_array_wildcard_wraps_in_array() {
        let r = req(
            BuilderOp::Containment,
            vec![PathSegment::Key("tags".into()), PathSegment::ArrayWildcard],
            BuilderValue::String {
                value: "rust".into(),
            },
        );
        let p = generate(&r).unwrap();
        // serde_json encodes "rust" as "\"rust\"" (JSON string), then array-wrapped,
        // then object-wrapped: {"tags": ["\"rust\""]}
        // SQL-literal-escaping doesn't change quotes, so the final output is:
        // @> '{"tags": ["rust"]}'::jsonb
        assert!(
            p.sql.contains(r#"@> '{"tags": ["rust"]}'::jsonb"#),
            "sql: {}",
            p.sql
        );
    }

    // ── PathExtract — Projection ──────────────────────────────────────────────

    #[test]
    fn path_extract_projection_empty_path() {
        let r = req(
            BuilderOp::PathExtract {
                mode: ExtractMode::Projection,
            },
            vec![],
            BuilderValue::None,
        );
        let p = generate(&r).unwrap();
        assert!(p.sql.contains("#>'{}'"), "sql: {}", p.sql);
        assert!(p.sql.contains("AS extracted"), "sql: {}", p.sql);
    }

    #[test]
    fn path_extract_projection_single_segment() {
        let r = req(
            BuilderOp::PathExtract {
                mode: ExtractMode::Projection,
            },
            vec![PathSegment::Key("user".into())],
            BuilderValue::None,
        );
        let p = generate(&r).unwrap();
        assert!(p.sql.contains("#>'{user}'"), "sql: {}", p.sql);
    }

    #[test]
    fn path_extract_projection_three_segments() {
        let r = req(
            BuilderOp::PathExtract {
                mode: ExtractMode::Projection,
            },
            vec![
                PathSegment::Key("a".into()),
                PathSegment::Key("b".into()),
                PathSegment::Key("c".into()),
            ],
            BuilderValue::None,
        );
        let p = generate(&r).unwrap();
        assert!(p.sql.contains("#>'{a,b,c}'"), "sql: {}", p.sql);
    }

    // ── PathExtract — Comparison ──────────────────────────────────────────────

    #[test]
    fn path_extract_comparison_single_segment() {
        let r = req(
            BuilderOp::PathExtract {
                mode: ExtractMode::Comparison {
                    eq_value: BuilderValue::String {
                        value: "hello".into(),
                    },
                },
            },
            vec![PathSegment::Key("name".into())],
            BuilderValue::None,
        );
        let p = generate(&r).unwrap();
        assert!(p.sql.contains("#>'{name}' ="), "sql: {}", p.sql);
        assert!(p.sql.contains("::jsonb"), "sql: {}", p.sql);
        assert!(p.sql.contains("WHERE"), "sql: {}", p.sql);
    }

    // ── PathPredicate ─────────────────────────────────────────────────────────

    #[test]
    fn path_predicate_eq_empty_path() {
        let r = req(
            BuilderOp::PathPredicate {
                comparator: Comparator::Eq,
                rhs: BuilderValue::Number { value: "5".into() },
            },
            vec![],
            BuilderValue::None,
        );
        let p = generate(&r).unwrap();
        assert!(p.sql.contains("@?"), "sql: {}", p.sql);
        assert!(p.sql.contains("=="), "sql: {}", p.sql);
    }

    #[test]
    fn path_predicate_all_comparators() {
        for (cmp, symbol) in [
            (Comparator::Eq, "=="),
            (Comparator::Ne, "!="),
            (Comparator::Gt, ">"),
            (Comparator::Lt, "<"),
            (Comparator::Ge, ">="),
            (Comparator::Le, "<="),
            (Comparator::LikeRegex, "like_regex"),
        ] {
            let r = req(
                BuilderOp::PathPredicate {
                    comparator: cmp,
                    rhs: BuilderValue::Number { value: "1".into() },
                },
                vec![PathSegment::Key("x".into())],
                BuilderValue::None,
            );
            let p = generate(&r).unwrap();
            assert!(p.sql.contains(symbol), "comparator {cmp:?}: sql: {}", p.sql);
        }
    }

    #[test]
    fn path_predicate_three_level() {
        let r = req(
            BuilderOp::PathPredicate {
                comparator: Comparator::Eq,
                rhs: BuilderValue::String {
                    value: "weekly".into(),
                },
            },
            vec![
                PathSegment::Key("user".into()),
                PathSegment::Key("prefs".into()),
                PathSegment::Key("notif".into()),
            ],
            BuilderValue::None,
        );
        let p = generate(&r).unwrap();
        assert!(p.sql.contains("@?"), "sql: {}", p.sql);
        assert!(p.sql.contains("\"user\""), "sql: {}", p.sql);
    }

    // ── Depth limit ──────────────────────────────────────────────────────────

    #[test]
    fn depth_17_returns_error() {
        let path: Vec<PathSegment> = (0..17).map(|i| PathSegment::Key(i.to_string())).collect();
        let r = req(BuilderOp::Containment, path, BuilderValue::Null);
        assert!(matches!(
            generate(&r),
            Err(BuilderError::PathTooDeep { .. })
        ));
    }

    #[test]
    fn depth_16_returns_warning_not_error() {
        let path: Vec<PathSegment> = (0..16).map(|i| PathSegment::Key(i.to_string())).collect();
        let r = req(BuilderOp::Containment, path, BuilderValue::Null);
        let p = generate(&r).unwrap();
        assert!(p
            .warnings
            .iter()
            .any(|w| matches!(w, BuilderWarning::PathTooDeep { .. })));
    }

    // ── String escape ─────────────────────────────────────────────────────────

    #[test]
    fn escape_single_quote() {
        assert_eq!(escape_string_literal("O'Reilly").unwrap(), "O''Reilly");
    }

    #[test]
    fn escape_multiple_quotes() {
        assert_eq!(
            escape_string_literal("it's ''quoted''").unwrap(),
            "it''s ''''quoted''''"
        );
    }

    #[test]
    fn escape_embedded_newline_preserved() {
        let s = "line1\nline2";
        let escaped = escape_string_literal(s).unwrap();
        assert!(escaped.contains('\n'));
    }

    #[test]
    fn escape_multibyte_utf8() {
        let s = "café résumé 日本語";
        let escaped = escape_string_literal(s).unwrap();
        assert_eq!(escaped, s);
    }

    #[test]
    fn escape_nul_byte_rejected() {
        assert!(matches!(
            escape_string_literal("a\0b"),
            Err(BuilderError::InvalidJson { .. })
        ));
    }

    // ── Identifier escaping ───────────────────────────────────────────────────

    #[test]
    fn bad_identifier_propagates_as_internal() {
        let bad_fqn = FullyQualifiedColumn {
            schema: String::new(), // empty → quote_ident error
            table: "events".into(),
            column: "data".into(),
        };
        let r = BuilderRequest {
            conn_id: "c1".into(),
            fqn: bad_fqn,
            op: BuilderOp::Existence,
            path: vec![],
            value: BuilderValue::String { value: "k".into() },
        };
        assert!(matches!(generate(&r), Err(BuilderError::Internal { .. })));
    }

    #[test]
    fn containment_with_quotes_in_string_value() {
        let r = req(
            BuilderOp::Containment,
            vec![],
            BuilderValue::String {
                value: "O'Reilly".into(),
            },
        );
        let p = generate(&r).unwrap();
        assert!(p.sql.contains("O''Reilly"), "sql: {}", p.sql);
    }

    // ── encode_path_array ─────────────────────────────────────────────────────

    #[test]
    fn encode_path_array_empty() {
        assert_eq!(encode_path_array(&[]), "{}");
    }

    #[test]
    fn encode_path_array_single() {
        assert_eq!(encode_path_array(&[PathSegment::Key("a".into())]), "{a}");
    }

    #[test]
    fn encode_path_array_multi() {
        assert_eq!(
            encode_path_array(&[
                PathSegment::Key("a".into()),
                PathSegment::Key("b".into()),
                PathSegment::Key("c".into())
            ]),
            "{a,b,c}"
        );
    }

    #[test]
    fn encode_path_array_wildcard() {
        assert_eq!(
            encode_path_array(&[PathSegment::Key("tags".into()), PathSegment::ArrayWildcard]),
            "{tags,*}"
        );
    }
}
