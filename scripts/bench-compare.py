#!/usr/bin/env python3
"""scripts/bench-compare.py — perf regression gate.

Compare a fresh capture (criterion target dir or the JSON produced by
`bench-baseline.sh`) against the committed `src-tauri/benches/baselines.json`.
Exits 0 when every bench is within tolerance, exits 1 with a summary
table when any bench regressed. Used by `.github/workflows/perf-bench.yml`.

Usage
-----
  # Compare a freshly produced JSON file against the committed baseline:
  python3 scripts/bench-compare.py src-tauri/benches/baselines.json /tmp/new.json

  # Compare a Criterion target/criterion/ tree directly (no baseline regen):
  python3 scripts/bench-compare.py src-tauri/benches/baselines.json \
      --criterion-dir src-tauri/target/criterion

Exit codes
----------
  0 — every bench within tolerance AND under target_max_ns
  1 — at least one regression OR target overrun
  2 — usage error / missing data

Override (one-off intentional regression)
-----------------------------------------
  Set $BENCH_ALLOW_REGRESSION=1 in the CI environment when the merge commit
  message contains the tag `bench-allow-regression: <reason>`. The CI
  workflow handles the tag detection; the script just honours the env var.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Dict, Iterable, Optional, Tuple


def _load_baseline(path: str) -> Tuple[Dict[str, Dict[str, Optional[int]]], int]:
    with open(path) as fh:
        data = json.load(fh)
    benches = data.get("benches") or {}
    tol = int(data.get("tolerance_pct", 10))
    out: Dict[str, Dict[str, Optional[int]]] = {}
    for k, v in benches.items():
        out[k] = {
            "median_ns": int(v["median_ns"]) if v.get("median_ns") is not None else None,
            "target_max_ns": int(v["target_max_ns"]) if v.get("target_max_ns") is not None else None,
        }
    return out, tol


def _load_capture_from_json(path: str) -> Dict[str, int]:
    with open(path) as fh:
        data = json.load(fh)
    benches = data.get("benches") or {}
    return {k: int(v["median_ns"]) for k, v in benches.items() if v.get("median_ns") is not None}


# Mirror of the `known` table in bench-baseline.sh — kept in sync by hand.
# Adding a new bench requires entries here, in bench-baseline.sh, and in
# baselines.json.
KNOWN_BENCHES: Dict[str, Iterable[str]] = {
    "parser_bench": ("parse_ddl_100lines", "parse_select_typical"),
    "autocomplete_latency": (
        "autocomplete_parse_corpus/all_queries",
        "autocomplete_parse_corpus/query/0",
        "autocomplete_parse_corpus/query/1",
        "autocomplete_parse_corpus/query/2",
        "autocomplete_parse_corpus/query/3",
        "autocomplete_parse_corpus/query/4",
        "autocomplete_parse_corpus/query/5",
        "autocomplete_parse_corpus/query/6",
        "autocomplete_parse_corpus/query/7",
        "autocomplete_parse_corpus/query/8",
        "autocomplete_parse_corpus/query/9",
        "autocomplete_scope_extraction_corpus",
        "autocomplete_parse_64_join_query",
    ),
    "explain_render": (
        "explain_parse_500_nodes_fixture",
        "explain_walk_500_nodes_fixture",
        "explain_insights_500_nodes_fixture",
        "explain_parse_50_nodes",
        "explain_parse_25_nodes",
    ),
    "result_grid_format": (
        "result_grid_serialize/query_result_to_json/1000",
        "result_grid_serialize/query_result_to_json/10000",
        "result_grid_serialize/query_result_to_json/100000",
    ),
}


def _load_capture_from_criterion(crit_root: str) -> Dict[str, int]:
    out: Dict[str, int] = {}
    for fname, ids in KNOWN_BENCHES.items():
        for bid in ids:
            est = os.path.join(crit_root, bid, "new", "estimates.json")
            if not os.path.isfile(est):
                continue
            with open(est) as fh:
                data = json.load(fh)
            pe = data.get("median", {}).get("point_estimate")
            if pe is None:
                continue
            out[f"{fname}::{bid}"] = int(pe)
    return out


def _fmt(ns: Optional[int]) -> str:
    if ns is None:
        return "—"
    if ns >= 1_000_000_000:
        return f"{ns / 1_000_000_000:.2f}s"
    if ns >= 1_000_000:
        return f"{ns / 1_000_000:.2f}ms"
    if ns >= 1_000:
        return f"{ns / 1_000:.1f}µs"
    return f"{ns}ns"


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("baseline", help="Path to committed baselines.json")
    p.add_argument("capture", nargs="?", help="Path to a fresh baseline-style JSON (from bench-baseline.sh)")
    p.add_argument("--criterion-dir", help="Path to target/criterion (alternative to a JSON capture)")
    args = p.parse_args()

    if not args.capture and not args.criterion_dir:
        print("error: provide either CAPTURE or --criterion-dir", file=sys.stderr)
        return 2

    baseline, tolerance_pct = _load_baseline(args.baseline)

    if args.capture:
        capture = _load_capture_from_json(args.capture)
    else:
        capture = _load_capture_from_criterion(args.criterion_dir)

    if not capture:
        print("error: no medians found in capture", file=sys.stderr)
        return 2

    allow_one_off = os.environ.get("BENCH_ALLOW_REGRESSION") == "1"

    # ---- Compare ----
    rows = []  # (bench, base_ns, fresh_ns, delta_pct, status)
    failed = False
    missing_capture: list[str] = []

    for key, base in baseline.items():
        base_ns = base["median_ns"]
        target_max = base["target_max_ns"]
        fresh_ns = capture.get(key)
        if fresh_ns is None:
            missing_capture.append(key)
            rows.append((key, base_ns, None, None, "MISSING"))
            failed = True
            continue
        if base_ns is None:
            rows.append((key, None, fresh_ns, None, "NO-BASELINE"))
            continue

        delta = (fresh_ns - base_ns) / base_ns * 100.0
        threshold_overrun = (target_max is not None) and (fresh_ns > target_max)
        regressed = delta > tolerance_pct
        status_parts: list[str] = []
        if regressed:
            status_parts.append(f"REGRESS+{delta:.1f}%")
        if threshold_overrun:
            status_parts.append(f"OVER-TARGET ({_fmt(target_max)})")
        status = " / ".join(status_parts) if status_parts else f"OK ({delta:+.1f}%)"
        if regressed or threshold_overrun:
            failed = True
        rows.append((key, base_ns, fresh_ns, delta, status))

    # Surface fresh benches not in baseline (info-only).
    for key in sorted(set(capture.keys()) - set(baseline.keys())):
        rows.append((key, None, capture[key], None, "NEW (not in baseline)"))

    # ---- Print summary ----
    name_w = max((len(r[0]) for r in rows), default=10)
    print(f"\nperf-bench comparison — tolerance = {tolerance_pct}%")
    print("─" * (name_w + 50))
    print(f"{'bench'.ljust(name_w)}  {'baseline'.rjust(10)}  {'fresh'.rjust(10)}  status")
    print("─" * (name_w + 50))
    for key, base_ns, fresh_ns, _delta, status in rows:
        print(f"{key.ljust(name_w)}  {_fmt(base_ns).rjust(10)}  {_fmt(fresh_ns).rjust(10)}  {status}")
    print("─" * (name_w + 50))

    if missing_capture:
        print(f"\n!! {len(missing_capture)} bench(es) missing from capture:")
        for k in missing_capture:
            print(f"   - {k}")

    if failed and allow_one_off:
        print(
            "\nBENCH_ALLOW_REGRESSION=1 set — regression(s) tolerated for this run.\n"
            "Refresh the baseline (bash scripts/bench-baseline.sh) on the next merged commit.",
            file=sys.stderr,
        )
        return 0

    if failed:
        print(
            "\nFAIL — at least one bench regressed beyond tolerance or exceeded target.\n"
            "If intentional, add `bench-allow-regression: <reason>` to the merge commit\n"
            "message and re-run, then refresh baselines.json.",
            file=sys.stderr,
        )
        return 1

    print("\nOK — all benches within tolerance.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
