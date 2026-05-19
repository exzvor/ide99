//! CTE composition between notebook cells.
//!
//! When cell N is marked `shareAsCte=true`, its SQL can be reused by
//! cell M (M > N) under the name `cell_<idx>` (or an explicit `cteName`).
//! `compose` glues everything into one SQL: it prefixes the target SQL
//! with a single `WITH` block containing the bodies of all preceding
//! shared cells whose name is referenced by the target.
//!
//! Implementation is **intentionally simple, with no SQL parser**: we
//! look for the CTE name as a word boundary (regex `\bNAME\b`) in the
//! target SQL. The frontend highlights available names; the user just
//! writes `SELECT ... FROM cell_2`.
//!
//! This function is pure — no I/O, trivial to unit-test. The frontend
//! can use the result directly as the payload for `query_execute`.

#![allow(clippy::missing_errors_doc, clippy::missing_panics_doc)]

use crate::notebook::types::Cell;

/// Result of composing target SQL with predecessor CTEs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ComposedSql {
    pub sql: String,
    /// Names that ended up in the `WITH` block, in the same order. The
    /// frontend shows them in a hover tooltip over the cell as
    /// "Imported: …".
    pub imported_names: Vec<String>,
    /// Names referenced by the target SQL (or its transitive closure)
    /// for which no shared cell was found. The frontend highlights
    /// them inline as an "unknown CTE" hint. An empty Vec is normal.
    pub unresolved_names: Vec<String>,
}

/// Default name when the user did not provide a `cteName`. Index into
/// the cells array (0-based); stable until cells are reordered. The
/// frontend regenerates names on reorder.
#[must_use]
pub fn default_cte_name(cell_index: usize) -> String {
    format!("cell_{cell_index}")
}

/// Strip a single trailing `;` so we can splice into a
/// `WITH ... AS (body)` clause without a syntax error. We keep it
/// simple: trim end whitespace, drop final ';' if present, trim again.
fn trim_trailing_semicolon(sql: &str) -> &str {
    let trimmed = sql.trim_end();
    trimmed.strip_suffix(';').map_or(trimmed, str::trim_end)
}

/// Lightweight word-boundary check: returns `true` if `name` appears in
/// `haystack` as an identifier (letter/digit/underscore boundaries).
/// Sufficient for a valid SQL identifier (the frontend restricts input).
fn references(haystack: &str, name: &str) -> bool {
    if name.is_empty() {
        return false;
    }
    let lower = haystack.to_lowercase();
    let needle = name.to_lowercase();
    let mut search_start = 0;
    while let Some(pos) = lower[search_start..].find(&needle) {
        let abs = search_start + pos;
        let before_ok = abs == 0
            || !lower
                .as_bytes()
                .get(abs - 1)
                .is_some_and(|b| b.is_ascii_alphanumeric() || *b == b'_');
        let after = abs + needle.len();
        let after_ok = !lower
            .as_bytes()
            .get(after)
            .is_some_and(|b| b.is_ascii_alphanumeric() || *b == b'_');
        if before_ok && after_ok {
            return true;
        }
        search_start = abs + needle.len();
    }
    false
}

