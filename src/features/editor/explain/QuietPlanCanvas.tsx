import dagre from "dagre";
import { type JSX, useEffect, useMemo, useRef } from "react";
import { computeInsights } from "./insights";
import {
  type PlanNodeRecord,
  asNumber,
  asString,
  buildNodeLabel,
  buildShortMeta,
  classifySeverity,
  collectChildren,
  isPlanNode,
} from "./planNodeUtils";

interface QuietPlanCanvasProps {
  plan: unknown;
  highlight: string | null;
  onSelect(label: string | null, node: PlanNodeRecord | null, idx: number | null): void;
}

interface LaidNode {
  id: string;
  idx: number;
  label: string;
  shortType: string;
  meta: string | null;
  cost: number;
  rows: number | null;
  exclusiveMs: number | null;
  bufferRead: number | null;
  parallelWorkers: number | null;
  neverExecuted: boolean;
  severity: "ok" | "hot" | "crit";
  node: PlanNodeRecord;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface LaidEdge {
  from: string;
  to: string;
  d: string;
}

const NODE_W = 208;
const NODE_H = 108;

function shortNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

function shortDuration(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  if (ms >= 10) return `${ms.toFixed(0)}ms`;
  return `${ms.toFixed(1)}ms`;
}

/**
 * — quiet redesign DAG canvas. Lays out the plan tree top-down
 * with dagre, renders each node as a quiet card mirroring the mockup. On
 * click, emits both the canonical highlight label AND the underlying plan
 * node ref so the right-side details panel can show pev2-quality data
 * without a second walk.
 *
 * Why a custom canvas, not pev2:
 * pev2 ships a Bootstrap-themed visualizer that duplicates information
 * our left rail + right insights already show, and overlaps cards in a
 * constrained centre column. Building this directly on top of the same
 * plan JSON keeps a single coherent UI; pev2 stays available behind an
 * "Open in pev2" escape hatch in ExplainPane for power users.
 */
export function QuietPlanCanvas({
  plan,
  highlight,
  onSelect,
}: QuietPlanCanvasProps): JSX.Element | null {
  const insights = useMemo(() => computeInsights(plan), [plan]);

  const severityByLabel = useMemo(() => {
    const map = new Map<string, "hot" | "crit">();
    for (const ins of insights) {
      const sev: "hot" | "crit" = ins.severity === "high" ? "crit" : "hot";
      const cur = map.get(ins.nodeLabel);
      if (cur === "crit") continue;
      map.set(ins.nodeLabel, sev);
    }
    return map;
  }, [insights]);

  const layout = useMemo(() => {
    if (!Array.isArray(plan) || plan.length === 0) return null;
    const root = (plan[0] as { Plan?: unknown }).Plan;
    if (!isPlanNode(root)) return null;

    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: "TB", nodesep: 28, ranksep: 36, marginx: 16, marginy: 16 });
    g.setDefaultEdgeLabel(() => ({}));

    const nodes: Array<{ id: string; node: PlanNodeRecord; idx: number }> = [];
    let cursor = 0;
    const walk = (node: PlanNodeRecord, parentId: string | null): void => {
      cursor++;
      const id = String(cursor);
      nodes.push({ id, node, idx: cursor });
      g.setNode(id, { width: NODE_W, height: NODE_H });
      if (parentId) g.setEdge(parentId, id);
      for (const child of collectChildren(node)) walk(child, id);
    };
    walk(root, null);

    dagre.layout(g);

    const placed: LaidNode[] = nodes.map(({ id, node, idx }) => {
      const lay = g.node(id);
      const cost = asNumber(node["Total Cost"]) ?? 0;
      const actualRows = asNumber(node["Actual Rows"]);
      const planRows = asNumber(node["Plan Rows"]);
      const rows = actualRows ?? planRows;
      const totalMs = asNumber(node["Actual Total Time"]);
      const startMs = asNumber(node["Actual Startup Time"]);
      // Exclusive (self) time — total minus sum of children's totals. Best
      // proxy for "this node's own cost". Falls back to total if children's
      // times are missing.
      let childTotal = 0;
      for (const c of collectChildren(node)) {
        const ct = asNumber(c["Actual Total Time"]);
        if (ct !== null) childTotal += ct;
      }
      const exclusiveMs = totalMs !== null ? Math.max(0, totalMs - childTotal) : startMs;
      const buffersHit = asNumber(node["Shared Hit Blocks"]) ?? 0;
      const buffersRead = asNumber(node["Shared Read Blocks"]) ?? 0;
      const parallel = asNumber(node["Workers Launched"]);
      const loops = asNumber(node["Actual Loops"]);
      const neverExecuted = loops === 0;
      const label = buildNodeLabel(node);
      const nodeType = asString(node["Node Type"]) ?? "Unknown";
      const rel = asString(node["Relation Name"]);
      const shortType = rel ? `${nodeType} · ${rel}` : nodeType;
      return {
        id,
        idx,
        label,
        shortType,
        meta: buildShortMeta(node),
        cost,
        rows,
        exclusiveMs,
        bufferRead: buffersHit + buffersRead || null,
        parallelWorkers: parallel,
        neverExecuted,
        severity: severityByLabel.get(label) ?? classifySeverity(node),
        node,
        x: lay.x - lay.width / 2,
        y: lay.y - lay.height / 2,
        width: lay.width,
        height: lay.height,
      };
    });

    const edges: LaidEdge[] = g.edges().map((e) => {
      const points = g.edge(e).points;
      const d = points.map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`)).join(" ");
      return { from: e.v, to: e.w, d };
    });

    const graphSize = g.graph();
    return {
      placed,
      edges,
      width: graphSize.width ?? 800,
      height: graphSize.height ?? 600,
    };
  }, [plan, severityByLabel]);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const activeRef = useRef<HTMLButtonElement | null>(null);

  // When highlight changes, gently scroll the active card into view so a
  // click on a row in PlanNodeList / NodesTable / Insights / DiffPanel
  // ALWAYS gets visible feedback — even if the target was off-screen.
  useEffect(() => {
    if (!highlight) return;
    const el = activeRef.current;
    const scroller = scrollRef.current;
    if (!el || !scroller) return;
    const elRect = el.getBoundingClientRect();
    const sRect = scroller.getBoundingClientRect();
    const above = elRect.top < sRect.top;
    const below = elRect.bottom > sRect.bottom;
    const leftOf = elRect.left < sRect.left;
    const rightOf = elRect.right > sRect.right;
    if (above || below || leftOf || rightOf) {
      el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    }
  }, [highlight]);

  if (!layout || layout.placed.length === 0) {
    return (
      <div
        data-testid="quiet-plan-canvas-empty"
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--ink-4)",
          fontSize: 12,
        }}
      >
        Не удалось разобрать план
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      data-testid="quiet-plan-canvas"
      className="q-plan-canvas q-scroll"
      style={{ flex: 1, minHeight: 0, overflow: "auto" }}
    >
      <div
        style={{
          position: "relative",
          width: layout.width + 32,
          height: layout.height + 32,
          padding: 16,
        }}
      >
        <svg
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 16,
            width: layout.width,
            height: layout.height,
            pointerEvents: "none",
          }}
        >
          <defs>
            <marker
              id="quiet-plan-arrow"
              viewBox="0 0 6 6"
              refX="5"
              refY="3"
              markerWidth="6"
              markerHeight="6"
              orient="auto"
            >
              <path d="M0,0 L6,3 L0,6 z" fill="var(--ink-5)" />
            </marker>
          </defs>
          <g stroke="var(--ink-5)" strokeWidth="1.2" fill="none" markerEnd="url(#quiet-plan-arrow)">
            {layout.edges.map((e) => (
              <path key={`${e.from}-${e.to}`} d={e.d} />
            ))}
          </g>
        </svg>
        {layout.placed.map((n) => {
          const isActive = highlight === n.label;
          const sevClass = n.severity === "crit" ? "crit" : n.severity === "hot" ? "hot" : "";
          return (
            <button
              type="button"
              key={n.id}
              ref={isActive ? activeRef : undefined}
              data-testid={`quiet-plan-card-${n.idx}`}
              data-severity={n.severity}
              className={`pn-card ${sevClass} ${isActive ? "active" : ""} ${
                n.neverExecuted ? "never-exec" : ""
              }`}
              onClick={() =>
                onSelect(
                  isActive ? null : n.label,
                  isActive ? null : n.node,
                  isActive ? null : n.idx,
                )
              }
              style={{
                position: "absolute",
                left: n.x + 16,
                top: n.y + 16,
                width: n.width,
                height: n.height,
              }}
              title={n.label}
            >
              <div className="pn-h">
                <span className="idx">#{n.idx}</span>
                <span className="ttl">{n.shortType}</span>
                {n.parallelWorkers && n.parallelWorkers > 0 ? (
                  <span className="badge" title={`${n.parallelWorkers} parallel workers`}>
                    ‖{n.parallelWorkers}
                  </span>
                ) : null}
                {n.neverExecuted ? (
                  <span className="badge muted" title="Never executed">
                    ∅
                  </span>
                ) : null}
              </div>
              {n.meta ? <div className="pn-meta">{n.meta}</div> : null}
              <div className="pn-stats">
                {n.exclusiveMs != null ? (
                  <span className="stat">
                    <span className="v">{shortDuration(n.exclusiveMs)}</span>
                    <span className="l">time</span>
                  </span>
                ) : null}
                {n.rows != null ? (
                  <span className="stat">
                    <span className="v">{shortNumber(n.rows)}</span>
                    <span className="l">rows</span>
                  </span>
                ) : null}
                <span className="stat">
                  <span className={`v ${n.severity === "crit" ? "crit" : ""}`}>
                    {n.cost.toFixed(0)}
                  </span>
                  <span className="l">cost</span>
                </span>
                {n.bufferRead != null && n.bufferRead > 0 ? (
                  <span className="stat" title="Shared blocks (hit + read)">
                    <span className="v">{shortNumber(n.bufferRead)}</span>
                    <span className="l">buf</span>
                  </span>
                ) : null}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
