import { type JSX, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "../../../components/Toast";
import { VibepgActionButton, VibepgResultDialog } from "../../paid-modules";
import { useEditor } from "../store";
import { type Insight, type InsightSeverity, computeInsights } from "./insights";
import { asNumber, collectChildren, isPlanNode } from "./planNodeUtils";

/**
 * Walk the plan with the same 1-based DFS the rest of the EXPLAIN UI uses
 * (PlanNodeList, NodesTable, QuietPlanCanvas) and return a map from the
 * insight nodePath (joined with ".") → friendly idx like "7". Insights'
 * walker starts at `[0]`, so we mirror that here.
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

/**
 * Locate a node by its insight path (paths start at `[0]` for root → child
 * indices into Plans). Returns null if the path is invalid.
 */
function nodeAtInsightPath(plan: unknown, path: number[]): Record<string, unknown> | null {
  if (!Array.isArray(plan) || plan.length === 0) return null;
  const root = (plan[0] as { Plan?: unknown }).Plan;
  if (!isPlanNode(root)) return null;
  let cur: Record<string, unknown> = root;
  // Skip the leading [0] which references root itself.
  for (let i = 1; i < path.length; i++) {
    const idx = path[i];
    const children = collectChildren(cur);
    if (idx < 0 || idx >= children.length) return null;
    cur = children[idx];
  }
  return cur;
}

function shortNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

function blocksToBytes(blocks: number): number {
  return blocks * 8192;
}

function prettyBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Build a one-line "meta" string per rule, matching the mockup's
 * `cost 328.00 · 1.25M rows · 1.5 GB` / `work_mem 4MB · spill 6.0MB`
 * etc. Returns null when the relevant numbers aren't available.
 */
function buildInsightMeta(insight: Insight, plan: unknown): string | null {
  const node = nodeAtInsightPath(plan, insight.nodePath);
  if (!node) return null;
  const cost = asNumber(node["Total Cost"]);
  const actualRows = asNumber(node["Actual Rows"]);
  const planRows = asNumber(node["Plan Rows"]);
  const rows = actualRows ?? planRows;
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
    case "R2_hash_join_disk": {
      const disk = insight.bodyParams.disk;
      return disk ? `spill ${disk}` : null;
    }
    case "R3_nested_loop_hot": {
      const loops = insight.bodyParams.loops;
      const parts: string[] = [];
      if (loops) parts.push(`loops ${loops}`);
      if (cost != null) parts.push(`cost ${cost.toFixed(2)}`);
      return parts.length > 0 ? parts.join(" · ") : null;
    }
    case "R4_stale_stats": {
      const est = insight.bodyParams.estRows;
      const actual = insight.bodyParams.actualRows;
      const ratio = insight.bodyParams.ratio;
      return `est ${est} vs actual ${actual} · ${ratio}× off`;
    }
    default:
      return null;
  }
}

interface InsightsPanelProps {
  tabId: string;
  plan: unknown;
  onHighlight(label: string | null): void;
}

// Map severities onto the design-system tokens defined in `src/styles/design.css`.
// `--info-500` doesn't exist there yet; low currently has no producer (R1/R3 = high,
// R2/R4 = med), so we route it to the neutral accent so future rules render sanely.
const SEVERITY_COLOR: Record<InsightSeverity, string> = {
  high: "var(--danger-q)",
  med: "var(--warning-500)",
  low: "var(--accent)",
};

const SEVERITY_TONE: Record<InsightSeverity, "crit" | "warn" | "info"> = {
  high: "crit",
  med: "warn",
  low: "info",
};

/**
 * — side-panel of rule-based insight cards.
 *
 * Renders nothing when `computeInsights(plan)` returns []. Each card has a
 * severity colour bar (left border), title + body (i18n), a primary
 * `[Open in editor]` button (calls `openEditorFromInsight`) and a secondary
 * `[Copy]` icon button (writes `suggestedSql` to clipboard + toast).
 *
 * Click on the card body (anywhere outside the buttons) calls
 * `onHighlight(insight.nodeLabel)` so the parent can flow the substring into
 * pev2's `planQuery`.
 */
