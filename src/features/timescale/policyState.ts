// — owner: .
// Per-table policy state loaders. Each loader queries
// `timescaledb_information.jobs` (the documented public view) and parses the
// JSON `config` column into a small policy-shaped object suitable for
// pre-filling the corresponding dialog. Permission-denied / extension-absent
// degrades to null so dialogs simply render in "create" mode.
import { queryExecute } from "../../lib/tauri";

export type CompressionPolicy = { jobId: number; compressAfter: string };
export type RetentionPolicy = { jobId: number; dropAfter: string };
export type RefreshPolicy = {
  jobId: number;
  startOffset: string;
  endOffset: string;
  scheduleInterval: string;
};

function escSql(value: string): string {
  return value.replace(/'/g, "''");
}

// Postgres returns intervals in JSON as either compact form ("7 days") or the
// older verbose form ("@ 7 days"). Strip the verbose marker so the form's
// IntervalInput can re-parse the canonical "<n> <unit>s" shape.
function stripIntervalPrefix(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.replace(/^@\s+/, "").trim();
}

function buildJobsSql(proc: string, schema: string, table: string): string {
  return `SELECT job_id, config, schedule_interval\nFROM timescaledb_information.jobs\nWHERE proc_name = '${escSql(proc)}'\n  AND hypertable_schema = '${escSql(schema)}'\n  AND hypertable_name = '${escSql(table)}'\nLIMIT 1`;
}

function parseJobId(raw: string | null): number | null {
  if (raw === null) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

function parseConfig(raw: string | null): Record<string, unknown> {
  if (raw === null) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function loadCompressionPolicy(
  connId: string,
  schema: string,
  table: string,
): Promise<CompressionPolicy | null> {
  try {
    const result = await queryExecute(connId, buildJobsSql("policy_compression", schema, table));
    const row = result.rows[0];
    if (!row) return null;
    const jobId = parseJobId(row[0] ?? null);
    const config = parseConfig(row[1] ?? null);
    const compressAfter = stripIntervalPrefix(config.compress_after);
    if (jobId === null || compressAfter === null) return null;
    return { jobId, compressAfter };
  } catch {
    return null;
  }
}

export async function loadRetentionPolicy(
  connId: string,
  schema: string,
  table: string,
): Promise<RetentionPolicy | null> {
  try {
    const result = await queryExecute(connId, buildJobsSql("policy_retention", schema, table));
    const row = result.rows[0];
    if (!row) return null;
    const jobId = parseJobId(row[0] ?? null);
    const config = parseConfig(row[1] ?? null);
    const dropAfter = stripIntervalPrefix(config.drop_after);
    if (jobId === null || dropAfter === null) return null;
    return { jobId, dropAfter };
  } catch {
    return null;
  }
}

export async function loadRefreshPolicy(
  connId: string,
  schema: string,
  view: string,
): Promise<RefreshPolicy | null> {
  try {
    const result = await queryExecute(
      connId,
      buildJobsSql("policy_refresh_continuous_aggregate", schema, view),
    );
    const row = result.rows[0];
    if (!row) return null;
    const jobId = parseJobId(row[0] ?? null);
    const config = parseConfig(row[1] ?? null);
    const startOffset = stripIntervalPrefix(config.start_offset);
    const endOffset = stripIntervalPrefix(config.end_offset);
    const scheduleInterval = stripIntervalPrefix(row[2] ?? null);
    if (jobId === null || startOffset === null || endOffset === null || scheduleInterval === null) {
      return null;
    }
    return { jobId, startOffset, endOffset, scheduleInterval };
  } catch {
    return null;
  }
}
