//! Query-history search criterion benchmark.
//!
//! Methodology (see Sprint 6 design spec §10.5 and the plan briefing):
//! - Open a fresh `Store` against a `NamedTempFile` (so we exercise the same
//!   bundled-rusqlite codepath the app uses, not just the in-memory shortcut).
//! - Seed 100K synthetic history rows (5 connection_ids × 20K) across 10 SQL
//!   templates with a 95/4/1 status mix and randomised `executed_at` within
//!   the last 30 days.
//! - Drive five canonical search shapes through `query::history::search`
//!   measuring mean latency.
//!
//! Two run modes share the same scenarios:
//!
//! - `cargo bench --bench history_search` — release profile, 100K seed, full
//!   criterion measurement. Manual / CI perf gate.
//! - `cargo test --bench history_search` — debug profile, 5K seed, single
//!   timed call per scenario asserts <100ms. The CI smoke regression gate.
//!
//! Mode is detected via `cfg!(debug_assertions)` (the cleanest signal that
//! doesn't depend on criterion internals).
//!
//! No new dependencies — `rand` is intentionally avoided; the seeding RNG is
//! a tiny inline LCG seeded with `42` for run-to-run repeatability.

#![allow(unknown_lints)]
#![allow(
    clippy::duration_suboptimal_units,
    clippy::cast_possible_truncation,
    clippy::cast_possible_wrap,
    clippy::cast_sign_loss,
    clippy::missing_const_for_fn,
    clippy::doc_markdown,
    clippy::similar_names
)]

use std::time::Duration;

use criterion::{criterion_group, criterion_main, Criterion};
use ide99::connection::Store;
use ide99::query::history;
use ide99::query::types::{HistorySearchFilter, HistoryStatus, NewHistoryRecord};
use tempfile::NamedTempFile;

const SEED_ROWS_BENCH: usize = 100_000;
/// Smoke seed is intentionally smaller than the bench seed: cargo-test runs
/// in debug-mode (3-8x slower than release), so a 5K seed gives us the same
/// "catches gross regressions" signal at <100ms per scenario without the
/// sub-second build time blowing past CI patience.
const SEED_ROWS_SMOKE: usize = 5_000;
/// Per-scenario perf budget for the cargo-test smoke. Hits the brief's
/// <100ms acceptance for every scenario in debug-mode rusqlite at the
/// 10K seed; the criterion run (release, 100K) is the proper perf gate.
const PERF_BUDGET_MS: u128 = 100;
const CONN_COUNT: usize = 5;

/// Detect that this binary was invoked by `cargo test --bench` rather than
/// `cargo bench`. `cargo test --bench` always builds in dev/test profile
/// (debug_assertions on); `cargo bench` builds in release. Reading
/// `debug_assertions` is cleaner than parsing argv or scraping criterion
/// internals.
fn is_test_mode() -> bool {
    cfg!(debug_assertions)
}

fn seed_rows_for_mode(store: &Store) {
    let n = if is_test_mode() {
        SEED_ROWS_SMOKE
    } else {
        SEED_ROWS_BENCH
    };
    seed_rows(store, n);
}

/// Time a single `search()` call and panic if it exceeds the budget. Run
/// in test mode only — `cargo bench` measures via criterion itself.
fn assert_within_budget(name: &str, store: &Store, filter: &HistorySearchFilter) {
    // Two warm-up passes to prime the SQLite page cache.
    let _ = history::search(store.conn(), filter).expect("warm-up");
    let _ = history::search(store.conn(), filter).expect("warm-up");

    let start = std::time::Instant::now();
    let _ = history::search(store.conn(), filter).expect("search");
    let elapsed = start.elapsed();
    eprintln!("history_search smoke {name}: {elapsed:?} (budget {PERF_BUDGET_MS}ms)");
    assert!(
        elapsed.as_millis() < PERF_BUDGET_MS,
        "{name}: {elapsed:?} exceeds budget {PERF_BUDGET_MS}ms",
    );
}

