import { type JSX, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { type Insight, type InsightSeverity, computeInsights } from "../editor/explain/insights";
import { diffPlans } from "../editor/explain/planDiff";
import {
  asNumber,
  blocksToBytes,
  collectChildren,
  isPlanNode,
  prettyBytes,
} from "../editor/explain/planNodeUtils";
import { useEditor } from "../editor/store";
import { useRecentPlans } from "./store";

const SLOW_THRESHOLD_MS = 1000;

const SEVERITY_TONE: Record<InsightSeverity, "crit" | "warn" | "info"> = {
  high: "crit",
  med: "warn",
  low: "info",
};

function countNodes(plan: unknown): number {
  if (!Array.isArray(plan) || plan.length === 0) return 0;
  const root = (plan[0] as { Plan?: unknown })?.Plan;
  if (!root || typeof root !== "object") return 0;
  let count = 0;
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    count++;
    const children = (node as { Plans?: unknown[] }).Plans;
    if (Array.isArray(children)) {
      for (const c of children) walk(c);
    }
  };
  walk(root);
  return count;
}

function planningMs(plan: unknown): number | null {
  if (!Array.isArray(plan) || plan.length === 0) return null;
  const v = (plan[0] as { "Planning Time"?: unknown })?.["Planning Time"];
  return typeof v === "number" ? v : null;
}

function shortNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

/**
 * Walk the plan with the same 1-based DFS the rest of the EXPLAIN UI uses
 * (matches PlanNodeList / NodesTable / QuietPlanCanvas / InsightsPanel).
 * Returns Map<insight.nodePath.join(".") → idx>.
 */
function buildInsightIdxMap(plan: unknown): Map<string, number> {
  const map = new Map<string, number>();
  if (!Array.isArray(plan) || plan.length === 0) return map;
  const root = (plan[0] as { Plan?: unknown }).Plan;
  if (!isPlanNode(root)) return map;
  let cursor = 0;
  const walk = (node: Record<string, unknown>, path: number[]): void => {
    cursor++;
    map.set(path.join("."), cursor);
    const children = collectChildren(node);
    for (let i = 0; i < children.length; i++) {
      walk(children[i], [...path, i]);
    }
  };
  walk(root, [0]);
  return map;
}

function nodeAtInsightPath(plan: unknown, path: number[]): Record<string, unknown> | null {
  if (!Array.isArray(plan) || plan.length === 0) return null;
  const root = (plan[0] as { Plan?: unknown }).Plan;
  if (!isPlanNode(root)) return null;
  let cur: Record<string, unknown> = root;
  for (let i = 1; i < path.length; i++) {
    const idx = path[i];
    const children = collectChildren(cur);
    if (idx < 0 || idx >= children.length) return null;
    cur = children[idx];
  }
  return cur;
}

/**
 * Compact one-liner for the Top hotspots panel — mirrors what InsightsPanel
 * shows under the description ("cost 328.00 · 1.25M rows · 1.5 GB").
 */
function buildHotspotMeta(insight: Insight, plan: unknown): string | null {
  const node = nodeAtInsightPath(plan, insight.nodePath);
  if (!node) return null;
  const cost = asNumber(node["Total Cost"]);
  const rows = asNumber(node["Actual Rows"]) ?? asNumber(node["Plan Rows"]);
  const buffersHit = asNumber(node["Shared Hit Blocks"]) ?? 0;
  const buffersRead = asNumber(node["Shared Read Blocks"]) ?? 0;
  const buffersTotal = buffersHit + buffersRead;

  switch (insight.ruleId) {
    case "R1_seq_scan_large": {
      const parts: string[] = [];
      if (cost != null) parts.push(`cost ${cost.toFixed(2)}`);
      if (rows != null) parts.push(`${shortNumber(rows)} rows`);
      if (buffersTotal > 0) parts.push(prettyBytes(blocksToBytes(buffersTotal)));
      return parts.length > 0 ? parts.join(" · ") : null;
    }
    case "R2_hash_join_disk":
      return insight.bodyParams.disk ? `spill ${insight.bodyParams.disk}` : null;
    case "R3_nested_loop_hot": {
      const loops = insight.bodyParams.loops;
      const parts: string[] = [];
      if (loops) parts.push(`loops ${loops}`);
      if (cost != null) parts.push(`cost ${cost.toFixed(2)}`);
      return parts.length > 0 ? parts.join(" · ") : null;
    }
    case "R4_stale_stats":
      return `est ${insight.bodyParams.estRows} vs actual ${insight.bodyParams.actualRows} · ${insight.bodyParams.ratio}× off`;
    default:
      return null;
  }
}

function fmtSignedNum(n: number, suffix = ""): string {
  if (n === 0) return `0${suffix}`;
  return `${n > 0 ? "+" : ""}${n}${suffix}`;
}

function deltaToneColor(delta: number): string {
  if (delta > 0) return "var(--danger-q)";
  if (delta < 0) return "var(--accent-strong)";
  return "var(--ink)";
}

