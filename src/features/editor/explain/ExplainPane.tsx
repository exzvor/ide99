import {
  type JSX,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { type ExplainTab, useEditor } from "../store";
import { ExplainEmpty } from "./ExplainEmpty";
import { ExplainErrorView } from "./ExplainErrorView";
import { ExplainToolbar } from "./ExplainToolbar";
import { InsightsPanel } from "./InsightsPanel";
import { NodeDetailsPanel } from "./NodeDetailsPanel";
import { PlanInspector } from "./PlanInspector";
import { PlanNodeList } from "./PlanNodeList";
import { QuietPlanCanvas } from "./QuietPlanCanvas";
import { computeInsights } from "./insights";
import type { PlanNodeRecord } from "./planNodeUtils";

interface ExplainPaneProps {
  tabId: string;
}

const LS_WIDTH_KEY = "ide99:explain.insights.width";
const LS_COLLAPSED_KEY = "ide99:explain.insights.collapsed";
const LS_NODES_COLLAPSED_KEY = "ide99:explain.nodes.collapsed";
// Fallback when we have no container width yet (SSR / 1st paint). Real default
// is computed from container width × 0.3 in `useLayoutEffect` below.
const DEFAULT_WIDTH = 360;
const MIN_WIDTH = 280;
const DEFAULT_RATIO = 0.3;
const NODES_RAIL_WIDTH = 280;

function readStoredWidth(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LS_WIDTH_KEY);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n >= MIN_WIDTH ? n : null;
  } catch {
    return null;
  }
}

function readStoredCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(LS_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

function readStoredNodesCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(LS_NODES_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

type RightTab = "insights" | "details";

interface SelectedNode {
  label: string;
  node: PlanNodeRecord;
  idx: number;
}

/**
 * — host component for the EXPLAIN visualizer tab.
 * — adds an InsightsPanel side-split (70/30 default) with a
 * draggable separator and a collapse button. Width + collapsed state
 * persist to localStorage.
 * — replaces the inline pev2 view with QuietPlanCanvas (rich
 * node cards rendered from pev2's plan JSON) and turns the right rail
 * into a tabbed [Insights | Node #X] panel — selecting a node in the
 * canvas or list pops its details inline. pev2 stays available behind
 * the "Open in pev2" button as a full-screen modal escape hatch.
 */
export function ExplainPane({ tabId }: ExplainPaneProps): JSX.Element {
  const { t } = useTranslation();
  const tab = useEditor((s) => s.tabs.find((x): x is ExplainTab => x.id === tabId));
  const runState = useEditor((s) => s.explainRunStates.get(tabId)) ?? ({ status: "idle" } as const);

  const [highlight, setHighlight] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<SelectedNode | null>(null);
  const [rightTab, setRightTab] = useState<RightTab>("insights");
  const [inspectorOpen, setInspectorOpen] = useState(false);
  // null sentinel = "use container-derived 30% on next layout". Once the user
  // drags or we restore from LS, this becomes a concrete pixel width.
  const [insightsWidth, setInsightsWidth] = useState<number | null>(() => readStoredWidth());
  const [collapsed, setCollapsed] = useState<boolean>(() => readStoredCollapsed());
  const [nodesCollapsed, setNodesCollapsed] = useState<boolean>(() => readStoredNodesCollapsed());

  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{ startX: number; startWidth: number } | null>(null);

  // fix — compute insights at the parent level so the panel host
  // can be hidden entirely when the plan is clean.
  const plan = runState.status === "ready" ? runState.plan : null;
  const insightCount = useMemo(() => (plan === null ? 0 : computeInsights(plan).length), [plan]);
  const hasInsights = insightCount > 0;
  // Right rail is shown if we have either insights OR a selected node.
  const hasRightRail = hasInsights || selectedNode !== null;

  const handleSelect = useCallback(    (label: string | null, node: PlanNodeRecord | null, idx: number | null) => {
      setHighlight(label);
      if (label && node && idx !== null) {
        setSelectedNode({ label, node, idx });
        setRightTab("details");
        // Make sure the right rail is visible when a node is picked.
        setCollapsed(false);
      } else {
        setSelectedNode(null);
        setRightTab("insights");
      }
    },
    [],
);

  // Drop selection when the plan changes (re-run produces fresh node refs).
  useEffect(() => {
    setSelectedNode(null);
    setHighlight(null);
    setRightTab("insights");
  }, []);

  // fix — initialize from container width × 0.3 if there's no
  // stored value yet. useLayoutEffect runs before paint so the host renders
  // at the right size on first frame, no flash. Persisted user widths win on
  // later mounts via the readStoredWidth() initializer.
  useLayoutEffect(() => {
    if (insightsWidth !== null) return;
    if (typeof window === "undefined") return;
    const total = containerRef.current?.clientWidth;
    if (!total) {
      setInsightsWidth(DEFAULT_WIDTH);
      return;
    }
    const maxWidth = Math.floor(total / 2);
    const target = Math.round(total * DEFAULT_RATIO);
    setInsightsWidth(Math.min(maxWidth, Math.max(MIN_WIDTH, target)));
  }, [insightsWidth]);

  // Persist width whenever it changes via drag.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (insightsWidth === null) return;
    try {
      window.localStorage.setItem(LS_WIDTH_KEY, String(insightsWidth));
    } catch {
      // best-effort
    }
  }, [insightsWidth]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(LS_COLLAPSED_KEY, collapsed ? "true" : "false");
    } catch {
      // best-effort
    }
  }, [collapsed]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(LS_NODES_COLLAPSED_KEY, nodesCollapsed ? "true" : "false");
    } catch {
      // best-effort
    }
  }, [nodesCollapsed]);

  const onDragStart = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    dragStateRef.current = { startX: e.clientX, startWidth: 0 };
    // We use a closure that reads the current width from state so the
    // delta is computed against the value at drag-start time.
    const startWidth = (e.currentTarget.parentElement as HTMLDivElement | null)?.querySelector(      "[data-testid='insights-panel-host']",
)?.clientWidth;
    if (typeof startWidth === "number") dragStateRef.current.startWidth = startWidth;

    function onMove(ev: MouseEvent) {
      if (!dragStateRef.current || !containerRef.current) return;
      const dx = dragStateRef.current.startX - ev.clientX;
      const total = containerRef.current.clientWidth;
      const maxWidth = Math.floor(total / 2);
      const next = Math.min(maxWidth, Math.max(MIN_WIDTH, dragStateRef.current.startWidth + dx));
      setInsightsWidth(next);
    }
    function onUp() {
      dragStateRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  if (!tab) {
    // Tab can vanish during a switch — render nothing rather than crash.
    return <div data-testid="explain-pane-missing" />;
  }

  const isReady = runState.status === "ready";

  return (    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
        height: "100%",
      }}
      data-testid={`explain-pane-${tabId}`}
    >
      <ExplainToolbar tab={tab} isRunning={runState.status === "running"} />
      <div
        ref={containerRef}
        style={{
          flex: 1,
          minHeight: 0,
          position: "relative",
          overflow: "hidden",
          display: "flex",
          flexDirection: isReady ? "row" : "column",
        }}
      >
        {runState.status === "idle" ? <ExplainEmpty /> : null}
        {runState.status === "running" ? (          <div data-testid="explain-spinner" style={{ padding: 16, opacity: 0.7 }}>
            {t("editor.explain.spinner")}
          </div>
) : null}
        {runState.status === "error" ? (          <ExplainErrorView state={runState} sourceTabId={tab.sourceTabId} />
) : null}
        {isReady ? (          <>
            {!nodesCollapsed ? (              <div
                data-testid="explain-nodes-rail"
                style={{
                  width: NODES_RAIL_WIDTH,
                  flex: "0 0 auto",
                  minHeight: 0,
                  display: "flex",
                  flexDirection: "column",
                  borderRight: "1px solid var(--hairline)",
                  background: "var(--bg-elev)",
                  position: "relative",
                }}
              >
                <button
                  type="button"
                  onClick={() => setNodesCollapsed(true)}
                  title={t("editor.explain.insights.collapse")}
                  aria-label={t("editor.explain.insights.collapse")}
                  data-testid="explain-nodes-collapse"
                  style={{
                    position: "absolute",
                    top: 6,
                    right: 6,
                    background: "transparent",
                    border: 0,
                    cursor: "pointer",
                    fontSize: 12,
                    opacity: 0.6,
                    zIndex: 1,
                    color: "var(--ink-3)",
                  }}
                >
                  ‹
                </button>
                <PlanNodeList plan={runState.plan} highlight={highlight} onSelect={handleSelect} />
              </div>
) : (              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setNodesCollapsed(false)}
                title={t("editor.explain.insights.expand")}
                aria-label={t("editor.explain.insights.expand")}
                data-testid="explain-nodes-expand"
                style={{
                  width: 18,
                  flex: "0 0 auto",
                  borderRight: "1px solid var(--hairline)",
                  fontSize: 11,
                }}
              >
                ›
              </button>
)}
            <div
              style={{
                flex: 1,
                minWidth: 0,
                minHeight: 0,
                display: "flex",
                flexDirection: "column",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "flex-end",
                  gap: 8,
                  padding: "6px 12px",
                  borderBottom: "1px solid var(--hairline)",
                  background: "var(--bg)",
                }}
              >
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setInspectorOpen(true)}
                  data-testid="explain-open-inspector"
                  title={t("editor.explain.inspector.open_button_title")}
                >
                  ⤢ {t("editor.explain.inspector.open_button")}
                </button>
              </div>
              <QuietPlanCanvas plan={runState.plan} highlight={highlight} onSelect={handleSelect} />
            </div>
            {hasRightRail && !collapsed ? (              <>
                <div
                  role="separator"
                  aria-orientation="vertical"
                  tabIndex={-1}
                  data-testid="insights-drag-handle"
                  onMouseDown={onDragStart}
                  style={{
                    width: 4,
                    cursor: "col-resize",
                    background: "var(--hairline)",
                    flex: "0 0 auto",
                  }}
                />
                <div
                  data-testid="insights-panel-host"
                  style={{
                    width: insightsWidth ?? DEFAULT_WIDTH,
                    minWidth: MIN_WIDTH,
                    flex: "0 0 auto",
                    display: "flex",
                    flexDirection: "column",
                    position: "relative",
                    borderLeft: "1px solid var(--hairline)",
                    background: "var(--bg-elev)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "6px 8px",
                      borderBottom: "1px solid var(--hairline)",
                      background: "var(--bg-sunken)",
                      flex: "0 0 auto",
                    }}
                  >
                    <button
                      type="button"
                      className="btn btn-sm"
                      aria-pressed={rightTab === "insights"}
                      onClick={() => setRightTab("insights")}
                      data-testid="right-tab-insights"
                      style={{
                        background: rightTab === "insights" ? "var(--bg-elev)" : "transparent",
                        boxShadow: rightTab === "insights" ? "var(--shadow-q-sm)" : "none",
                        borderColor:
                          rightTab === "insights" ? "var(--border-strong-q)" : "transparent",
                      }}
                    >
                      Подсказки · {insightCount}
                    </button>
                    {selectedNode ? (                      <button
                        type="button"
                        className="btn btn-sm"
                        aria-pressed={rightTab === "details"}
                        onClick={() => setRightTab("details")}
                        data-testid="right-tab-details"
                        style={{
                          background: rightTab === "details" ? "var(--bg-elev)" : "transparent",
                          boxShadow: rightTab === "details" ? "var(--shadow-q-sm)" : "none",
                          borderColor:
                            rightTab === "details" ? "var(--border-strong-q)" : "transparent",
                        }}
                      >
                        Узел #{selectedNode.idx}
                      </button>
) : null}
                    <div style={{ flex: 1 }} />
                    <button
                      type="button"
                      onClick={() => setCollapsed(true)}
                      title={t("editor.explain.insights.collapse")}
                      aria-label={t("editor.explain.insights.collapse")}
                      data-testid="insights-collapse"
                      className="btn-icon"
                      style={{ width: 22, height: 22, fontSize: 12 }}
                    >
                      ›
                    </button>
                  </div>
                  <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
                    {rightTab === "details" && selectedNode ? (                      <NodeDetailsPanel
                        node={selectedNode.node}
                        idx={selectedNode.idx}
                        onClose={() => {
                          setSelectedNode(null);
                          setHighlight(null);
                          setRightTab("insights");
                        }}
                      />
) : (                      <InsightsPanel
                        tabId={tabId}
                        plan={runState.plan}
                        onHighlight={setHighlight}
                      />
)}
                  </div>
                </div>
              </>
) : hasRightRail && collapsed ? (              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setCollapsed(false)}
                title={t("editor.explain.insights.expand")}
                aria-label={t("editor.explain.insights.expand")}
                data-testid="insights-expand"
                style={{
                  width: 18,
                  flex: "0 0 auto",
                  borderLeft: "1px solid var(--hairline)",
                  fontSize: 11,
                }}
              >
                ‹
              </button>
) : null}
          </>
) : null}
        {runState.status === "cancelled" ? (          <div data-testid="explain-cancelled" style={{ padding: 16, opacity: 0.65 }}>
            {t("editor.explain.empty")}
          </div>
) : null}
      </div>
      {isReady ? (        <>
          <div
            className="q-statusbar"
            data-testid="explain-footer"
            style={{ borderTop: "1px solid var(--hairline)" }}
          >
            {t("editor.explain.footer.summary", {
              duration: runState.durationMs,
              nodes: countNodes(runState.plan),
            })}
          </div>
          <PlanInspector
            open={inspectorOpen}
            onOpenChange={setInspectorOpen}
            plan={runState.plan}
            executedSql={runState.executedSql}
            durationMs={runState.durationMs}
            tabId={tabId}
            onHighlight={setHighlight}
            highlight={highlight}
          />
        </>
) : null}
    </div>
);
}

/**
 * Walk pev2's plan JSON to count nodes. Plan shape (FORMAT JSON):
 * `[{ Plan: { ..., Plans: [{ ..., Plans: [...] }] } }]`
 * Defensive against shapes that diverge — if anything along the way is
 * missing or non-object the walker stops, returning the count it has so
 * far. Returns 0 on a malformed root.
 */
export function countNodes(plan: unknown): number {
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