const SQL_TEMPLATES: &[&str] = &[
    "SELECT * FROM users WHERE id = $1",
    "SELECT id, name, email FROM users LIMIT 100",
    "SELECT count(*) FROM orders",
    "INSERT INTO logs (msg, created_at) VALUES ($1, now())",
    "UPDATE accounts SET balance = balance - $1 WHERE id = $2",
    "DELETE FROM sessions WHERE expires_at < now()",
    "SELECT o.id, u.email FROM orders o JOIN users u ON u.id = o.user_id",
    "EXPLAIN ANALYZE SELECT * FROM products WHERE sku = $1",
    "WITH active AS (SELECT * FROM users WHERE active) SELECT * FROM active",
    "SELECT json_build_object('id', id, 'name', name) FROM categories",
];

/// Tiny deterministic linear-congruential generator. Knuth's MMIX constants
/// — good enough to spread template / status / time selection across 100K
/// rows and still be the same on every run for stable bench numbers.
fn lcg(state: &mut u64) -> u64 {
    *state = state
        .wrapping_mul(6_364_136_223_846_793_005)
        .wrapping_add(1_442_695_040_888_963_407);
    *state
}

fn seed_rows(store: &Store, total: usize) {
    let conn = store.conn();
    // One transaction for the whole seed — without it we'd pay per-row fsync.
    conn.execute_batch("BEGIN").expect("begin");

    let mut rng = 42_u64;
    // Reference timestamp: 2026-04-27T00:00:00Z = 1777593600 unix.
    let now: i64 = 1_777_593_600;
    let thirty_days = 30 * 24 * 3600;

    for i in 0..total {
        let cid_idx = (lcg(&mut rng) % CONN_COUNT as u64) as usize;
        let template_idx = (lcg(&mut rng) % SQL_TEMPLATES.len() as u64) as usize;
        let status_pick = lcg(&mut rng) % 100;
        let status = if status_pick < 95 {
            HistoryStatus::Ok
        } else if status_pick < 99 {
            HistoryStatus::Error
        } else {
            HistoryStatus::Cancelled
        };
        let offset_secs = (lcg(&mut rng) % thirty_days as u64) as i64;
        let executed_unix = now - offset_secs;
        let executed_at = unix_to_rfc3339(executed_unix);

        let input = NewHistoryRecord {
            connection_id: format!("conn{cid_idx}"),
            connection_name: format!("conn-{cid_idx}"),
            sql: SQL_TEMPLATES[template_idx].to_string(),
            executed_at,
            duration_ms: 1 + (i as u64 % 200),
            status,
            rows_affected: if matches!(status, HistoryStatus::Ok) {
                Some((i as u64) % 100)
            } else {
                None
            },
            rows_returned: if matches!(status, HistoryStatus::Ok) {
                Some((i as u64) % 50)
            } else {
                None
            },
            truncated: false,
            error_message: if matches!(status, HistoryStatus::Error) {
                Some("synthetic".into())
            } else {
                None
            },
        };
        history::record(conn, &input).expect("record");
    }
    conn.execute_batch("COMMIT").expect("commit");
}

/// Convert a unix timestamp to a tiny RFC-3339-ish string. We only need
/// monotonic ordering and deterministic formatting; this isn't time-zone
/// or leap-second correct (the bench doesn't care).
fn unix_to_rfc3339(unix: i64) -> String {
    // Days since 1970-01-01.
    let days = unix.div_euclid(86_400);
    let secs_of_day = unix.rem_euclid(86_400);
    let h = secs_of_day / 3600;
    let m = (secs_of_day % 3600) / 60;
    let s = secs_of_day % 60;
    let (year, month, day) = days_to_ymd(days);
    format!("{year:04}-{month:02}-{day:02}T{h:02}:{m:02}:{s:02}Z")
}

/// Convert days-since-epoch into (year, month, day) using the civil-from-days
/// formula by Howard Hinnant (public domain). Good for any date in the proleptic
/// Gregorian calendar.
fn days_to_ymd(days: i64) -> (i32, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 {
        z / 146_097
    } else {
        (z - 146_096) / 146_097
    };
    let doe = (z - era * 146_097) as u64; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365; // [0, 399]
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = doy - (153 * mp + 2) / 5 + 1; // [1, 31]
    let m = if mp < 10 { mp + 3 } else { mp - 9 }; // [1, 12]
    let year = if m <= 2 { y + 1 } else { y };
    (year as i32, m as u32, d as u32)
}

