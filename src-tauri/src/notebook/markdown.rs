//! Markdown variable substitution for Notebook cells.
//!
//! Two placeholder syntaxes are supported inside Markdown cells:
//!
//! 1. `{{ cell_N.result.<column>[.<row>] }}` — explicit cell-index
//!    lookup; `<row>` is optional (default = 0, i.e. the first row).
//! 2. `{{ <cte_name>.<column>[.<row>] }}` — alias-based: the name of a
//!    CTE-cell (either the default `cell_N` or an explicit `cteName`)
//!    that is marked `share_as_cte=true` and precedes the target
//!    Markdown cell.
//!
//! Values come from the inline `result` snapshot of preceding SQL cells
//! (pushed by the frontend on the last execution). If a placeholder
//! cannot be resolved (non-existent index, unknown alias, missing
//! column/row, NULL value), it remains as the literal placeholder —
//! Markdown is still valid and the user can see something did not
//! substitute.
//!
//! Markdown→HTML rendering is done on the frontend; this module only
//! performs pure string substitution. No I/O, no external dependencies.

#![allow(clippy::missing_errors_doc, clippy::missing_panics_doc)]

use crate::notebook::cte::default_cte_name;
use crate::notebook::types::{Cell, CellResult, NotebookError};

/// Render the Markdown source of `cells[target_idx]` substituting all
/// `{{ ... }}` placeholders that resolve against predecessor SQL-cells'
/// inline `result` snapshots.
///
/// Errors:
/// * `InvalidInput` — `target_idx` out of bounds, or target cell is not Markdown.
pub fn render_markdown(cells: &[Cell], target_idx: usize) -> Result<String, NotebookError> {
    if target_idx >= cells.len() {
        return Err(NotebookError::InvalidInput(format!(
            "target_idx {target_idx} out of bounds"
        )));
    }
    let source = match &cells[target_idx] {
        Cell::Markdown { source, .. } => source.clone(),
        _ => {
            return Err(NotebookError::InvalidInput(format!(
                "cell {target_idx} is not a Markdown cell"
            )))
        }
    };
    Ok(substitute(&source, &cells[..target_idx]))
}

/// Walk `text` looking for `{{ ... }}` placeholders. For each, attempt to
/// resolve against `predecessors`; on success substitute the literal value,
/// on failure keep the original `{{ ... }}` placeholder verbatim.
fn substitute(text: &str, predecessors: &[Cell]) -> String {
    let bytes = text.as_bytes();
    let mut out = String::with_capacity(text.len());
    let mut i = 0;
    while i < bytes.len() {
        // Look for `{{` opener.
        if i + 1 < bytes.len() && bytes[i] == b'{' && bytes[i + 1] == b'{' {
            if let Some(close_rel) = find_close(&text[i + 2..]) {
                let inner_start = i + 2;
                let inner_end = i + 2 + close_rel;
                let inner = &text[inner_start..inner_end];
                let placeholder = &text[i..inner_end + 2];
                match resolve(inner.trim(), predecessors) {
                    Some(value) => out.push_str(&value),
                    None => out.push_str(placeholder),
                }
                i = inner_end + 2;
                continue;
            }
        }
        // No placeholder match — copy a single character (UTF-8 safe via
        // char_indices, but here we're bumping by byte for `{`-starts only).
        // For non-`{` bytes we're safe to advance by 1 because they're either
        // ASCII or part of a multi-byte run that doesn't contain `{` (0x7B).
        out.push(bytes[i] as char);
        i += 1;
    }
    out
}

/// Find the byte offset of `}}` in `s` (the rest of the string after `{{`).
/// Returns `None` if no closer is found or if a newline appears inside
/// (we don't support multi-line placeholders — keeps the parser simple).
fn find_close(s: &str) -> Option<usize> {
    let bytes = s.as_bytes();
    let mut i = 0;
    while i + 1 < bytes.len() {
        if bytes[i] == b'\n' {
            return None;
        }
        if bytes[i] == b'}' && bytes[i + 1] == b'}' {
            return Some(i);
        }
        i += 1;
    }
    None
}

