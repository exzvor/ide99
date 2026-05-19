/**
 * — pure-TS rule engine for EXPLAIN plans.
 *
 * `computeInsights(planJson)` walks the plan tree and returns zero or more
 * `Insight` cards. The walker is pure: same input → same output → same order.
 * Sorting: severity DESC (high > med > low) → nodePath lexicographically.
 */

export type InsightSeverity = "high" | "med" | "low";

export type InsightRuleId =
  | "R1_seq_scan_large"
  | "R2_hash_join_disk"
  | "R3_nested_loop_hot"
  | "R4_stale_stats";

export interface Insight {
  ruleId: InsightRuleId;
  severity: InsightSeverity;
  /** Indexes in `Plans[]` from the root of the plan tree, e.g. `[0, 1, 0]`. */
  nodePath: number[];
  /** Human-readable label like `"Seq Scan on public.users (u)"` — used both
   * for UI display and for pev2 highlight (passed as planQuery substring). */
  nodeLabel: string;
  titleKey: string;
  bodyKey: string;
  bodyParams: Record<string, string | number>;
  /** Ready-to-paste SQL for the F1 "Open in editor" action. Always begins
   * with a `-- Suggested by ide99 (rule Rx): …` comment line. */
  suggestedSql: string;
}

// --------------------------------------------------------------------------
// Internal types
// --------------------------------------------------------------------------

type PlanNode = Record<string, unknown>;

interface VisitedNode {
  node: PlanNode;
  path: number[];
}

const SEVERITY_RANK: Record<InsightSeverity, number> = {
  high: 0,
  med: 1,
  low: 2,
};

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

const isPlanNode = (v: unknown): v is PlanNode =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const asNumber = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

const asString = (v: unknown): string | null => (typeof v === "string" ? v : null);

const getChildren = (node: PlanNode): PlanNode[] => {
  const plans = node.Plans;
  if (!Array.isArray(plans)) return [];
  return plans.filter(isPlanNode);
};

/**
 * Depth-first walk over the plan tree starting at `[0].Plan`. The visit
 * callback receives every node and its path `[0, …]` (indices in `Plans[]`
 * from the root). Defensive: a non-array root or a missing/non-object
 * `Plan` key yields zero visits.
 */
function walkPlan(planJson: unknown, visit: (v: VisitedNode) => void): void {
  if (!Array.isArray(planJson) || planJson.length === 0) return;
  const first = planJson[0];
  if (!isPlanNode(first)) return;
  const root = first.Plan;
  if (!isPlanNode(root)) return;

  const stack: VisitedNode[] = [{ node: root, path: [0] }];
  // Iterative DFS that visits parents before children, preserving Plans[] order.
  while (stack.length > 0) {
    // We pop and push children in reverse so the visit order is left-to-right.
    const current = stack.pop();
    if (!current) break;
    visit(current);
    const kids = getChildren(current.node);
    for (let i = kids.length - 1; i >= 0; i--) {
      stack.push({ node: kids[i], path: [...current.path, i] });
    }
  }
}

/**
 * Parse a Postgres EXPLAIN `Filter` string and return the leftmost bare
 * column identifier participating in a comparison/predicate. Designed for
 * the common forms emitted by Postgres:
 *
 * "status = 'active'"             → "status"
 * "(created_at > now() - …)"      → "created_at"
 * "id IS NULL"                    → "id"
 * "id IN (1, 2, 3)"               → "id"
 * "((status)::text = 'a'::text)"  → null  (cast wrapper, not a bare ident)
 *
 * Returns null when no leftmost identifier-then-operator pair is present;
 * callers fall back to the literal placeholder "col".
 */
function parseFilterColumn(filter: string): string | null {
  // Strip leading `(` characters (Postgres wraps Filter in parens).
  const trimmed = filter.replace(/^\(+/, "").trimStart();
  // Match: <identifier> <operator> ... where operator is one of =, <, >, <=,
  // >=, <>, !=, IS, IN. Identifier must be a bare ASCII word (no preceding
  // punctuation other than the parens we stripped).
  const m = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*(=|<>|!=|<=|>=|<|>|IS\b|IN\b)/);
  return m ? m[1] : null;
}

/**
 * Format a Disk Usage value (Postgres reports it in kB) for human display.
 * 12   → "12 kB"
 * 1536 → "1.5 MB"
 */
