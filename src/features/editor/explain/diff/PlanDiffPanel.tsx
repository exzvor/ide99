import { type JSX, useState } from "react";
import { useTranslation } from "react-i18next";
import type { MatchedNode, PlanDiff, UnmatchedNode } from "../planDiff";
import { asNumber, asString, nodeAtPath } from "../planNodeUtils";

interface PlanDiffPanelProps {
  diff: PlanDiff;
  /** — emits the diff entry that was clicked. The host
   * (`PlanDiffPane`) resolves left/right paths into actual plan node
   * labels and pushes them into both QuietPlanCanvas instances. */
  onPick(
    target:
      | { kind: "matched"; row: MatchedNode }
      | { kind: "added"; row: UnmatchedNode }
      | { kind: "removed"; row: UnmatchedNode },
  ): void;
  /** identityKey of the row that's currently driving the highlight. */
  activeKey: string | null;
  /** — left/right plans for absolute-value lookup per row. */
  leftPlan?: unknown;
  rightPlan?: unknown;
}

interface NodeMetrics {
  cost: number | null;
  time: number | null;
  rows: number | null;
  planRows: number | null;
}

function metricsOf(plan: unknown, path: number[]): NodeMetrics {
  const node = plan ? nodeAtPath(plan, path) : null;
  if (!node) return { cost: null, time: null, rows: null, planRows: null };
  return {
    cost: asNumber(node["Total Cost"]),
    time: asNumber(node["Actual Total Time"]),
    rows: asNumber(node["Actual Rows"]) ?? asNumber(node["Plan Rows"]),
    planRows: asNumber(node["Plan Rows"]),
  };
}

function fmtAbs(n: number | null, suffix = ""): string {
  if (n === null) return "—";
  if (Number.isInteger(n)) return `${n}${suffix}`;
  return `${n.toFixed(2)}${suffix}`;
}

function fmtSignedDelta(n: number | null, suffix = ""): string | null {
  if (n === null) return null;
  if (n === 0) return `0${suffix}`;
  return `${n > 0 ? "+" : ""}${fmtAbs(n)}${suffix}`;
}

type TabKey = "matched" | "added" | "removed";

/**
 * Matched / Added / Removed tabs with click-to-highlight.
 * Passes the row reference up plus delta tones and abs values fallback
 * when delta is 0/null. Proper table layout (node / kind / Δcost /
 * Δtime / Δrows / note) with smart heuristic notes per row.
 */
export function PlanDiffPanel({
  diff,
  onPick,
  activeKey,
  leftPlan,
  rightPlan,
}: PlanDiffPanelProps): JSX.Element {
  const { t } = useTranslation();
  const [active, setActive] = useState<TabKey>("matched");

  const noChanges =
    diff.addedRight.length === 0 &&
    diff.removedLeft.length === 0 &&
    diff.matched.every(
      (m) => (m.costDelta ?? 0) === 0 && (m.timeDelta ?? 0) === 0 && (m.rowsDelta ?? 0) === 0,
    );

  return (
    <div
      data-testid="plan-diff-panel"
      style={{
        borderTop: "1px solid var(--hairline)",
        display: "flex",
        flexDirection: "column",
        minHeight: 280,
        maxHeight: "45%",
      }}
    >
      <div role="tablist" className="q-filter-chips">
        <TabButton
          active={active === "matched"}
          testId="plan-diff-tab-matched"
          onClick={() => setActive("matched")}
          label={t("editor.explain.diff.panel.tab.matched", { count: diff.matched.length })}
        />
        <TabButton
          active={active === "added"}
          testId="plan-diff-tab-added"
          onClick={() => setActive("added")}
          label={t("editor.explain.diff.panel.tab.added", { count: diff.addedRight.length })}
        />
        <TabButton
          active={active === "removed"}
          testId="plan-diff-tab-removed"
          onClick={() => setActive("removed")}
          label={t("editor.explain.diff.panel.tab.removed", { count: diff.removedLeft.length })}
        />
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: "var(--ink-4)" }}>
          {t("editor.explain.diff.panel.row.click_hint")}
        </span>
      </div>
      {active === "matched" && noChanges ? (
        <div
          data-testid="plan-diff-no-changes"
          style={{
            padding: "10px 14px",
            background: "var(--accent-soft)",
            color: "var(--accent-strong)",
            fontSize: 12,
            borderBottom: "1px solid var(--hairline)",
          }}
        >
          {t("editor.explain.diff_panel.no_changes")}
        </div>
      ) : null}
      <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
        <table className="q-tbl q-diff-tbl" style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ minWidth: 280 }}>{t("editor.explain.diff_panel.col.node")}</th>
              <th style={{ width: 110 }}>{t("editor.explain.diff_panel.col.type")}</th>
              <th style={{ width: 130, textAlign: "right" }}>Δcost</th>
              <th style={{ width: 130, textAlign: "right" }}>Δtime</th>
              <th style={{ width: 110, textAlign: "right" }}>Δrows</th>
              <th>{t("editor.explain.diff_panel.col.note")}</th>
            </tr>
          </thead>
          <tbody>
            {active === "matched" &&
              diff.matched.map((m, i) => {
                const left = metricsOf(leftPlan, m.leftPath);
                const right = metricsOf(rightPlan, m.rightPath);
                return (
                  <MatchedRow
                    key={`${m.identityKey}-${i}`}
                    index={i}
                    row={m}
                    left={left}
                    right={right}
                    isActive={activeKey === m.identityKey}
                    onClick={() => onPick({ kind: "matched", row: m })}
                  />
                );
              })}
            {active === "added" &&
              diff.addedRight.map((u, i) => {
                const m = metricsOf(rightPlan, u.path);
                return (
                  <UnmatchedRow
                    key={`${u.identityKey}-${i}`}
                    index={i}
                    row={u}
                    metrics={m}
                    kind="added"
                    isActive={activeKey === u.identityKey}
                    onClick={() => onPick({ kind: "added", row: u })}
                    rightPlan={rightPlan}
                  />
                );
              })}
            {active === "removed" &&
              diff.removedLeft.map((u, i) => {
                const m = metricsOf(leftPlan, u.path);
                return (
                  <UnmatchedRow
                    key={`${u.identityKey}-${i}`}
                    index={i}
                    row={u}
                    metrics={m}
                    kind="removed"
                    isActive={activeKey === u.identityKey}
                    onClick={() => onPick({ kind: "removed", row: u })}
                    rightPlan={leftPlan}
                  />
                );
              })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TabButton({
  active,
  testId,
  onClick,
  label,
}: {
  active: boolean;
  testId: string;
  onClick: () => void;
  label: string;
}): JSX.Element {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-pressed={active}
      onClick={onClick}
      data-testid={testId}
      className="btn btn-sm"
    >
      {label}
    </button>
  );
}

