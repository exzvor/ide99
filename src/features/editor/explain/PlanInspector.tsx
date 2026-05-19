import * as RadixDialog from "@radix-ui/react-dialog";
import { Copy, X } from "lucide-react";
import { type JSX, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "../../../components/Toast";
import { InsightsPanel } from "./InsightsPanel";
import { computeInsights } from "./insights";
import { NodesTable } from "./inspector/NodesTable";
import { QueryView } from "./inspector/QueryView";
import { RawJsonView } from "./inspector/RawJsonView";

interface PlanInspectorProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  plan: unknown;
  executedSql: string;
  durationMs: number;
  /** ExplainTab id — forwarded to InsightsPanel for openEditorFromInsight. */
  tabId: string;
  /** Highlight wire shared with the host ExplainPane (clicking a row in
   * the table or an insight bubbles back, so the main DAG can react). */
  onHighlight?(label: string | null): void;
  /** Current highlight from the host. Used to drive the "✓ highlighted"
   * state on row buttons in NodesTable so the user gets feedback without
   * the modal having to close. */
  highlight?: string | null;
}

const INSIGHTS_RAIL_WIDTH = 320;

type InspectorTab = "table" | "raw" | "query";

/**
 * — replaces the pev2 escape-hatch with a quiet, in-house
 * inspector. Three tabs cover what pev2 added beyond our DAG:
 * - Table  — flat list of all plan nodes with metrics (the most common
 * "why is this slow?" lookup; what pev2's Grid view did)
 * - Raw    — pretty-printed plan JSON with copy
 * - Query  — the SQL that produced this plan, with copy
 *
 * Insights remain on the left as a side rail so the analyst can flag a
 * row → see the supporting hint without leaving the modal.
 *
 * Built on raw Radix Dialog (not the shared `Dialog` component) because
 * we need a custom 95vw × 92vh shell. The shared one tops out at 600px
 * wide and has centred padding that doesn't fit a tabular inspector.
 */