function formatDiskUsage(kB: number): string {
  if (kB < 1024) return `${kB} kB`;
  return `${(kB / 1024).toFixed(1)} MB`;
}

/**
 * `nodeLabel` is shared by the UI side-panel and pev2 highlight. Format:
 * - relation-bearing → "<Node Type> on <Schema>.<Relation Name>" with an
 * optional " (<alias>)" suffix when alias differs from the relation.
 * Drops the "Schema." prefix when Schema is absent.
 * - non-relation     → "<Node Type>" alone.
 */
function buildNodeLabel(node: PlanNode): string {
  const nodeType = asString(node["Node Type"]) ?? "Unknown";
  const rel = asString(node["Relation Name"]);
  if (!rel) return nodeType;
  const schema = asString(node.Schema);
  const head = schema ? `${nodeType} on ${schema}.${rel}` : `${nodeType} on ${rel}`;
  const alias = asString(node.Alias);
  if (alias && alias !== rel) return `${head} (${alias})`;
  return head;
}

// --------------------------------------------------------------------------
// Rule implementations
// --------------------------------------------------------------------------

function ruleR1(visited: VisitedNode): Insight | null {
  const { node, path } = visited;
  if (asString(node["Node Type"]) !== "Seq Scan") return null;
  const filter = asString(node.Filter);
  if (filter === null) return null; // no Filter ⇒ full-table scan, indexing won't help
  const actual = asNumber(node["Actual Rows"]);
  const planRows = asNumber(node["Plan Rows"]);
  const rows = actual ?? planRows;
  if (rows === null || rows <= 1_000_000) return null;

  const rel = asString(node["Relation Name"]) ?? "rel";
  const schema = asString(node.Schema) ?? "public";
  const parsedCol = parseFilterColumn(filter);
  const col = parsedCol ?? "col";

  const sql = [
    `-- Suggested by ide99 (rule R1): Seq Scan on ${rows} rows`,
    `CREATE INDEX CONCURRENTLY idx_${rel}_${col} ON ${schema}.${rel} (${col});`,
  ].join("\n");

  return {
    ruleId: "R1_seq_scan_large",
    severity: "high",
    nodePath: path,
    nodeLabel: buildNodeLabel(node),
    titleKey: "editor.explain.insights.rule.r1.title",
    bodyKey: "editor.explain.insights.rule.r1.body",
    bodyParams: { node: buildNodeLabel(node), rows, column: col },
    suggestedSql: sql,
  };
}

/**
 * Search the subtree rooted at `node` (excluding the root) for the first
 * `Hash` node with `Disk Usage > 0`, returning its kB value or null.
 */
function findHashDiskUsage(node: PlanNode): number | null {
  for (const child of getChildren(node)) {
    if (asString(child["Node Type"]) === "Hash") {
      const disk = asNumber(child["Disk Usage"]);
      if (disk !== null && disk > 0) return disk;
    }
    const deeper = findHashDiskUsage(child);
    if (deeper !== null) return deeper;
  }
  return null;
}

function ruleR2(visited: VisitedNode): Insight | null {
  const { node, path } = visited;
  if (asString(node["Node Type"]) !== "Hash Join") return null;
  const disk = findHashDiskUsage(node);
  if (disk === null) return null;

  const sql = [
    "-- Suggested by ide99 (rule R2): Hash Join spilled to disk",
    "SET work_mem = '64MB';",
    "-- Or build an index on the join key so planner picks Merge Join.",
  ].join("\n");

  return {
    ruleId: "R2_hash_join_disk",
    severity: "med",
    nodePath: path,
    nodeLabel: buildNodeLabel(node),
    titleKey: "editor.explain.insights.rule.r2.title",
    bodyKey: "editor.explain.insights.rule.r2.body",
    bodyParams: { node: buildNodeLabel(node), disk: formatDiskUsage(disk) },
    suggestedSql: sql,
  };
}

/**
 * Locate the inner relation child of a Nested Loop. Postgres convention puts
 * the inner side at children[1]; if that child has no `Relation Name`,
 * descend into its subtree to find the first descendant that does.
 */
function findInnerRelationNode(loop: PlanNode): PlanNode | null {
  const kids = getChildren(loop);
  if (kids.length < 2) {
    // Fall back to scanning all children for one with a relation.
    for (const k of kids) {
      const found = findFirstRelation(k);
      if (found) return found;
    }
    return null;
  }
  const innerSide = kids[1];
  return findFirstRelation(innerSide);
}

