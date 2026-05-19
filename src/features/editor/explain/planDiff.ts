/**
 * — pure-TS plan diff engine.
 *
 * `diffPlans(left, right)` matches nodes between two EXPLAIN plans using a
 * hybrid identity: relation+alias for relation-bearing nodes (Seq/Index/
 * IndexOnly/Bitmap/Foreign Scan), CTE/subquery alias for those scans, and
 * a parent-key + sibling-index fallback for structural nodes (Sort, Hash,
 * Aggregate, Limit, Append, Gather). Unmatched nodes are reported in
 * `addedRight` / `removedLeft`.
 */

export interface MatchedNode {
  leftPath: number[];
  rightPath: number[];
  identityKey: string;
  /** Pretty label for the matched pair, e.g. "Seq Scan → Index Scan on users". */
  label: string;
  nodeTypeChanged: boolean;
  leftNodeType: string;
  rightNodeType: string;
  costDelta: number | null;
  /** Milliseconds; null when either side lacks ANALYZE. */
  timeDelta: number | null;
  rowsDelta: number | null;
}

export interface UnmatchedNode {
  path: number[];
  identityKey: string;
  label: string;
  nodeType: string;
  totalCost: number | null;
  actualTime: number | null;
}

export interface PlanDiff {
  matched: MatchedNode[];
  /** Nodes present in the right plan but absent from the left. */
  addedRight: UnmatchedNode[];
  /** Nodes present in the left plan but absent from the right. */
  removedLeft: UnmatchedNode[];
  summary: {
    totalCostLeft: number | null;
    totalCostRight: number | null;
    totalTimeLeft: number | null;
    totalTimeRight: number | null;
    leftNodeCount: number;
    rightNodeCount: number;
  };
}

const EMPTY_SUMMARY = {
  totalCostLeft: null,
  totalCostRight: null,
  totalTimeLeft: null,
  totalTimeRight: null,
  leftNodeCount: 0,
  rightNodeCount: 0,
} as const;

/* ----------------------------- internals ---------------------------- */

type PlanNode = Record<string, unknown>;

interface WalkedNode {
  node: PlanNode;
  path: number[];
  identityKey: string;
  /** True when the same identity key was already seen on this side; ambiguous
   * duplicates are excluded from matching but still counted in node totals. */
  ambiguous: boolean;
}