interface PreviousRunDeltas {
  costDelta: number | null;
  timeDelta: number;
  addedNodes: number;
  removedNodes: number;
  modifiedNodes: number;
}

function computeDeltas(  current: { plan: unknown; durationMs: number; totalCost: number | null },
  previous: { plan: unknown; durationMs: number; totalCost: number | null },
): PreviousRunDeltas {
  let added = 0;
  let removed = 0;
  let modified = 0;
  try {
    const diff = diffPlans(previous.plan, current.plan);
    added = diff.addedRight.length;
    removed = diff.removedLeft.length;
    modified = diff.matched.filter(      (m) =>
        m.nodeTypeChanged ||
        (m.costDelta !== null && m.costDelta !== 0) ||
        (m.rowsDelta !== null && m.rowsDelta !== 0),
).length;
  } catch {
    // diff engine is defensive; fall back to zero deltas
  }
  const costDelta =
    current.totalCost != null && previous.totalCost != null
      ? current.totalCost - previous.totalCost
      : null;
  return {
    costDelta,
    timeDelta: current.durationMs - previous.durationMs,
    addedNodes: added,
    removedNodes: removed,
    modifiedNodes: modified,
  };
}

/**
 * Right-pane analytics preview:
 * header (timestamp + slow pill + actions) → 4 KPI cards → Top 3 hotspots
 * (rule-based, friendly #idx) → previous-run comparison block with
 * Δcost / Δtime / structural Δnodes pills computed via planDiff. The full
 * plan visualization is reachable via the "Open plan" action — the preview
 * itself is analytics-only.
 */