export function PlanInspector({
  open,
  onOpenChange,
  plan,
  executedSql,
  durationMs,
  tabId,
  onHighlight,
  highlight,
}: PlanInspectorProps): JSX.Element {
  const { t } = useTranslation();
  const [tab, setTab] = useState<InspectorTab>("table");
  const insightCount = useMemo(() => computeInsights(plan).length, [plan]);
  const hasInsights = insightCount > 0;
  const toast = useToast();

  async function copy(text: string, msg: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(msg);
    } catch {
      toast.error(t("editor.explain.inspector.toast.copy_failed"));
    }
  }

  return (    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="q-backdrop" data-testid="plan-inspector-overlay" />
        <RadixDialog.Content
          className="q-modal"
          data-testid="plan-inspector"
          style={{
            padding: 0,
            width: "min(1600px, 95vw)",
            height: "min(940px, 92vh)",
            maxWidth: "calc(100vw - 32px)",
            maxHeight: "calc(100vh - 32px)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          {/* ── Header ──────────────────────────────────────── */}
          <div
            style={{
              padding: "20px 24px 16px",
              borderBottom: "1px solid var(--hairline)",
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 16,
              flex: "0 0 auto",
              background: "var(--bg-elev)",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
              <RadixDialog.Title
                style={{
                  margin: 0,
                  fontSize: 16,
                  fontWeight: 600,
                  color: "var(--ink)",
                  letterSpacing: "-0.01em",
                }}
              >
                {t("editor.explain.inspector.title")}
              </RadixDialog.Title>
              <RadixDialog.Description
                style={{
                  margin: 0,
                  fontSize: 12.5,
                  color: "var(--ink-3)",
                }}
              >
                {t("editor.explain.inspector.description", {
                  insightsExtra: hasInsights
                    ? t("editor.explain.inspector.description_insights_extra", {
                        count: insightCount,
                      })
                    : "",
                })}
              </RadixDialog.Description>
            </div>
            <RadixDialog.Close
              aria-label={t("editor.explain.inspector.close")}
              className="btn-icon"
              data-testid="plan-inspector-close"
              style={{ width: 32, height: 32, flex: "0 0 auto" }}
            >
              <X size={16} aria-hidden="true" />
            </RadixDialog.Close>
          </div>

          {/* ── Body: insights rail + tabbed content ────────── */}
          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: "flex",
              flexDirection: "row",
              background: "var(--bg)",
            }}
          >
            {hasInsights ? (              <div
                style={{
                  width: INSIGHTS_RAIL_WIDTH,
                  flex: "0 0 auto",
                  minHeight: 0,
                  display: "flex",
                  flexDirection: "column",
                  background: "var(--bg-elev)",
                  borderRight: "1px solid var(--hairline)",
                }}
                data-testid="plan-inspector-insights"
              >
                <InsightsPanel
                  tabId={tabId}
                  plan={plan}
                  onHighlight={(label) => onHighlight?.(label)}
                />
              </div>
) : null}
            <div
              style={{
                flex: 1,
                minWidth: 0,
                minHeight: 0,
                display: "flex",
                flexDirection: "column",
              }}
            >
              {/* Tab bar */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "8px 16px",
                  borderBottom: "1px solid var(--hairline)",
                  background: "var(--bg-sunken)",
                  flex: "0 0 auto",
                }}
                role="tablist"
              >
                <TabBtn
                  label={t("editor.explain.inspector.tab.table")}
                  active={tab === "table"}
                  onClick={() => setTab("table")}
                  testId="inspector-tab-table"
                />
                <TabBtn
                  label={t("editor.explain.inspector.tab.raw")}
                  active={tab === "raw"}
                  onClick={() => setTab("raw")}
                  testId="inspector-tab-raw"
                />
                <TabBtn
                  label={t("editor.explain.inspector.tab.query")}
                  active={tab === "query"}
                  onClick={() => setTab("query")}
                  testId="inspector-tab-query"
                />
                <div style={{ flex: 1 }} />
                <span style={{ fontSize: 11, color: "var(--ink-4)" }}>
                  {t("editor.explain.inspector.duration_label", { ms: durationMs })}
                </span>
                {tab === "raw" ? (                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() =>
                      void copy(                        JSON.stringify(plan, null, 2),
                        t("editor.explain.inspector.toast.json_copied"),
)
                    }
                    data-testid="inspector-copy-json"
                  >
                    <Copy size={12} aria-hidden="true" /> {t("editor.explain.inspector.copy_json")}
                  </button>
) : null}
                {tab === "query" ? (                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() =>
                      void copy(executedSql, t("editor.explain.inspector.toast.sql_copied"))
                    }
                    data-testid="inspector-copy-sql"
                  >
                    <Copy size={12} aria-hidden="true" /> {t("editor.explain.inspector.copy_sql")}
                  </button>
) : null}
              </div>

              {/* Tab body */}
              <div style={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex" }}>
                {tab === "table" ? (                  <NodesTable
                    plan={plan}
                    onSelectLabel={onHighlight}
                    highlight={highlight ?? null}
                  />
) : null}
                {tab === "raw" ? <RawJsonView plan={plan} /> : null}
                {tab === "query" ? <QueryView sql={executedSql} /> : null}
              </div>
            </div>
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
);
}

interface TabBtnProps {
  label: string;
  active: boolean;
  onClick(): void;
  testId: string;
}

function TabBtn({ label, active, onClick, testId }: TabBtnProps): JSX.Element {
  return (    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-pressed={active}
      onClick={onClick}
      data-testid={testId}
      className="btn btn-sm"
      style={{
        background: active ? "var(--bg-elev)" : "transparent",
        boxShadow: active ? "var(--shadow-q-sm)" : "none",
        borderColor: active ? "var(--border-strong-q)" : "transparent",
        color: active ? "var(--ink)" : "var(--ink-3)",
      }}
    >
      {label}
    </button>
);
}