function isPlanNode(value: unknown): value is PlanNode {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getStr(node: PlanNode, key: string): string | undefined {
  const v = node[key];
  return typeof v === "string" ? v : undefined;
}

function getNum(node: PlanNode, key: string): number | null {
  const v = node[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function nodeType(node: PlanNode): string {
  return getStr(node, "Node Type") ?? "";
}

function hasRelation(node: PlanNode): boolean {
  return typeof node["Relation Name"] === "string";
}

function buildIdentityKey(node: PlanNode, parentKey: string, siblingIndex: number): string {
  if (hasRelation(node)) {
    const schema = getStr(node, "Schema") ?? "";
    const rel = getStr(node, "Relation Name") ?? "";
    const alias = getStr(node, "Alias") ?? rel;
    return `rel:${schema}.${rel}:${alias}`;
  }
  const t = nodeType(node);
  if (t === "CTE Scan") {
    return `cte:${getStr(node, "CTE Name") ?? "_"}`;
  }
  if (t === "Subquery Scan") {
    return `sub:${getStr(node, "Alias") ?? "_"}`;
  }
  return `${parentKey}>${t}#${siblingIndex}`;
}

/** Predicts whether a child PlanNode would receive a structural identity key
 * (i.e. NOT relation/cte/sub-prefixed). Used to compute siblingIndex slots. */
function isStructuralChild(node: PlanNode): boolean {
  if (hasRelation(node)) return false;
  const t = nodeType(node);
  if (t === "CTE Scan" || t === "Subquery Scan") return false;
  return true;
}

function buildNodeLabel(node: PlanNode): string {
  const t = nodeType(node);
  if (hasRelation(node)) {
    const schema = getStr(node, "Schema");
    const rel = getStr(node, "Relation Name") ?? "";
    const alias = getStr(node, "Alias");
    const qualified = schema ? `${schema}.${rel}` : rel;
    let label = `${t} on ${qualified}`;
    if (alias && alias !== rel) label += ` (${alias})`;
    return label;
  }
  if (t === "CTE Scan") {
    const cte = getStr(node, "CTE Name");
    return cte ? `${t} on ${cte}` : t;
  }
  // Subquery Scan and structural — just the node type
  return t;
}

/** Anchor extracted from a node's identity (relation name, CTE name, or
 * subquery alias). Returns null for purely structural nodes. */
function anchorOf(node: PlanNode): string | null {
  if (hasRelation(node)) {
    const schema = getStr(node, "Schema");
    const rel = getStr(node, "Relation Name") ?? "";
    const alias = getStr(node, "Alias");
    const qualified = schema ? `${schema}.${rel}` : rel;
    return alias && alias !== rel ? `${qualified} (${alias})` : qualified;
  }
  const t = nodeType(node);
  if (t === "CTE Scan") return getStr(node, "CTE Name") ?? null;
  if (t === "Subquery Scan") return getStr(node, "Alias") ?? null;
  return null;
}

function buildPairLabel(left: PlanNode, right: PlanNode): string {
  const lt = nodeType(left);
  const rt = nodeType(right);
  if (lt === rt) return buildNodeLabel(left);
  // Different node types — both should share an anchor (since their identity
  // keys matched and a structural key embeds Node Type, so a same-key cross
  // node-type match implies a relation/cte/sub anchor).
  const anchorL = anchorOf(left);
  const anchorR = anchorOf(right);
  const anchor = anchorL ?? anchorR;
  if (anchor) return `${lt} → ${rt} on ${anchor}`;
  return `${lt} → ${rt}`;
}

/** Extract the root Plan node from raw EXPLAIN JSON. Returns null on any
 * malformed shape — never throws. */
function extractRoot(raw: unknown): PlanNode | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const first = raw[0];
  if (!isPlanNode(first)) return null;
  const plan = first.Plan;
  if (!isPlanNode(plan)) return null;
  if (typeof plan["Node Type"] !== "string") return null;
  return plan;
}

/** DFS walker. Pushes a WalkedNode for each plan node and returns the count
 * of nodes walked (== array length, but explicit for clarity). */
function walk(root: PlanNode, out: WalkedNode[]): number {
  const seen = new Set<string>();

  const visit = (node: PlanNode, path: number[], parentKey: string, siblingIndex: number) => {
    const identityKey = buildIdentityKey(node, parentKey, siblingIndex);
    const ambiguous = seen.has(identityKey);
    if (!ambiguous) seen.add(identityKey);
    out.push({ node, path, identityKey, ambiguous });

    const plans = node.Plans;
    if (!Array.isArray(plans)) return;
    let structuralIdx = 0;
    for (let i = 0; i < plans.length; i++) {
      const child = plans[i];
      if (!isPlanNode(child)) continue;
      const childIsStructural = isStructuralChild(child);
      const childSiblingIndex = childIsStructural ? structuralIdx : 0;
      if (childIsStructural) structuralIdx++;
      visit(child, [...path, i], identityKey, childSiblingIndex);
    }
  };

  visit(root, [], "", 0);
  return out.length;
}

function unmatchedFrom(walked: WalkedNode): UnmatchedNode {
  return {
    path: walked.path,
    identityKey: walked.identityKey,
    label: buildNodeLabel(walked.node),
    nodeType: nodeType(walked.node),
    totalCost: getNum(walked.node, "Total Cost"),
    actualTime: getNum(walked.node, "Actual Total Time"),
  };
}

function safeDelta(a: number | null, b: number | null): number | null {
  if (a === null || b === null) return null;
  return b - a;
}

/* ------------------------------- API -------------------------------- */

export function diffPlans(left: unknown, right: unknown): PlanDiff {
  const leftRoot = extractRoot(left);
  const rightRoot = extractRoot(right);

  if (!leftRoot && !rightRoot) {
    return {
      matched: [],
      addedRight: [],
      removedLeft: [],
      summary: { ...EMPTY_SUMMARY },
    };
  }

  const leftWalked: WalkedNode[] = [];
  const rightWalked: WalkedNode[] = [];
  if (leftRoot) walk(leftRoot, leftWalked);
  if (rightRoot) walk(rightRoot, rightWalked);

  // Build maps of first-occurrence per identity key on each side.
  const leftMap = new Map<string, WalkedNode>();
  for (const w of leftWalked) {
    if (!w.ambiguous && !leftMap.has(w.identityKey)) leftMap.set(w.identityKey, w);
  }
  const rightMap = new Map<string, WalkedNode>();
  for (const w of rightWalked) {
    if (!w.ambiguous && !rightMap.has(w.identityKey)) rightMap.set(w.identityKey, w);
  }

  const matched: MatchedNode[] = [];
  const removedLeft: UnmatchedNode[] = [];
  const addedRight: UnmatchedNode[] = [];

  // Track which keys on each side were consumed by a match so the ambiguous
  // duplicates fall through to addedRight/removedLeft below.
  const matchedKeys = new Set<string>();

  for (const [key, l] of leftMap) {
    const r = rightMap.get(key);
    if (r) {
      matchedKeys.add(key);
      const lCost = getNum(l.node, "Total Cost");
      const rCost = getNum(r.node, "Total Cost");
      const lTime = getNum(l.node, "Actual Total Time");
      const rTime = getNum(r.node, "Actual Total Time");
      const lRows = getNum(l.node, "Actual Rows");
      const rRows = getNum(r.node, "Actual Rows");
      const leftType = nodeType(l.node);
      const rightType = nodeType(r.node);
      matched.push({
        leftPath: l.path,
        rightPath: r.path,
        identityKey: key,
        label: buildPairLabel(l.node, r.node),
        nodeTypeChanged: leftType !== rightType,
        leftNodeType: leftType,
        rightNodeType: rightType,
        costDelta: safeDelta(lCost, rCost),
        timeDelta: safeDelta(lTime, rTime),
        rowsDelta: safeDelta(lRows, rRows),
      });
    }
  }

  // removedLeft: every left node whose key didn't make it into a match.
  // This includes ambiguous duplicates and leftMap-only entries.
  for (const w of leftWalked) {
    if (!matchedKeys.has(w.identityKey) || w.ambiguous) {
      // First occurrence of an ambiguous-only key (i.e. the canonical entry
      // got matched) shouldn't double-count — matched already covered it.
      if (matchedKeys.has(w.identityKey)) {
        // ambiguous duplicate of a matched key → goes to removedLeft
        if (!w.ambiguous) continue;
      }
      removedLeft.push(unmatchedFrom(w));
    }
  }

  for (const w of rightWalked) {
    if (!matchedKeys.has(w.identityKey) || w.ambiguous) {
      if (matchedKeys.has(w.identityKey)) {
        if (!w.ambiguous) continue;
      }
      addedRight.push(unmatchedFrom(w));
    }
  }

  // Sort matched: nodeTypeChanged DESC, |costDelta| DESC (null deltas last).
  matched.sort((a, b) => {
    if (a.nodeTypeChanged !== b.nodeTypeChanged) {
      return a.nodeTypeChanged ? -1 : 1;
    }
    const ac = a.costDelta;
    const bc = b.costDelta;
    if (ac === null && bc === null) return 0;
    if (ac === null) return 1;
    if (bc === null) return -1;
    return Math.abs(bc) - Math.abs(ac);
  });

  return {
    matched,
    addedRight,
    removedLeft,
    summary: {
      totalCostLeft: leftRoot ? getNum(leftRoot, "Total Cost") : null,
      totalCostRight: rightRoot ? getNum(rightRoot, "Total Cost") : null,
      totalTimeLeft: leftRoot ? getNum(leftRoot, "Actual Total Time") : null,
      totalTimeRight: rightRoot ? getNum(rightRoot, "Actual Total Time") : null,
      leftNodeCount: leftWalked.length,
      rightNodeCount: rightWalked.length,
    },
  };
}