/// Build composed SQL: walk cells in order, collect `Sql + share_as_cte`
/// predecessors, include those whose name is referenced by the target
/// SQL (including transitively — predecessor A may reference B).
///
/// `target_idx` points to the cell being executed. If the cell itself
/// is sharable, its body is included too (the frontend does not use
/// this, but it helps with "run + materialize" scenarios).
///
/// Additionally:
/// * Returns `unresolved_names` — a list of names that appear as
///   identifier tokens in the target SQL/predecessors but for which no
///   shared cell with that name exists. The frontend uses this for an
///   inline warning.
/// * Detects circular CTE references (cell A's body refers to cell B's
///   name and vice versa, both `share_as_cte=true`). Returns
///   `Err("circular CTE: ...")` when found.
pub fn compose(cells: &[Cell], target_idx: usize) -> Result<ComposedSql, String> {
    if target_idx >= cells.len() {
        return Err(format!("target_idx {target_idx} out of bounds"));
    }
    let target_sql = match &cells[target_idx] {
        Cell::Sql { source, .. } => source.clone(),
        _ => {
            return Err(format!(
                "cell {target_idx} is not a SQL cell — cannot compose"
            ))
        }
    };

    // Build the candidate map: idx -> (name, body).
    let mut candidates: Vec<(usize, String, String)> = Vec::new();
    for (idx, cell) in cells.iter().enumerate().take(target_idx) {
        if let Cell::Sql {
            source,
            share_as_cte,
            cte_name,
            ..
        } = cell
        {
            if *share_as_cte {
                let name = cte_name
                    .clone()
                    .filter(|n| !n.trim().is_empty())
                    .unwrap_or_else(|| default_cte_name(idx));
                candidates.push((idx, name, trim_trailing_semicolon(source).to_string()));
            }
        }
    }

    // Pre-flight: detect circular CTE references between candidates.
    // Two cells A,B form a cycle if A's body references B's name AND
    // B's body references A's name. We only consider candidates against
    // each other (target itself doesn't have a name yet). Generalises
    // to >2-cycles via DFS.
    if let Some(cycle) = detect_cycle(&candidates) {
        return Err(format!("circular CTE: {}", cycle.join(" -> ")));
    }

    // Transitive closure: starting from target_sql, expand the working set
    // until no new names are referenced. Order preserved by initial idx.
    let mut included: Vec<usize> = Vec::new();
    let mut frontier_text = target_sql.clone();
    loop {
        let before = included.len();
        for (idx, name, body) in &candidates {
            if !included.contains(idx) && references(&frontier_text, name) {
                included.push(*idx);
                frontier_text.push('\n');
                frontier_text.push_str(body);
            }
        }
        if included.len() == before {
            break;
        }
    }
    included.sort_unstable();

    // Compute unresolved names: tokens in `frontier_text` that look like
    // `cell_<digit>` identifiers and are not in the known candidates.
    // This is a hint, not the truth: real PG relations named `cell_3`
    // will be false positives, but the frontend only shows the hint when
    // there is no shared cell with that name. Sufficient for a UX warning.
    let known_names: Vec<&str> = candidates.iter().map(|(_, n, _)| n.as_str()).collect();
    let unresolved_names = scan_unresolved(&frontier_text, &known_names);

    if included.is_empty() {
        return Ok(ComposedSql {
            sql: target_sql,
            imported_names: Vec::new(),
            unresolved_names,
        });
    }

    // Build WITH block.
    let mut with_parts: Vec<String> = Vec::new();
    let mut imported_names: Vec<String> = Vec::new();
    for idx in &included {
        let (_, name, body) = candidates
            .iter()
            .find(|(i, _, _)| i == idx)
            .expect("included idx must be in candidates");
        with_parts.push(format!("{name} AS (\n{body}\n)"));
        imported_names.push(name.clone());
    }
    let with_clause = format!("WITH {}", with_parts.join(",\n"));
    let composed = format!("{with_clause}\n{}", trim_trailing_semicolon(&target_sql));
    Ok(ComposedSql {
        sql: composed,
        imported_names,
        unresolved_names,
    })
}

/// Scan `text` for identifiers of the form `cell_<N>` that are not in
/// `known_names`. Stable (deduped, sorted by position of first occurrence).
fn scan_unresolved(text: &str, known_names: &[&str]) -> Vec<String> {
    let bytes = text.as_bytes();
    let mut out: Vec<String> = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        let c = bytes[i];
        let is_word = c.is_ascii_alphanumeric() || c == b'_';
        let prev_is_word = i > 0 && (bytes[i - 1].is_ascii_alphanumeric() || bytes[i - 1] == b'_');
        if is_word && !prev_is_word {
            let start = i;
            while i < bytes.len() && (bytes[i].is_ascii_alphanumeric() || bytes[i] == b'_') {
                i += 1;
            }
            let token = &text[start..i];
            if let Some(rest) = token.strip_prefix("cell_") {
                if rest.chars().all(|c| c.is_ascii_digit())
                    && !rest.is_empty()
                    && !known_names.contains(&token)
                    && !out.iter().any(|n| n == token)
                {
                    out.push(token.to_string());
                }
            }
            continue;
        }
        i += 1;
    }
    out
}

