//! Sprint 20 — performance budget validation for the pg_query-based DDL/SELECT parser.
//!
//! Targets (from spec):
//!   - parse_ddl on 100-line DDL  : p95 < 50 ms
//!   - parse_select typical query : p95 < 10 ms

use criterion::{black_box, criterion_group, criterion_main, Criterion};
use ide99::parser::{ddl::parse_ddl, select::parse_select};

fn ddl_100_lines() -> String {
    let mut s = String::with_capacity(8 * 1024);
    for i in 0..50 {
        s.push_str(&format!("ALTER TABLE t{i} ADD COLUMN c{i} integer;\n"));
    }
    // mix in some CREATE TABLEs and DROP COLUMNs to keep the workload realistic
    for i in 0..25 {
        s.push_str(&format!(
            "CREATE TABLE s{i} (id bigint PRIMARY KEY, payload text);\n"
        ));
    }
    for i in 0..25 {
        s.push_str(&format!("ALTER TABLE u{i} DROP COLUMN deprecated;\n"));
    }
    s
}

fn select_typical() -> &'static str {
    "SELECT id, email, created_at FROM public.users \
     WHERE id > 10 AND email LIKE 'a%' AND status IS NOT NULL \
     ORDER BY id DESC LIMIT 100"
}

fn bench_parsers(c: &mut Criterion) {
    let ddl = ddl_100_lines();
    c.bench_function("parse_ddl_100lines", |b| {
        b.iter(|| {
            let _ = parse_ddl(black_box(&ddl)).unwrap();
        });
    });
    c.bench_function("parse_select_typical", |b| {
        b.iter(|| {
            let _ = parse_select(black_box(select_typical())).unwrap();
        });
    });
}

criterion_group!(benches, bench_parsers);
criterion_main!(benches);