export function InsightsPanel({ tabId, plan, onHighlight }: InsightsPanelProps): JSX.Element {
  const { t } = useTranslation();
  const insights = useMemo(() => computeInsights(plan), [plan]);
  const toast = useToast();
  // — vibepg optimize slot. Opens result dialog when subscribed.
  const [vibepgOpen, setVibepgOpen] = useState(false);

  if (insights.length === 0) {
    return (      <aside
        className="insights-panel"
        data-testid="insights-panel"
        style={{
          display: "flex",
          flexDirection: "column",
          height: "100%",
          minHeight: 0,
          background: "var(--bg-elev)",
        }}
      >
        <header className="q-insight-header">
          <span className="ttl">{t("editor.explain.insights.title", { count: 0 })}</span>
          <span className="q-pill ok">all clear</span>
        </header>
        <div
          data-testid="insights-empty"
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            padding: 24,
            color: "var(--ink-4)",
            fontSize: 12,
            textAlign: "center",
          }}
        >
          <span style={{ fontSize: 18, color: "var(--accent)" }}>✓</span>
          <span>
            {t("editor.explain.insights.empty", {
              defaultValue: "В плане не найдено известных проблем",
            })}
          </span>
          <div
            data-testid="explain-vibepg-slot-empty"
            style={{ marginTop: 12, display: "inline-flex" }}
          >
            <VibepgActionButton slot="explain_optimize" onAction={() => setVibepgOpen(true)} />
          </div>
        </div>
        <VibepgResultDialog open={vibepgOpen} onOpenChange={setVibepgOpen} />
      </aside>
);
  }

  const counts = insights.reduce(    (acc, ins) => {
      acc[ins.severity]++;
      return acc;
    },
    { high: 0, med: 0, low: 0 } as Record<InsightSeverity, number>,
);

  const idxByPath = buildInsightIdxMap(plan);

  return (    <aside
      className="insights-panel"
      data-testid="insights-panel"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        background: "var(--bg-elev)",
      }}
    >
      <header className="q-insight-header">
        <span className="ttl">
          {t("editor.explain.insights.title", { count: insights.length })}
        </span>
        {counts.high > 0 ? <span className="q-pill crit">{counts.high} critical</span> : null}
        {counts.med > 0 ? <span className="q-pill warn">{counts.med} warning</span> : null}
        {counts.low > 0 ? <span className="q-pill info">{counts.low} info</span> : null}
        {/* — vibepg optimize slot, sits next to severity pills. */}
        <span style={{ marginLeft: "auto" }} data-testid="explain-vibepg-slot">
          <VibepgActionButton slot="explain_optimize" onAction={() => setVibepgOpen(true)} />
        </span>
      </header>
      <ul
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "flex",
          flexDirection: "column",
          overflowY: "auto",
          flex: 1,
          minHeight: 0,
        }}
      >
        {insights.map((insight) => {
          const idx = idxByPath.get(insight.nodePath.join("."));
          const meta = buildInsightMeta(insight, plan);
          return (            <InsightCard
              key={`${insight.ruleId}-${insight.nodePath.join(".")}`}
              insight={insight}
              idx={idx}
              meta={meta}
              onClickBody={() => onHighlight(insight.nodeLabel)}
              onOpenEditor={() => {
                void useEditor.getState().openEditorFromInsight(tabId, insight);
              }}
              onCopy={async () => {
                try {
                  await navigator.clipboard.writeText(insight.suggestedSql);
                  toast.success(t("editor.explain.insights.copied_toast"));
                } catch {
                  // Ignore — clipboard may be unavailable in some environments.
                }
              }}
            />
);
        })}
      </ul>
      <VibepgResultDialog open={vibepgOpen} onOpenChange={setVibepgOpen} />
    </aside>
);
}

interface InsightCardProps {
  insight: Insight;
  idx: number | undefined;
  meta: string | null;
  onClickBody(): void;
  onOpenEditor(): void;
  onCopy(): void;
}

function InsightCard({
  insight,
  idx,
  meta,
  onClickBody,
  onOpenEditor,
  onCopy,
}: InsightCardProps): JSX.Element {
  const { t } = useTranslation();
  const tone = SEVERITY_TONE[insight.severity];
  const testid = `insight-card-${insight.ruleId}-${insight.nodePath.join("-")}`;

  return (    <li
      data-testid={testid}
      data-severity={insight.severity}
      className={`q-insight ${tone}`}
      style={{ listStyle: "none", borderLeft: `4px solid ${SEVERITY_COLOR[insight.severity]}` }}
    >
      <span className="marker" aria-hidden="true" />
      <div className="body">
        <button
          type="button"
          onClick={onClickBody}
          style={{
            all: "unset",
            cursor: "pointer",
            display: "block",
            width: "100%",
          }}
        >
          <span className="ttl">
            {t(insight.titleKey)}
            {idx !== undefined ? <span className={`q-pill ${tone}`}>#{idx}</span> : null}
          </span>
          <span className="desc">{t(insight.bodyKey, insight.bodyParams)}</span>
          {meta ? <span className="meta">{meta}</span> : null}
        </button>
        <div className="acts">
          <button
            type="button"
            className="btn btn-sm btn-accent"
            onClick={onOpenEditor}
            data-testid={`insight-open-in-editor-${insight.ruleId}`}
          >
            {t("editor.explain.insights.action.apply_sql", { defaultValue: "Применить SQL" })}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={onCopy}
            data-testid={`insight-copy-${insight.ruleId}`}
          >
            {t("editor.explain.insights.action.copy_sql_btn", {
              defaultValue: "Скопировать",
            })}
          </button>
        </div>
      </div>
    </li>
);
}

// Re-export severity colour map for tests / consumers.
export const __insightSeverityColor = SEVERITY_COLOR;