/// Build a directed graph: edge `a -> b` if cell `a`'s body references
/// cell `b`'s name (a≠b). Then DFS for cycles. Returns Some(path) if a
/// cycle exists (path is the names in traversal order, closed onto
/// itself — `[a, b, a]` for a 2-cycle).
fn detect_cycle(candidates: &[(usize, String, String)]) -> Option<Vec<String>> {
    // Adjacency list: pos → Vec<pos>.
    let n = candidates.len();
    let mut adj: Vec<Vec<usize>> = vec![Vec::new(); n];
    for (i, (_idx, _name, body)) in candidates.iter().enumerate() {
        for (j, (_jdx, jname, _jbody)) in candidates.iter().enumerate() {
            if i == j {
                continue;
            }
            if references(body, jname) {
                adj[i].push(j);
            }
        }
    }

    // DFS with path tracking.
    let mut state: Vec<u8> = vec![0; n]; // 0=unvisited, 1=on-stack, 2=done.
    let mut path: Vec<usize> = Vec::new();
    for start in 0..n {
        if state[start] == 0 {
            if let Some(cycle) = dfs(start, &adj, &mut state, &mut path) {
                return Some(cycle.into_iter().map(|p| candidates[p].1.clone()).collect());
            }
        }
    }
    None
}

fn dfs(
    u: usize,
    adj: &[Vec<usize>],
    state: &mut [u8],
    path: &mut Vec<usize>,
) -> Option<Vec<usize>> {
    state[u] = 1;
    path.push(u);
    for &v in &adj[u] {
        if state[v] == 1 {
            // Cycle detected: trim path up to v and close the loop.
            let pos = path.iter().position(|&p| p == v).unwrap_or(0);
            let mut cycle = path[pos..].to_vec();
            cycle.push(v);
            return Some(cycle);
        }
        if state[v] == 0 {
            if let Some(cycle) = dfs(v, adj, state, path) {
                return Some(cycle);
            }
        }
    }
    path.pop();
    state[u] = 2;
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sql(id: &str, body: &str, share: bool, name: Option<&str>) -> Cell {
        Cell::Sql {
            id: id.into(),
            source: body.into(),
            result: None,
            share_as_cte: share,
            cte_name: name.map(String::from),
        }
    }

    #[test]
    fn no_predecessors_returns_target() {
        let cells = vec![sql("a", "SELECT 1", false, None)];
        let composed = compose(&cells, 0).unwrap();
        assert_eq!(composed.sql, "SELECT 1");
        assert!(composed.imported_names.is_empty());
    }

    #[test]
    fn unreferenced_predecessors_excluded() {
        let cells = vec![
            sql("a", "SELECT 42", true, Some("foo")),
            sql("b", "SELECT 99", false, None),
        ];
        let composed = compose(&cells, 1).unwrap();
        assert_eq!(composed.sql, "SELECT 99");
        assert!(composed.imported_names.is_empty());
    }

    #[test]
    fn referenced_predecessor_wrapped_in_with() {
        let cells = vec![
            sql("a", "SELECT 1 AS x", true, Some("first")),
            sql("b", "SELECT * FROM first", false, None),
        ];
        let composed = compose(&cells, 1).unwrap();
        assert!(composed.sql.starts_with("WITH first AS ("));
        assert!(composed.sql.contains("SELECT 1 AS x"));
        assert!(composed.sql.contains("SELECT * FROM first"));
        assert_eq!(composed.imported_names, vec!["first"]);
    }

    #[test]
    fn default_cte_name_used_when_unnamed() {
        let cells = vec![
            sql("a", "SELECT 5", true, None),
            sql("b", "SELECT * FROM cell_0", false, None),
        ];
        let composed = compose(&cells, 1).unwrap();
        assert!(composed.sql.contains("cell_0"));
        assert_eq!(composed.imported_names, vec!["cell_0"]);
    }

    #[test]
    fn transitive_inclusion() {
        let cells = vec![
            sql("a", "SELECT 1 AS v", true, Some("base")),
            sql("b", "SELECT v FROM base", true, Some("mid")),
            sql("c", "SELECT v FROM mid", false, None),
        ];
        let composed = compose(&cells, 2).unwrap();
        assert_eq!(composed.imported_names, vec!["base", "mid"]);
        assert!(composed.sql.contains("base AS"));
        assert!(composed.sql.contains("mid AS"));
    }

    #[test]
    fn target_must_be_sql_cell() {
        let cells = vec![Cell::Markdown {
            id: "m".into(),
            source: "# x".into(),
        }];
        assert!(compose(&cells, 0).is_err());
    }

    #[test]
    fn word_boundary_prevents_false_match() {
        // "first_thing" must not match CTE "first".
        let cells = vec![
            sql("a", "SELECT 1", true, Some("first")),
            sql("b", "SELECT * FROM first_thing", false, None),
        ];
        let composed = compose(&cells, 1).unwrap();
        assert!(composed.imported_names.is_empty());
    }

    #[test]
    fn trailing_semicolon_stripped_in_cte_body() {
        let cells = vec![
            sql("a", "SELECT 1;", true, Some("only")),
            sql("b", "SELECT * FROM only", false, None),
        ];
        let composed = compose(&cells, 1).unwrap();
        // No `;` should remain inside `(...)` of the CTE body.
        let with_idx = composed.sql.find("only AS (").unwrap();
        let close_idx = composed.sql[with_idx..].find(')').unwrap();
        let body = &composed.sql[with_idx..with_idx + close_idx];
        assert!(!body.contains(';'));
    }

    #[test]
    fn unresolved_names_reported() {
        // target references cell_2 which is not a shared cell.
        let cells = vec![
            sql("a", "SELECT 1", false, None),
            sql("b", "SELECT 2", false, None),
            sql("c", "SELECT * FROM cell_5", false, None),
        ];
        let composed = compose(&cells, 2).unwrap();
        assert!(composed.imported_names.is_empty());
        assert_eq!(composed.unresolved_names, vec!["cell_5".to_string()]);
    }

    #[test]
    fn unresolved_names_empty_when_all_resolved() {
        let cells = vec![
            sql("a", "SELECT 1", true, Some("base")),
            sql("b", "SELECT * FROM base", false, None),
        ];
        let composed = compose(&cells, 1).unwrap();
        assert!(composed.unresolved_names.is_empty());
    }

    #[test]
    fn circular_cte_detected() {
        // cell_0 → cell_1 → cell_0 (both shared).
        let cells = vec![
            sql("a", "SELECT * FROM cell_1", true, None),
            sql("b", "SELECT * FROM cell_0", true, None),
            sql("c", "SELECT * FROM cell_0", false, None),
        ];
        let err = compose(&cells, 2).expect_err("must reject");
        assert!(err.starts_with("circular CTE:"), "got: {err}");
        assert!(err.contains("cell_0"));
        assert!(err.contains("cell_1"));
    }

    #[test]
    fn self_reference_is_not_a_cycle() {
        // A CTE can be written with self-recursion (`WITH RECURSIVE`); detect_cycle
        // ignores self-loops because we only look at `i != j` edges. Verify
        // we don't false-flag.
        let cells = vec![
            sql("a", "SELECT * FROM a UNION SELECT 1", true, Some("a")),
            sql("b", "SELECT * FROM a", false, None),
        ];
        let composed = compose(&cells, 1).expect("no cycle");
        assert_eq!(composed.imported_names, vec!["a"]);
    }
}