function findFirstRelation(node: PlanNode): PlanNode | null {
  if (asString(node["Relation Name"])) return node;
  for (const child of getChildren(node)) {
    const found = findFirstRelation(child);
    if (found) return found;
  }
  return null;
}

function ruleR3(visited: VisitedNode): Insight | null {
  const { node, path } = visited;
  if (asString(node["Node Type"]) !== "Nested Loop") return null;
  const loops = asNumber(node["Actual Loops"]);
  if (loops === null || loops <= 10_000) return null;

  const inner = findInnerRelationNode(node);
  const innerRel = (inner && asString(inner["Relation Name"])) ?? "rel";
  const schema = (inner && asString(inner.Schema)) ?? "public";

  // Try to recover a column from any Index Cond / Hash Cond / Filter on the
  // inner-side node we picked.
  let col: string | null = null;
  if (inner) {
    for (const key of ["Index Cond", "Hash Cond", "Filter"] as const) {
      const cond = asString(inner[key]);
      if (cond) {
        const parsed = parseFilterColumn(cond);
        if (parsed) {
          col = parsed;
          break;
        }
      }
    }
  }
  const column = col ?? "col";

  const sql = [
    "-- Suggested by ide99 (rule R3): Hot Nested Loop",
    `CREATE INDEX CONCURRENTLY idx_${innerRel}_${column} ON ${schema}.${innerRel} (${column});`,
  ].join("\n");

  return {
    ruleId: "R3_nested_loop_hot",
    severity: "high",
    nodePath: path,
    nodeLabel: buildNodeLabel(node),
    titleKey: "editor.explain.insights.rule.r3.title",
    bodyKey: "editor.explain.insights.rule.r3.body",
    bodyParams: {
      node: buildNodeLabel(node),
      loops,
      column,
      innerRel,
    },
    suggestedSql: sql,
  };
}

function ruleR4(visited: VisitedNode): Insight | null {
  const { node, path } = visited;
  const rel = asString(node["Relation Name"]);
  if (!rel) return null;
  const actual = asNumber(node["Actual Rows"]);
  const planRows = asNumber(node["Plan Rows"]);
  if (actual === null || actual < 100) return null;
  // planRows missing → guard against null; treat as 0 for ratio purposes.
  const safePlan = planRows ?? 0;
  const overEstimate = safePlan / Math.max(actual, 1);
  const underEstimate = actual / Math.max(safePlan, 1);
  const worstRatio = Math.max(overEstimate, underEstimate);
  if (worstRatio < 10) return null;

  const schema = asString(node.Schema) ?? "public";
  const sql = [
    `-- Suggested by ide99 (rule R4): Stale stats on ${rel}`,
    `ANALYZE ${schema}.${rel};`,
  ].join("\n");

  return {
    ruleId: "R4_stale_stats",
    severity: "med",
    nodePath: path,
    nodeLabel: buildNodeLabel(node),
    titleKey: "editor.explain.insights.rule.r4.title",
    bodyKey: "editor.explain.insights.rule.r4.body",
    bodyParams: {
      relation: rel,
      estRows: safePlan,
      actualRows: actual,
      ratio: Math.round(worstRatio),
    },
    suggestedSql: sql,
  };
}

// --------------------------------------------------------------------------
// Sorting
// --------------------------------------------------------------------------

function compareNodePath(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length; // shorter path wins on prefix tie
}

function compareInsights(a: Insight, b: Insight): number {
  const sevDelta = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
  if (sevDelta !== 0) return sevDelta;
  return compareNodePath(a.nodePath, b.nodePath);
}

// --------------------------------------------------------------------------
// Public entry point
// --------------------------------------------------------------------------

export function computeInsights(planJson: unknown): Insight[] {
  const insights: Insight[] = [];
  const r4SeenRelations = new Set<string>();

  walkPlan(planJson, (visited) => {
    const r1 = ruleR1(visited);
    if (r1) insights.push(r1);

    const r2 = ruleR2(visited);
    if (r2) insights.push(r2);

    const r3 = ruleR3(visited);
    if (r3) insights.push(r3);

    const r4 = ruleR4(visited);
    if (r4) {
      const rel = asString(visited.node["Relation Name"]);
      if (rel && !r4SeenRelations.has(rel)) {
        r4SeenRelations.add(rel);
        insights.push(r4);
      }
    }
  });

  insights.sort(compareInsights);
  return insights;
}