/// Try to resolve a placeholder body like `cell_2.result.total` or
/// `revenue.month.3`. Returns `None` if anything fails to resolve.
fn resolve(body: &str, predecessors: &[Cell]) -> Option<String> {
    let parts: Vec<&str> = body.split('.').map(str::trim).collect();
    if parts.len() < 2 {
        return None;
    }

    // Two shapes:
    // cell_<N>.result.<col>[.<row>]
    // <alias>.<col>[.<row>]
    if let Some(rest) = parts[0].strip_prefix("cell_") {
        let idx: usize = rest.parse().ok()?;
        if parts.len() < 3 || parts[1] != "result" {
            return None;
        }
        let column = parts[2];
        let row_idx = if parts.len() >= 4 {
            parts[3].parse().ok()?
        } else {
            0
        };
        let cell = predecessors.get(idx)?;
        let result = sql_result(cell)?;
        return lookup(result, column, row_idx);
    }

    // Alias form. parts[0] = alias, parts[1] = column, parts[2] = row?
    let alias = parts[0];
    let column = parts[1];
    let row_idx = if parts.len() >= 3 {
        parts[2].parse().ok()?
    } else {
        0
    };
    let cell = find_alias(predecessors, alias)?;
    let result = sql_result(cell)?;
    lookup(result, column, row_idx)
}

/// Borrow inline `result` from a SQL cell; non-SQL cells return `None`.
const fn sql_result(cell: &Cell) -> Option<&CellResult> {
    match cell {
        Cell::Sql { result, .. } => result.as_ref(),
        Cell::Result { result, .. } => Some(result),
        Cell::Markdown { .. } => None,
    }
}

/// Locate a SQL cell whose CTE alias matches `alias`. Either explicit
/// `cte_name` (when `share_as_cte=true`) or the `cell_<idx>` default.
fn find_alias<'a>(predecessors: &'a [Cell], alias: &str) -> Option<&'a Cell> {
    for (idx, cell) in predecessors.iter().enumerate() {
        if let Cell::Sql {
            share_as_cte,
            cte_name,
            ..
        } = cell
        {
            if *share_as_cte {
                let name = cte_name
                    .as_ref()
                    .filter(|n| !n.trim().is_empty())
                    .cloned()
                    .unwrap_or_else(|| default_cte_name(idx));
                if name == alias {
                    return Some(cell);
                }
            }
        }
    }
    None
}

