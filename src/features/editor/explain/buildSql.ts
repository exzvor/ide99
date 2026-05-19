import type { ExplainOptions } from "../../../lib/tauri";

/**
 * Mirror of backend `build_explain_sql` (src-tauri/src/query/explain.rs).
 * Lives on the frontend so the UI can show the user the exact SQL that
 * will run (future status-bar / debug surface) and so the SQL builder is
 * unit-testable without IPC. The backend is the source of truth at
 * execution time — frontend mismatch would be a bug.
 *
 * Trailing `;` is stripped because Postgres rejects `EXPLAIN ... ;`
 * syntactically. WAL/TIMING are silently dropped when mode != analyze
 * (Postgres errors otherwise).
 */
export function buildExplainSql(userSql: string, options: ExplainOptions): string {
  const opts: string[] = ["FORMAT JSON", "BUFFERS", "SETTINGS"];
  if (options.mode === "analyze") {
    opts.push("ANALYZE");
    if (options.wal) opts.push("WAL");
    if (options.timing) opts.push("TIMING");
  }
  if (options.verbose) opts.push("VERBOSE");
  const stripped = userSql.trim().replace(/;\s*$/, "");
  return `EXPLAIN (${opts.join(", ")}) ${stripped}`;
}
