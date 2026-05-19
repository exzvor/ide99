import dagre from "dagre";
import type { ErdColumn, ErdSchemaGraph } from "../../lib/tauri";

/** Visual constants shared with `<TableCard />` so the dagre-reported size
 * matches what the SVG actually renders. Keep these together — they form
 * one contract between layout math and node geometry. */
export const NODE_W = 240;
export const HEADER_H = 30;
export const ROW_H = 18;
export const FOOTER_H = 16;
export const MAX_VISIBLE_COLS = 12;

/** — laid-out column carries an optional stable `id` field that
 * `ErdPane` populates from the WorkingErdGraph after layout. The id is
 * required by inline-edit handlers so renaming a newly-added column (whose
 * working id is `_new:<opId>`) routes through the op-log correctly even
 * after the user has changed the displayed name (fix). */
export type LaidErdColumn = ErdColumn & { id?: string };

export interface LaidErdNode {
  /** `${schema}.${name}` — must be unique per graph. */
  id: string;
  schema: string;
  name: string;
  columns: LaidErdColumn[];
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LaidErdEdge {
  /** `${fk.name}:${fromNodeId}->${toNodeId}` — unique. */
  id: string;
  fromNodeId: string;
  toNodeId: string;
  /** SVG path data. */
  d: string;
  fromColumns: string[];
  toColumns: string[];
}

export interface LaidErd {
  nodes: LaidErdNode[];
  edges: LaidErdEdge[];
  width: number;
  height: number;
  layoutMs: number;
}

function nodeId(schema: string, name: string): string {
  return `${schema}.${name}`;
}

/** Height of a card given its column count. We clamp the visible row count
 * to MAX_VISIBLE_COLS and add a footer line when there's overflow so the
 * "+N more" hint has a place to live. */
function cardHeight(columnCount: number): number {
  const visible = Math.min(columnCount, MAX_VISIBLE_COLS);
  const overflow = columnCount > MAX_VISIBLE_COLS ? FOOTER_H : 0;
  return HEADER_H + visible * ROW_H + overflow;
}

/** — optional layout overrides keyed by `${schema}.${name}`.
 * When present for a given node, dagre's coords are replaced with the
 * override after layout runs so the user's persisted drag positions
 * survive across sessions / schema-filter toggles.
 */
export interface LayoutOptions {
  overrides?: Map<string, { x: number; y: number }>;
}

/** Pure dagre-driven layout for the ERD diagram. Mirrors the QuietPlanCanvas
 * pattern (sprint 15): build a `dagre.graphlib.Graph`, set a fixed size for
 * each table card, run `dagre.layout`, then translate dagre's center-anchored
 * coordinates to top-left so consumers can render with a plain
 * `transform="translate(x,y)"`. Edges that reference a missing target table
 * (e.g. when the user filtered the schema) are dropped silently rather than
 * crashing the canvas. */
export function layoutGraph(graph: ErdSchemaGraph, opts?: LayoutOptions): LaidErd {
  const start = performance.now();

  if (graph.tables.length === 0) {
    return {
      nodes: [],
      edges: [],
      width: 0,
      height: 0,
      layoutMs: performance.now() - start,
    };
  }

  // Multigraph so multiple FKs between the same pair of tables (rare but
  // valid in Postgres — composite + simple FKs side-by-side) get their own
  // entries instead of being merged into one.
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({
    rankdir: "LR",
    nodesep: 28,
    ranksep: 80,
    edgesep: 12,
    marginx: 24,
    marginy: 24,
  });
  g.setDefaultEdgeLabel(() => ({}));

  // Track the nodes we're laying out so we can:
  // 1. Quickly check whether a FK's source/target table exists.
  // 2. Read each node's geometry back after `dagre.layout` runs.
  const presentIds = new Set<string>();
  for (const table of graph.tables) {
    const id = nodeId(table.schema, table.name);
    presentIds.add(id);
    g.setNode(id, { width: NODE_W, height: cardHeight(table.columns.length) });
  }

  // Filter FKs whose endpoints aren't both present in this layout. Otherwise
  // dagre would silently create phantom nodes for them, blowing up the
  // viewBox and leaving "ghost" rectangles that never render as cards.
  const liveEdges: Array<{
    fk: ErdSchemaGraph["foreignKeys"][number];
    fromId: string;
    toId: string;
  }> = [];
  for (const fk of graph.foreignKeys) {
    const fromId = nodeId(fk.sourceSchema, fk.sourceTable);
    const toId = nodeId(fk.targetSchema, fk.targetTable);
    if (!presentIds.has(fromId) || !presentIds.has(toId)) continue;
    liveEdges.push({ fk, fromId, toId });
    // Use the FK name as the dagre edge name so multi-FK pairs (rare but
    // valid) don't collapse into a single edge entry.
    g.setEdge(fromId, toId, {}, fk.name);
  }

  dagre.layout(g);

  const overrides = opts?.overrides;
  const nodes: LaidErdNode[] = graph.tables.map((table) => {
    const id = nodeId(table.schema, table.name);
    const lay = g.node(id);
    // dagre returns center-anchored coords; SVG wants top-left.
    let x = lay.x - lay.width / 2;
    let y = lay.y - lay.height / 2;
    const override = overrides?.get(id);
    if (override) {
      x = override.x;
      y = override.y;
    }
    return {
      id,
      schema: table.schema,
      name: table.name,
      columns: table.columns,
      x,
      y,
      width: lay.width,
      height: lay.height,
    };
  });

  const edges: LaidErdEdge[] = liveEdges.map(({ fk, fromId, toId }) => {
    const dagreEdge = g.edge({ v: fromId, w: toId, name: fk.name });
    const points = dagreEdge?.points ?? [];
    const d =
      points.length > 0
        ? points.map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`)).join(" ")
        : "";
    return {
      id: `${fk.name}:${fromId}->${toId}`,
      fromNodeId: fromId,
      toNodeId: toId,
      d,
      fromColumns: fk.sourceColumns,
      toColumns: fk.targetColumns,
    };
  });

  const graphSize = g.graph();
  return {
    nodes,
    edges,
    width: graphSize.width ?? 0,
    height: graphSize.height ?? 0,
    layoutMs: performance.now() - start,
  };
}