/// Pick a value from `result` by column name + row index. Returns `None`
/// if the column is missing, the row is out of bounds, or the value is NULL.
fn lookup(result: &CellResult, column: &str, row_idx: usize) -> Option<String> {
    let col_idx = result.columns.iter().position(|c| c == column)?;
    let row = result.rows.get(row_idx)?;
    row.get(col_idx)?.clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_result(columns: Vec<&str>, rows: Vec<Vec<Option<&str>>>) -> CellResult {
        CellResult {
            columns: columns.into_iter().map(String::from).collect(),
            rows: rows
                .into_iter()
                .map(|r| r.into_iter().map(|v| v.map(String::from)).collect())
                .collect(),
            truncated: false,
            duration_ms: 1,
            executed_at: "2026-05-06T00:00:00Z".into(),
        }
    }

    fn sql_with_result(id: &str, body: &str, result: Option<CellResult>) -> Cell {
        Cell::Sql {
            id: id.into(),
            source: body.into(),
            result,
            share_as_cte: false,
            cte_name: None,
        }
    }

    fn sql_alias(id: &str, body: &str, alias: &str, result: Option<CellResult>) -> Cell {
        Cell::Sql {
            id: id.into(),
            source: body.into(),
            result,
            share_as_cte: true,
            cte_name: Some(alias.into()),
        }
    }

    fn md(id: &str, source: &str) -> Cell {
        Cell::Markdown {
            id: id.into(),
            source: source.into(),
        }
    }

    #[test]
    fn simple_substitution_by_cell_index() {
        let result = sample_result(vec!["total"], vec![vec![Some("42")]]);
        let cells = vec![
            sql_with_result("c0", "SELECT 42 AS total", Some(result)),
            md("c1", "Total: {{ cell_0.result.total }}"),
        ];
        let rendered = render_markdown(&cells, 1).unwrap();
        assert_eq!(rendered, "Total: 42");
    }

    #[test]
    fn missing_column_keeps_placeholder() {
        let result = sample_result(vec!["total"], vec![vec![Some("42")]]);
        let cells = vec![
            sql_with_result("c0", "SELECT 42", Some(result)),
            md("c1", "Value: {{ cell_0.result.unknown }}"),
        ];
        let rendered = render_markdown(&cells, 1).unwrap();
        assert_eq!(rendered, "Value: {{ cell_0.result.unknown }}");
    }

    #[test]
    fn missing_cell_index_keeps_placeholder() {
        let cells = vec![md("c0", "{{ cell_5.result.foo }}")];
        let rendered = render_markdown(&cells, 0).unwrap();
        assert_eq!(rendered, "{{ cell_5.result.foo }}");
    }

    #[test]
    fn non_sql_predecessor_keeps_placeholder() {
        let cells = vec![
            md("c0", "# Heading"),
            md("c1", "Echo: {{ cell_0.result.col }}"),
        ];
        let rendered = render_markdown(&cells, 1).unwrap();
        assert_eq!(rendered, "Echo: {{ cell_0.result.col }}");
    }

    #[test]
    fn row_index_lookup_works() {
        let result = sample_result(
            vec!["month"],
            vec![vec![Some("Jan")], vec![Some("Feb")], vec![Some("Mar")]],
        );
        let cells = vec![
            sql_with_result("c0", "SELECT month FROM x", Some(result)),
            md(
                "c1",
                "Second: {{ cell_0.result.month.1 }} / Third: {{ cell_0.result.month.2 }}",
            ),
        ];
        let rendered = render_markdown(&cells, 1).unwrap();
        assert_eq!(rendered, "Second: Feb / Third: Mar");
    }

    #[test]
    fn named_cte_alias_resolution() {
        let result = sample_result(vec!["count"], vec![vec![Some("7")]]);
        let cells = vec![
            sql_alias("c0", "SELECT 7 AS count", "totals", Some(result)),
            md("c1", "There are {{ totals.count }} rows."),
        ];
        let rendered = render_markdown(&cells, 1).unwrap();
        assert_eq!(rendered, "There are 7 rows.");
    }

    #[test]
    fn cell_index_form_takes_precedence_over_alias() {
        // `cell_0.<...>` syntax is always treated as explicit cell-index
        // (requires `.result.<col>`), not as the alias "cell_0". This
        // eliminates ambiguity and matches the placeholder format spec.
        let result = sample_result(vec!["v"], vec![vec![Some("hello")]]);
        let cells = vec![
            Cell::Sql {
                id: "c0".into(),
                source: "SELECT 'hello' AS v".into(),
                result: Some(result),
                share_as_cte: true,
                cte_name: None,
            },
            // Without `.result.` — placeholder stays as-is (no alias match).
            md("c1", "Got: {{ cell_0.v }}"),
        ];
        let rendered = render_markdown(&cells, 1).unwrap();
        assert_eq!(rendered, "Got: {{ cell_0.v }}");
    }

    #[test]
    fn null_value_keeps_placeholder() {
        let result = sample_result(vec!["total"], vec![vec![None]]);
        let cells = vec![
            sql_with_result("c0", "SELECT NULL", Some(result)),
            md("c1", "Total: {{ cell_0.result.total }}"),
        ];
        let rendered = render_markdown(&cells, 1).unwrap();
        // NULL renders as the literal placeholder so the user notices.
        assert_eq!(rendered, "Total: {{ cell_0.result.total }}");
    }

    #[test]
    fn no_inline_result_keeps_placeholder() {
        // SQL cell without a last-execute snapshot.
        let cells = vec![
            sql_with_result("c0", "SELECT 1", None),
            md("c1", "x = {{ cell_0.result.x }}"),
        ];
        let rendered = render_markdown(&cells, 1).unwrap();
        assert_eq!(rendered, "x = {{ cell_0.result.x }}");
    }

    #[test]
    fn errors_when_target_not_markdown() {
        let cells = vec![sql_with_result("c0", "SELECT 1", None)];
        let err = render_markdown(&cells, 0).unwrap_err();
        assert!(matches!(err, NotebookError::InvalidInput(_)));
    }

    #[test]
    fn errors_when_target_idx_out_of_bounds() {
        let cells = vec![md("c0", "")];
        let err = render_markdown(&cells, 5).unwrap_err();
        assert!(matches!(err, NotebookError::InvalidInput(_)));
    }

    #[test]
    fn multiple_placeholders_in_single_text() {
        let r1 = sample_result(vec!["v"], vec![vec![Some("1")]]);
        let r2 = sample_result(vec!["v"], vec![vec![Some("2")]]);
        let cells = vec![
            sql_with_result("a", "SELECT 1", Some(r1)),
            sql_with_result("b", "SELECT 2", Some(r2)),
            md("c", "{{ cell_0.result.v }} + {{ cell_1.result.v }} = 3"),
        ];
        let rendered = render_markdown(&cells, 2).unwrap();
        assert_eq!(rendered, "1 + 2 = 3");
    }
}
