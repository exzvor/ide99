// — owner: .
//
// Pure SQL builder for the pg_stat_statements tab. The sortBy column is
// validated against an allowlist before interpolation, so the resulting
// SQL string is safe to execute even though it isn't parameterised
// (PostgreSQL doesn't accept bind parameters in ORDER BY positions).
export type StatementsSortColumn =
  | "calls"
  | "total_exec_time"
  | "mean_exec_time"
  | "rows"
  | "shared_blks_hit";

const ALLOWED = new Set<StatementsSortColumn>([
  "calls",
  "total_exec_time",
  "mean_exec_time",
  "rows",
  "shared_blks_hit",
]);

export function buildStatementsQuery(input: {
  topN: number;
  sortBy: StatementsSortColumn;
  sortDir: "asc" | "desc";
}): string {
  if (!ALLOWED.has(input.sortBy)) throw new Error("invalid sort column");
  const dir = input.sortDir === "asc" ? "ASC" : "DESC";
  const limit = Math.max(1, Math.min(input.topN, 5000));
  return [
    "SELECT",
    "  query,",
    "  calls,",
    "  total_exec_time,",
    "  mean_exec_time,",
    "  rows,",
    "  shared_blks_hit",
    "FROM pg_stat_statements",
    `ORDER BY ${input.sortBy} ${dir}`,
    `LIMIT ${limit}`,
  ].join("\n");
}
