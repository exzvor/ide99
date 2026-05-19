/**
 * — shared plan-node helpers used by QuietPlanCanvas,
 * NodeDetailsPanel, and PlanNodeList. Pure TS, no React deps.
 *
 * The pev2 plan JSON shape is the same one Postgres emits for
 * `EXPLAIN (FORMAT JSON)` — a top-level array with one element holding
 * `{ Plan: { ..., Plans: [...] } }`. Field names use Postgres' Title Case.
 */

export type PlanNodeRecord = Record<string, unknown>;

export function isPlanNode(v: unknown): v is PlanNodeRecord {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function asString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

export function asNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function collectChildren(node: PlanNodeRecord): PlanNodeRecord[] {
  const plans = node.Plans;
  if (!Array.isArray(plans)) return [];
  return plans.filter(isPlanNode);
}

/**
 * Canonical node label used both for substring-highlight (forwarded to
 * pev2 / our DAG) and for human display in lists.
 */
export function buildNodeLabel(node: PlanNodeRecord): string {
  const nodeType = asString(node["Node Type"]) ?? "Unknown";
  const rel = asString(node["Relation Name"]);
  if (!rel) return nodeType;
  const schema = asString(node.Schema);
  const head = schema ? `${nodeType} on ${schema}.${rel}` : `${nodeType} on ${rel}`;
  const alias = asString(node.Alias);
  if (alias && alias !== rel) return `${head} (${alias})`;
  return head;
}

/**
 * One-line meta hint for the DAG card — picks the most informative
 * available descriptor (cond / sort key / group key). Returns null when
 * the only available meta would just repeat the relation that consumers
 * already display in the header (e.g. "Seq Scan on order_items"), so we
 * don't print the relation name twice.
 */
export function buildShortMeta(node: PlanNodeRecord): string | null {
  const cond =
    asString(node["Hash Cond"]) ??
    asString(node["Index Cond"]) ??
    asString(node["Join Filter"]) ??
    asString(node.Filter);
  if (cond) return cond.replace(/^\(|\)$/g, "").slice(0, 50);
  const sortKey = node["Sort Key"];
  if (Array.isArray(sortKey) && sortKey.length > 0) return `by ${sortKey.join(", ")}`;
  const groupKey = node["Group Key"];
  if (Array.isArray(groupKey) && groupKey.length > 0) return `group by ${groupKey.join(", ")}`;
  return null;
}

/**
 * Cheap heuristic severity tag derived from a node's own metrics. Used as
 * a fallback when computeInsights() didn't flag the node — keeps the
 * coloured-card visual cue consistent (e.g. a Seq Scan with 5M actual
 * rows that didn't match the R1 filter precondition still gets a "hot"
 * tint).
 */
export function classifySeverity(node: PlanNodeRecord): "ok" | "hot" | "crit" {
  const nodeType = asString(node["Node Type"]) ?? "";
  const rows = asNumber(node["Actual Rows"]) ?? asNumber(node["Plan Rows"]) ?? 0;
  if (nodeType === "Seq Scan" && rows > 1_000_000) return "crit";
  if (nodeType === "Seq Scan" && rows > 100_000) return "hot";
  const loops = asNumber(node["Actual Loops"]) ?? 0;
  if (nodeType === "Nested Loop" && loops > 50_000) return "crit";
  if (nodeType === "Nested Loop" && loops > 10_000) return "hot";
  return "ok";
}

export interface BufferStats {
  hit: number;
  read: number;
  dirtied: number;
  written: number;
  total: number;
}

export function readBuffers(node: PlanNodeRecord): BufferStats | null {
  const hit = asNumber(node["Shared Hit Blocks"]) ?? 0;
  const read = asNumber(node["Shared Read Blocks"]) ?? 0;
  const dirtied = asNumber(node["Shared Dirtied Blocks"]) ?? 0;
  const written = asNumber(node["Shared Written Blocks"]) ?? 0;
  const total = hit + read + dirtied + written;
  if (total === 0) return null;
  return { hit, read, dirtied, written, total };
}

export function blocksToBytes(blocks: number, blockSize = 8192): number {
  return blocks * blockSize;
}

export function prettyBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Resolve a plan node by its `path` (as produced by planDiff's walker —
 * empty array = root, then child indices into the `Plans` array). Returns
 * null if the path is invalid for the given plan.
 */
export function nodeAtPath(plan: unknown, path: number[]): PlanNodeRecord | null {
  if (!Array.isArray(plan) || plan.length === 0) return null;
  const root = (plan[0] as { Plan?: unknown })?.Plan;
  if (!isPlanNode(root)) return null;
  let cur: PlanNodeRecord = root;
  for (const idx of path) {
    const children = cur.Plans;
    if (!Array.isArray(children) || idx >= children.length) return null;
    const child = children[idx];
    if (!isPlanNode(child)) return null;
    cur = child;
  }
  return cur;
}