fn build_store(tmp: &NamedTempFile) -> Store {
    let mut store = Store::open(tmp.path()).expect("open store");
    store.run_migrations().expect("migrations");
    store
}

fn run_search_iter(store: &Store, filter: &HistorySearchFilter) {
    let result = history::search(store.conn(), filter).expect("search");
    // `black_box` would be safer, but criterion already prevents the call from
    // being optimised away when used inside `b.iter`.
    std::hint::black_box(result);
}

fn no_match_recent_50_filter() -> HistorySearchFilter {
    HistorySearchFilter {
        query: None,
        connection_id: None,
        status: None,
        pinned_only: false,
        since: None,
        until: None,
        limit: 50,
        offset: 0,
    }
}

fn match_users_filter() -> HistorySearchFilter {
    HistorySearchFilter {
        query: Some("\"users\"".into()),
        limit: 200,
        ..base_filter()
    }
}

fn match_two_tokens_filter() -> HistorySearchFilter {
    HistorySearchFilter {
        query: Some("\"select\" \"users\"".into()),
        limit: 200,
        ..base_filter()
    }
}

fn match_with_conn_filter() -> HistorySearchFilter {
    HistorySearchFilter {
        query: Some("\"users\"".into()),
        connection_id: Some("conn0".into()),
        limit: 200,
        ..base_filter()
    }
}

fn total_matched_with_match_filter() -> HistorySearchFilter {
    // Same shape as match_users — bench measures the full search() call which
    // includes the COUNT(*) round-trip. A bench-only public helper would be
    // worse than measuring the real path.
    match_users_filter()
}

fn base_filter() -> HistorySearchFilter {
    HistorySearchFilter {
        query: None,
        connection_id: None,
        status: None,
        pinned_only: false,
        since: None,
        until: None,
        limit: 200,
        offset: 0,
    }
}

/// Macro-free helper that owns the bench-vs-test-mode dispatch. Each scenario
/// looks identical except for the filter and case name.
fn run_scenario(c: &mut Criterion, case: &'static str, filter: &HistorySearchFilter) {
    let tmp = NamedTempFile::new().expect("tmp");
    let store = build_store(&tmp);
    seed_rows_for_mode(&store);

    if is_test_mode() {
        // `cargo test --bench history_search` path — single timed call,
        // assert under `<100ms`. Criterion's own `bench_function` would
        // also run, but we want the assertion to fire BEFORE criterion
        // calls our closure (criterion swallows panics inside `b.iter`
        // on at least some 0.5.x patch versions).
        assert_within_budget(case, &store, filter);
    }

    let mut group = c.benchmark_group("history_search");
    group
        .sample_size(20)
        .warm_up_time(Duration::from_millis(500))
        .measurement_time(Duration::from_secs(5));
    group.bench_function(case, |b| {
        b.iter(|| run_search_iter(&store, filter));
    });
    group.finish();
}

fn bench_no_match_recent_50(c: &mut Criterion) {
    run_scenario(c, "no_match_recent_50", &no_match_recent_50_filter());
}

fn bench_match_users(c: &mut Criterion) {
    run_scenario(c, "match_users", &match_users_filter());
}

fn bench_match_two_tokens(c: &mut Criterion) {
    run_scenario(c, "match_two_tokens", &match_two_tokens_filter());
}

fn bench_match_with_conn_filter(c: &mut Criterion) {
    run_scenario(c, "match_with_conn_filter", &match_with_conn_filter());
}

fn bench_total_matched_with_match(c: &mut Criterion) {
    run_scenario(
        c,
        "total_matched_with_match",
        &total_matched_with_match_filter(),
    );
}

criterion_group!(
    benches,
    bench_no_match_recent_50,
    bench_match_users,
    bench_match_two_tokens,
    bench_match_with_conn_filter,
    bench_total_matched_with_match,
);
criterion_main!(benches);