export function RecentPlansPreview(): JSX.Element {
  const { t } = useTranslation();
  const selectedId = useRecentPlans((s) => s.selectedId);
  const rows = useRecentPlans((s) => s.rows);
  const row = useRecentPlans((s) =>
    s.selectedId === null ? null : (s.rows.find((r) => r.id === s.selectedId) ?? null),
);
  // Highlight is local to this preview — clicking a hotspot doesn't escape
  // outside the recent-plans tab. Reserved for future inline preview.
  const [, setHighlight] = useState<string | null>(null);

  const parsedPlan = useMemo<unknown>(() => {
    if (!row) return null;
    try {
      return JSON.parse(row.planJson);
    } catch {
      return null;
    }
  }, [row]);

  const insights = useMemo<Insight[]>(    () => (parsedPlan ? computeInsights(parsedPlan) : []),
    [parsedPlan],
);

  const idxByPath = useMemo(() => buildInsightIdxMap(parsedPlan), [parsedPlan]);

  // Find the next-newer run for the same SQL — the "previous run" we
  // compare against. The full diff is computed only when we actually
  // need to render the comparison panel.
  const previousRun = useMemo(() => {
    if (!row) return null;
    const candidates = rows.filter((r) => r.id !== row.id && r.sql === row.sql);
    if (candidates.length === 0) return null;
    const sorted = [...candidates].sort(      (a, b) => new Date(b.executedAt).getTime() - new Date(a.executedAt).getTime(),
);
    return sorted[0];
  }, [row, rows]);

  const prevParsedPlan = useMemo<unknown>(() => {
    if (!previousRun) return null;
    try {
      return JSON.parse(previousRun.planJson);
    } catch {
      return null;
    }
  }, [previousRun]);

  const deltas = useMemo<PreviousRunDeltas | null>(() => {
    if (!row || !previousRun || !parsedPlan || !prevParsedPlan) return null;
    return computeDeltas(      { plan: parsedPlan, durationMs: row.durationMs, totalCost: row.totalCost ?? null },
      {
        plan: prevParsedPlan,
        durationMs: previousRun.durationMs,
        totalCost: previousRun.totalCost ?? null,
      },
);
  }, [row, previousRun, parsedPlan, prevParsedPlan]);

  if (!row || !selectedId) {
    return (      <div data-testid="recent-plans-preview-placeholder" style={{ padding: 20, opacity: 0.6 }}>
        {t("recent_plans.preview.placeholder")}
      </div>
);
  }

  const nodes = countNodes(parsedPlan);
  const planMs = planningMs(parsedPlan);
  const slow = row.durationMs >= SLOW_THRESHOLD_MS;
  const top3 = insights.slice(0, 3);

  return (    <div
      data-testid="recent-plans-preview"
      style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}
    >
      <div
        className="q-scroll"
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          padding: 20,
          background: "var(--bg)",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <div style={{ fontSize: 14.5, fontWeight: 600, color: "var(--ink)" }}>
            {new Date(row.executedAt).toLocaleString()} ·{" "}
            {row.mode === "analyze" ? "ANALYZE" : "EXPLAIN"}
          </div>
          {slow ? <span className="q-pill warn">{t("recent_plans.preview.slow")}</span> : null}
          <div style={{ flex: 1 }} />
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => void useEditor.getState().openEditorFromRecent(row.id)}
            data-testid="recent-plans-preview-open-sql"
          >
            {t("recent_plans.preview.open_sql")}
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => useEditor.getState().openCachedExplain(row)}
            data-testid="recent-plans-preview-open"
          >
            {t("recent_plans.preview.open")}
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
          <div className="q-stat-card">
            <span className="lbl">{t("recent_plans.preview.kpi.execution")}</span>
            <span className={`val ${slow ? "warn" : ""}`}>{row.durationMs} ms</span>
          </div>
          <div className="q-stat-card">
            <span className="lbl">{t("recent_plans.preview.kpi.planning")}</span>
            <span className="val">{planMs !== null ? `${planMs.toFixed(1)} ms` : "—"}</span>
          </div>
          <div className="q-stat-card">
            <span className="lbl">{t("recent_plans.preview.kpi.total_cost")}</span>
            <span className="val">{row.totalCost?.toFixed(2) ?? "—"}</span>
          </div>
          <div className="q-stat-card">
            <span className="lbl">{t("recent_plans.preview.kpi.nodes")}</span>
            <span className="val">{nodes || "—"}</span>
          </div>
        </div>

        {top3.length > 0 ? (          <div className="q-section-card" data-testid="recent-plans-hotspots">
            <div className="hd">{t("recent_plans.preview.hotspots.title")}</div>
            <div>
              {top3.map((ins, i) => {
                const tone = SEVERITY_TONE[ins.severity];
                const idx = idxByPath.get(ins.nodePath.join("."));
                const meta = buildHotspotMeta(ins, parsedPlan);
                return (                  <button
                    type="button"
                    key={`${ins.ruleId}-${ins.nodePath.join(".")}`}
                    className={`q-insight ${tone}`}
                    onClick={() => setHighlight(ins.nodeLabel)}
                    style={
                      i === top3.length - 1
                        ? { borderBottom: "none", cursor: "default" }
                        : { cursor: "default" }
                    }
                  >
                    <span className="marker" aria-hidden="true" />
                    <div className="body">
                      <span className="ttl">
                        {t(ins.titleKey)}
                        {idx !== undefined ? (                          <span className={`q-pill ${tone}`}>#{idx}</span>
) : null}
                      </span>
                      {meta ? <span className="meta">{meta}</span> : null}
                    </div>
                  </button>
);
              })}
            </div>
          </div>
) : null}

        {previousRun && deltas ? (          <div className="q-section-card" data-testid="recent-plans-comparison">
            <div className="hd">{t("recent_plans.preview.compare.title")}</div>
            <div
              style={{
                padding: "14px 16px",
                display: "grid",
                gridTemplateColumns: "100px 1fr",
                gap: "10px 16px",
                fontSize: 12,
                alignItems: "baseline",
              }}
            >
              <span style={{ color: "var(--ink-4)" }}>
                {t("recent_plans.preview.compare.cost_label")}
              </span>
              <span className="mono" style={{ fontVariantNumeric: "tabular-nums" }}>
                {deltas.costDelta != null &&
                row.totalCost != null &&
                previousRun.totalCost != null ? (                  <>
                    <b style={{ color: deltaToneColor(deltas.costDelta) }}>
                      {fmtSignedNum(Math.round(deltas.costDelta * 100) / 100)}
                    </b>{" "}
                    <span style={{ color: "var(--ink-5)" }}>
                      ({previousRun.totalCost.toFixed(2)} → {row.totalCost.toFixed(2)})
                    </span>
                  </>
) : (                  "—"
)}
              </span>
              <span style={{ color: "var(--ink-4)" }}>
                {t("recent_plans.preview.compare.time_label")}
              </span>
              <span className="mono" style={{ fontVariantNumeric: "tabular-nums" }}>
                <b style={{ color: deltaToneColor(deltas.timeDelta) }}>
                  {fmtSignedNum(deltas.timeDelta, " ms")}
                </b>{" "}
                <span style={{ color: "var(--ink-5)" }}>
                  ({previousRun.durationMs} → {row.durationMs})
                </span>
              </span>
              <span style={{ color: "var(--ink-4)" }}>
                {t("recent_plans.preview.compare.changes_label")}
              </span>
              <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {deltas.addedNodes > 0 ? (                  <span className="q-pill ok">
                    {t("recent_plans.preview.compare.added_count", { count: deltas.addedNodes })}
                  </span>
) : null}
                {deltas.removedNodes > 0 ? (                  <span className="q-pill crit">
                    {t("recent_plans.preview.compare.removed_count", {
                      count: deltas.removedNodes,
                    })}
                  </span>
) : null}
                {deltas.modifiedNodes > 0 ? (                  <span className="q-pill warn">
                    {t("recent_plans.preview.compare.modified_count", {
                      count: deltas.modifiedNodes,
                    })}
                  </span>
) : null}
                {deltas.addedNodes === 0 &&
                deltas.removedNodes === 0 &&
                deltas.modifiedNodes === 0 ? (                  <span style={{ fontSize: 11.5, color: "var(--ink-4)" }}>
                    {t("recent_plans.preview.compare.identical")}
                  </span>
) : null}
              </span>
            </div>
          </div>
) : null}
      </div>
    </div>
);
}
