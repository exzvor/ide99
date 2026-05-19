//! Sprint 37 — result-grid first-page formatting benchmark.
//!
//! Target ([`docs/engineering/06-performance-targets.md`]): result grid
//! first page (10M rows total, 1000 rows fetched) <500 ms end-to-end.
//! Backend's contribution is the JSON serialization of the row batch
//! returned by the query module — a `QueryResult` struct that crosses
//! the Tauri IPC boundary.
//!
//! Sub-agent B (Sprint 37) replaced the synthetic `serde_json::Value`
//! batch with the real `QueryResult` DTO from `ide99::query::types`
//! and bumped the size sweep to {1k, 10k, 100k} rows × 10 cols.
//!
//! Why 100k and not 1M / 10M:
//!   - 1M rows × 10 cols mixed types ≈ 1.5 GB string heap; bench RSS
//!     blows past CI limits and the run-length is dominated by
//!     allocator pressure rather than serialisation work.
//!   - 100k probes the realistic upper bound for a single page render
//!     (the user only ever sees 1k at a time; we virtualise the rest).
//!     Anything slower than 100k linear-scaled is a real regression.
//!
//! Mixed-type column shape (probes serde's per-cell branch density):
//!   text / int / email / nullable status / timestamp / JSONB-as-string
//!   / float / bool / array-as-string / Cyrillic text.

use criterion::{black_box, criterion_group, criterion_main, BenchmarkId, Criterion};
use ide99::query::types::{ColumnMeta, QueryResult};

const COLUMN_NAMES: &[&str] = &[
    "name",
    "id",
    "email",
    "status",
    "created_at",
    "metadata",
    "score",
    "active",
    "tags",
    "ru_label",
];
const COLUMN_TYPES: &[&str] = &[
    "text",
    "int8",
    "text",
    "text",
    "timestamptz",
    "jsonb",
    "float8",
    "bool",
    "_text",
    "text",
];

fn build_columns() -> Vec<ColumnMeta> {
    COLUMN_NAMES
        .iter()
        .zip(COLUMN_TYPES.iter())
        .map(|(n, t)| ColumnMeta {
            name: (*n).to_string(),
            type_name: (*t).to_string(),
            is_numeric: matches!(*t, "int8" | "float8"),
        })
        .collect()
}

fn build_query_result(rows: usize) -> QueryResult {
    let mut data: Vec<Vec<Option<String>>> = Vec::with_capacity(rows);
    for i in 0..rows {
        // Preallocate inner Vec — measured cost should reflect the cell
        // string formatting, not the per-row Vec allocation noise.
        let mut row: Vec<Option<String>> = Vec::with_capacity(10);
        row.push(Some(format!("user-{i}")));
        row.push(Some(i.to_string()));
        row.push(Some(format!("alice{i}@example.com")));
        // ~14% NULL density — realistic for a status column.
        row.push(if i % 7 == 0 {
            None
        } else {
            Some(format!("active-{}", i % 3))
        });
        row.push(Some(format!(
            "2026-05-07T10:{:02}:{:02}Z",
            i / 60 % 60,
            i % 60
        )));
        // JSONB cell is pre-stringified at the query layer (see
        // `format::cell_to_string`); the FE re-parses on demand.
        row.push(Some(format!(
            "{{\"k\":{i},\"tag\":\"abc\",\"meta\":{{\"v\":{}}}}}",
            i % 100
        )));
        row.push(Some((i as f64 * 1.234).to_string()));
        row.push(Some(if i % 2 == 0 { "true" } else { "false" }.into()));
        row.push(Some(format!("[{}, {}, {}]", i, i + 1, i + 2)));
        row.push(Some(format!("Заказ #{i}")));
        data.push(row);
    }
    QueryResult {
        columns: build_columns(),
        rows: data,
        truncated: false,
        duration_ms: 42,
        affected_rows: None,
        status_message: "SELECT".into(),
    }
}

fn bench_result_grid(c: &mut Criterion) {
    let mut g = c.benchmark_group("result_grid_serialize");
    // Sample sizes are smaller for the 100k case — Criterion default 100
    // samples × ~25ms per iteration would push the bench past 30s otherwise.
    for rows in [1_000_usize, 10_000, 100_000] {
        let qr = build_query_result(rows);
        if rows >= 100_000 {
            g.sample_size(20);
        } else if rows >= 10_000 {
            g.sample_size(50);
        }
        g.bench_with_input(
            BenchmarkId::new("query_result_to_json", rows),
            &qr,
            |b, q| {
                b.iter(|| {
                    let s = serde_json::to_string(black_box(q)).unwrap();
                    black_box(s.len());
                });
            },
        );
    }
    g.finish();
}

criterion_group!(benches, bench_result_grid);
criterion_main!(benches);
