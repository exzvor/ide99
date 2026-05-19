//! Sprint 37 — autocomplete latency benchmark.
//!
//! Target ([`docs/engineering/06-performance-targets.md`]): autocomplete
//! end-to-end <50 ms (Monaco trigger → suggestion list rendered). Frontend
//! analysis dominates the budget; backend's contribution is the
//! `parser_parse_select` lookup that the FE invokes on every keystroke
//! (debounced) to extract the FROM-scope and column references.
//!
//! Sub-agent B (Sprint 37) replaced the synthetic Phase A strings with a
//! representative 10-query corpus (see `fixtures/sql_corpus.sql`) covering
//! the shapes users actually type: simple SELECT, multi-JOIN with aliases,
//! CTE / WITH RECURSIVE, window functions, JSONB path, array contains,
//! Cyrillic identifiers. Two Criterion groups:
//!
//!   - `parse_corpus`        — parse every query in the corpus once per iter
//!   - `scope_extraction`    — parse + walk the resulting QueryShape (mirrors
//!     the work the FE does to assemble Monaco suggestion lists)
//!   - `parse_64_join_query` — adversarial worst-case, 64-table JOIN
//!
//! The scope-extraction loop is the closest pure-Rust proxy to the
//! Monaco-side autocomplete pipeline: parse → enumerate
//! `base_select.{schema, table, columns}` → enumerate filter columns →
//! enumerate sort + limit. Frontend cost (DOM + Monaco render) is not
//! modelled here.

use criterion::{black_box, criterion_group, criterion_main, BenchmarkId, Criterion};
use ide99::parser::select::parse_select;

/// 10-query corpus baked at compile time. See `fixtures/sql_corpus.sql` for
/// the source-of-truth list and the rationale for each query.
const SQL_CORPUS_RAW: &str = include_str!("fixtures/sql_corpus.sql");

/// Split the corpus into individual queries. Comment lines (starting with
/// `--`) and blank lines are ignored; statements terminate at `;` followed
/// by end-of-line. Returned in source order.
fn corpus() -> Vec<&'static str> {
    let mut out: Vec<&'static str> = Vec::new();
    let mut start: usize = 0;
    let bytes = SQL_CORPUS_RAW.as_bytes();
    let mut i = 0;
    let mut in_line_comment = false;
    while i < bytes.len() {
        let b = bytes[i];
        if in_line_comment {
            if b == b'\n' {
                in_line_comment = false;
                start = i + 1;
            }
            i += 1;
            continue;
        }
        // Detect line comments only at start of (trimmed) line.
        if b == b'-' && i + 1 < bytes.len() && bytes[i + 1] == b'-' {
            // Only treat as comment if everything before `i` on this line is whitespace.
            let line_start = SQL_CORPUS_RAW[..i].rfind('\n').map_or(0, |p| p + 1);
            if SQL_CORPUS_RAW[line_start..i].trim().is_empty() {
                in_line_comment = true;
                i += 2;
                continue;
            }
        }
        if b == b';' {
            let stmt = SQL_CORPUS_RAW[start..i].trim();
            if !stmt.is_empty() {
                out.push(stmt);
            }
            start = i + 1;
        }
        i += 1;
    }
    // Tail (no trailing `;`)
    let tail = SQL_CORPUS_RAW[start..].trim();
    if !tail.is_empty() {
        out.push(tail);
    }
    out
}

/// Mirror what the frontend does: parse, then enumerate the parts it needs
/// for the Monaco suggestion list (FROM scope + filter cols + sort col).
/// The result is a single `usize` (sum of items "extracted") so the
/// optimiser cannot elide the walk.
fn extract_scope_signal(sql: &str) -> usize {
    match parse_select(sql) {
        Ok(shape) => {
            let mut n = shape.base_select.columns.len();
            n += shape.filters.len();
            n += if shape.sort.is_some() { 1 } else { 0 };
            n += if shape.limit.is_some() { 1 } else { 0 };
            n += shape.base_select.table.len();
            n
        }
        // Many corpus queries (CTE, JOIN-with-alias, WINDOW, …) are
        // intentionally `unrepresentable` for the GUI flat-shape
        // detector — but `parse_select` still walks the AST and returns
        // a shape, which is the work we want to bench.
        Err(_) => 0,
    }
}

fn build_big_query(joins: usize) -> String {
    let mut s = String::from("SELECT t0.id");
    for i in 1..=joins {
        s.push_str(&format!(", t{i}.value AS v{i}"));
    }
    s.push_str(" FROM t0");
    for i in 1..=joins {
        s.push_str(&format!(" JOIN t{i} ON t{i}.t0_id = t0.id"));
    }
    s.push_str(" WHERE t0.status = 'active' LIMIT 100");
    s
}

fn bench_autocomplete(c: &mut Criterion) {
    let queries = corpus();
    assert!(
        queries.len() >= 8,
        "corpus loader regressed: got {} queries, expected ≥ 8 (see fixtures/sql_corpus.sql)",
        queries.len()
    );

    // ---- Group 1: parse the entire corpus per iteration. ----
    let mut g_parse = c.benchmark_group("autocomplete_parse_corpus");
    g_parse.bench_function("all_queries", |b| {
        b.iter(|| {
            for q in &queries {
                let _ = parse_select(black_box(q));
            }
        });
    });
    // Per-query break-down — surfaces which corpus shapes are slow.
    for (idx, q) in queries.iter().enumerate() {
        g_parse.bench_with_input(BenchmarkId::new("query", idx), q, |b, sql| {
            b.iter(|| {
                let _ = parse_select(black_box(sql));
            });
        });
    }
    g_parse.finish();

    // ---- Group 2: scope extraction (parse + walk). ----
    c.bench_function("autocomplete_scope_extraction_corpus", |b| {
        b.iter(|| {
            let mut total = 0_usize;
            for q in &queries {
                total += extract_scope_signal(black_box(q));
            }
            black_box(total);
        });
    });

    // ---- Group 3: adversarial 64-table JOIN (worst-case probe). ----
    let big = build_big_query(64);
    c.bench_function("autocomplete_parse_64_join_query", |b| {
        b.iter(|| {
            let _ = parse_select(black_box(&big));
        });
    });
}

criterion_group!(benches, bench_autocomplete);
criterion_main!(benches);