function deltaTone(n: number | null): "ok" | "crit" | "" {
  if (n === null || n === 0) return "";
  return n > 0 ? "crit" : "ok";
}

type ChangeKind = "modified" | "unchanged" | "added" | "removed";

function TypePill({ kind }: { kind: ChangeKind }): JSX.Element {
  const cls =
    kind === "modified" ? "warn" : kind === "added" ? "ok" : kind === "removed" ? "crit" : "info";
  const label =
    kind === "modified"
      ? "modified"
      : kind === "added"
        ? "added"
        : kind === "removed"
          ? "removed"
          : "unchanged";
  return (
    <span className={`q-pill ${cls}`} style={{ fontFamily: "var(--font-sans-q)", fontSize: 10.5 }}>
      {label}
    </span>
  );
}

function DeltaCell({
  value,
  suffix = "",
}: {
  value: number | null;
  suffix?: string;
}): JSX.Element {
  if (value === null) {
    return <span style={{ color: "var(--ink-5)" }}>—</span>;
  }
  const tone = deltaTone(value);
  const color =
    tone === "crit" ? "var(--danger-q)" : tone === "ok" ? "var(--accent-strong)" : "var(--ink-2)";
  return (
    <span
      style={{
        color,
        fontFamily: "var(--font-mono-q)",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {fmtSignedDelta(value, suffix) ?? "—"}
    </span>
  );
}

type DiffNoteT = (key: string) => string;

/**
 * Heuristic note for the "note" column. Tries to surface a short
 * explanation that helps an analyst skim the diff quickly.
 */
function noteForMatched(
  row: MatchedNode,
  left: NodeMetrics,
  right: NodeMetrics,
  t: DiffNoteT,
): string {
  if (row.nodeTypeChanged) {
    if (row.rightNodeType === "Seq Scan")
      return t("editor.explain.diff_panel.note.switch_to_full_scan");
    if (row.leftNodeType === "Seq Scan" && row.rightNodeType.startsWith("Index"))
      return t("editor.explain.diff_panel.note.switch_to_index");
    return `${row.leftNodeType} → ${row.rightNodeType}`;
  }
  // Heuristic: estimation way off → stale stats. Compare actual vs planned
  // ratio on the right side (the "current" plan).
  if (right.rows != null && right.planRows != null && right.planRows > 0) {
    const ratio = right.rows / right.planRows;
    if (ratio >= 10 || ratio <= 0.1) return t("editor.explain.diff_panel.note.stale_stats");
  }
  // Sort/Aggregate/Limit: structural unchanged but timing changed →
  // implies the cause is downstream, not this node itself.
  if (row.costDelta === 0 && row.rowsDelta === 0 && (row.timeDelta ?? 0) > 0) {
    if (
      row.leftNodeType === "Sort" ||
      row.leftNodeType === "Limit" ||
      row.leftNodeType === "Hash Join"
    )
      return t("editor.explain.diff_panel.note.same_key");
    return t("editor.explain.diff_panel.note.no_change");
  }
  if (row.costDelta === 0 && (row.timeDelta ?? 0) === 0 && (row.rowsDelta ?? 0) === 0) {
    return "—";
  }
  if ((row.costDelta ?? 0) > 0) return t("editor.explain.diff_panel.note.cost_up");
  if ((row.costDelta ?? 0) < 0) return t("editor.explain.diff_panel.note.cost_down");
  void left;
  return "—";
}

function noteForUnmatched(
  row: UnmatchedNode,
  kind: "added" | "removed",
  plan: unknown,
  t: DiffNoteT,
): string {
  const node = plan ? nodeAtPath(plan, row.path) : null;
  if (kind === "added") {
    if (row.nodeType === "Seq Scan") return t("editor.explain.diff_panel.note.added_full_scan");
    if (row.nodeType.startsWith("Index")) return t("editor.explain.diff_panel.note.added_index");
    if (node) {
      const cond =
        asString(node["Index Cond"]) ?? asString(node["Hash Cond"]) ?? asString(node.Filter);
      if (cond) return `cond: ${cond.slice(0, 40)}`;
    }
    return t("editor.explain.diff_panel.note.added_generic");
  }
  if (row.nodeType === "Seq Scan") return t("editor.explain.diff_panel.note.removed_full_scan");
  return t("editor.explain.diff_panel.note.removed_generic");
}

function MatchedRow({
  index,
  row,
  left,
  right,
  isActive,
  onClick,
}: {
  index: number;
  row: MatchedNode;
  left: NodeMetrics;
  right: NodeMetrics;
  isActive: boolean;
  onClick: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  const kind: ChangeKind =
    row.nodeTypeChanged ||
    (row.costDelta !== null && row.costDelta !== 0) ||
    (row.rowsDelta !== null && row.rowsDelta !== 0)
      ? "modified"
      : "unchanged";
  const note = noteForMatched(row, left, right, t);
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: row click toggles diff highlight; the canvas above is the visible feedback
    <tr
      data-testid={`diff-row-matched-${index}`}
      data-active={isActive}
      onClick={onClick}
      style={{
        cursor: "pointer",
        background: isActive ? "var(--brand-q-soft)" : undefined,
        boxShadow: isActive ? "inset 2px 0 0 var(--brand-q)" : undefined,
      }}
    >
      <td className="mono">{row.label}</td>
      <td>
        <TypePill kind={kind} />
      </td>
      <td className="num">
        <DeltaCell value={row.costDelta} />
      </td>
      <td className="num">
        <DeltaCell value={row.timeDelta} suffix=" ms" />
      </td>
      <td className="num">
        <DeltaCell value={row.rowsDelta} />
      </td>
      <td style={{ color: "var(--ink-3)" }}>
        {note}
        {isActive ? (
          <span style={{ marginLeft: 8, color: "var(--brand-q)", fontSize: 11 }}>✓ подсвечено</span>
        ) : null}
      </td>
    </tr>
  );
}

function UnmatchedRow({
  index,
  row,
  metrics,
  kind,
  isActive,
  onClick,
  rightPlan,
}: {
  index: number;
  row: UnmatchedNode;
  metrics: NodeMetrics;
  kind: "added" | "removed";
  isActive: boolean;
  onClick: () => void;
  /** Side plan to walk for the "note" column (right plan for added,
   * left plan for removed). */
  rightPlan: unknown;
}): JSX.Element {
  const { t } = useTranslation();
  const note = noteForUnmatched(row, kind, rightPlan, t);
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: row click toggles diff highlight; the canvas above is the visible feedback
    <tr
      data-testid={`diff-row-${kind}-${index}`}
      data-active={isActive}
      onClick={onClick}
      style={{
        cursor: "pointer",
        background: isActive ? "var(--brand-q-soft)" : undefined,
        boxShadow: isActive ? "inset 2px 0 0 var(--brand-q)" : undefined,
      }}
    >
      <td className="mono">{row.label}</td>
      <td>
        <TypePill kind={kind} />
      </td>
      <td className="num">{metrics.cost != null ? fmtAbs(metrics.cost) : "—"}</td>
      <td className="num">{metrics.time != null ? `${metrics.time.toFixed(2)} ms` : "—"}</td>
      <td className="num">{metrics.rows != null ? metrics.rows.toLocaleString() : "—"}</td>
      <td style={{ color: "var(--ink-3)" }}>
        {note}
        {isActive ? (
          <span style={{ marginLeft: 8, color: "var(--brand-q)", fontSize: 11 }}>✓ подсвечено</span>
        ) : null}
      </td>
    </tr>
  );
}
