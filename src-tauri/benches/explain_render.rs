//! Sprint 37 — EXPLAIN render benchmark.
//!
//! Backend produces the EXPLAIN JSON; pev2 (frontend) renders it. Backend's
//! contribution to the budget is the JSON parse + node walk + insight
//! extraction that powers ide99's own insights overlay (separate from pev2
//! itself).
//!
//! Target ([`docs/engineering/06-performance-targets.md`]): EXPLAIN render
//! 1000 nodes <500 ms end-to-end. Backend share is the parse + walk; the
//! representative fixture is ~570 nodes (a real-world e-commerce reporting
//! plan: bushy joins + sort/agg towers, mixed leaf scan kinds, with
//! `Actual *` analyze stats). Sub-agent B replaced the Phase A synthetic
//! deep-Sort plan with this fixture.
//!
//! Three Criterion functions:
//!   - `explain_parse_500_nodes_fixture`   — parse only (serde_json)
//!   - `explain_walk_500_nodes_fixture`    — pre-parsed; counts nodes
//!   - `explain_insights_500_nodes_fixture`— parse + extract metrics that
//!     the insights overlay needs (slowest node, highest cost, total rows
//!     removed by filter, missing-index hint).
//!
//! Synthetic 50- and 100-node plans remain as smaller probes for the
//! latency curve. (Synthetic plans here are linearly nested — going past
//! ~120 nodes hits serde_json's default 128-deep recursion limit, which
//! is a parser-side guard, not a real-world EXPLAIN shape. The 500-node
//! fixture is bushy and stays comfortably below the limit.)

use criterion::{black_box, criterion_group, criterion_main, Criterion};
use serde_json::Value;

/// 571-node fixture; ~160 KB; representative of a production reporting plan.
/// Generated once and committed; see `fixtures/explain_500nodes.json` and
/// `docs/engineering/17-benchmarks.md` (§ "Refreshing fixtures") for the
/// regeneration recipe.
const EXPLAIN_500_NODES: &str = include_str!("fixtures/explain_500nodes.json");

fn synthetic_plan(node_count: usize) -> String {
    let mut node = serde_json::json!({
        "Node Type": "Index Scan",
        "Index Name": "idx_users_id",
        "Relation Name": "users",
        "Total Cost": 12.34,
        "Actual Total Time": 1.23,
        "Plan Rows": 100,
        "Actual Rows": 95,
        "Plans": []
    });
    for i in 0..node_count {
        node = serde_json::json!({
            "Node Type": if i % 3 == 0 { "Sort" } else if i % 3 == 1 { "Hash Join" } else { "Aggregate" },
            "Total Cost": 100.0 + i as f64,
            "Actual Total Time": 10.0 + i as f64 * 0.1,
            "Plan Rows": 1000,
            "Actual Rows": 950,
            "Plans": [node]
        });
    }
    serde_json::to_string(&serde_json::json!([{ "Plan": node }])).unwrap()
}

fn count_nodes(v: &Value) -> usize {
    let mut n = 1;
    if let Some(plans) = v.get("Plans").and_then(Value::as_array) {
        for child in plans {
            n += count_nodes(child);
        }
    }
    n
}

/// Mirror of the insights-overlay walk: in one pass collect (a) the slowest
/// node by `Actual Total Time`, (b) the highest cost, (c) the total rows
/// removed by filter, and (d) a heuristic missing-index hint count
/// (Seq Scan with `Rows Removed by Filter > 1000`). Returns a single
/// `(f64, f64, u64, u64)` tuple so the optimiser cannot elide the walk.
fn extract_insights(v: &Value) -> (f64, f64, u64, u64) {
    let mut slowest = 0.0_f64;
    let mut highest_cost = 0.0_f64;
    let mut rows_removed = 0_u64;
    let mut missing_idx_hints = 0_u64;
    walk_insights(
        v,
        &mut slowest,
        &mut highest_cost,
        &mut rows_removed,
        &mut missing_idx_hints,
    );
    (slowest, highest_cost, rows_removed, missing_idx_hints)
}

fn walk_insights(
    v: &Value,
    slowest: &mut f64,
    highest_cost: &mut f64,
    rows_removed: &mut u64,
    missing_idx_hints: &mut u64,
) {
    if let Some(t) = v.get("Actual Total Time").and_then(Value::as_f64) {
        if t > *slowest {
            *slowest = t;
        }
    }
    if let Some(c) = v.get("Total Cost").and_then(Value::as_f64) {
        if c > *highest_cost {
            *highest_cost = c;
        }
    }
    if let Some(r) = v.get("Rows Removed by Filter").and_then(Value::as_u64) {
        *rows_removed += r;
        let is_seq_scan = v
            .get("Node Type")
            .and_then(Value::as_str)
            .is_some_and(|s| s == "Seq Scan");
        if is_seq_scan && r > 1000 {
            *missing_idx_hints += 1;
        }
    }
    if let Some(plans) = v.get("Plans").and_then(Value::as_array) {
        for child in plans {
            walk_insights(
                child,
                slowest,
                highest_cost,
                rows_removed,
                missing_idx_hints,
            );
        }
    }
}

fn bench_explain(c: &mut Criterion) {
    // ---- Real fixture (~571 nodes; representative production plan). ----
    c.bench_function("explain_parse_500_nodes_fixture", |b| {
        b.iter(|| {
            let v: Value = serde_json::from_str(black_box(EXPLAIN_500_NODES)).unwrap();
            black_box(v);
        });
    });

    let parsed_500: Value = serde_json::from_str(EXPLAIN_500_NODES).unwrap();
    let root_500 = &parsed_500[0]["Plan"];
    c.bench_function("explain_walk_500_nodes_fixture", |b| {
        b.iter(|| {
            let n = count_nodes(black_box(root_500));
            black_box(n);
        });
    });
    c.bench_function("explain_insights_500_nodes_fixture", |b| {
        b.iter(|| {
            let v: Value = serde_json::from_str(black_box(EXPLAIN_500_NODES)).unwrap();
            let m = extract_insights(&v[0]["Plan"]);
            black_box(m);
        });
    });

    // ---- Synthetic latency-curve probes (small linear plans). ----
    // serde_json::Deserializer caps recursion at 128 by default; linear
    // synthetic plans must stay below that, so the curve here tops out at
    // 100. The real-world signal comes from the bushy 500-node fixture
    // above. To probe larger node counts, use a bushy generator (TODO if
    // we ever need an intermediate point on the curve).
    // Each synthetic level wraps the child in `{ "Plans": [ … ] }`, which
    // costs 2 frames of serde_json's 128-deep recursion budget. The
    // safe ceiling is therefore ~60 levels.
    let plan_50 = synthetic_plan(50);
    c.bench_function("explain_parse_50_nodes", |b| {
        b.iter(|| {
            let v: Value = serde_json::from_str(black_box(&plan_50)).unwrap();
            let _ = count_nodes(&v[0]["Plan"]);
        });
    });

    let plan_25 = synthetic_plan(25);
    c.bench_function("explain_parse_25_nodes", |b| {
        b.iter(|| {
            let v: Value = serde_json::from_str(black_box(&plan_25)).unwrap();
            let _ = count_nodes(&v[0]["Plan"]);
        });
    });
}

criterion_group!(benches, bench_explain);
criterion_main!(benches);
