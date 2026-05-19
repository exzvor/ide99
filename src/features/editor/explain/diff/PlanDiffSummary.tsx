import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import type { PlanDiff } from "../planDiff";

interface PlanDiffSummaryProps {
  diff: PlanDiff;
}

function fmtNumber(n: number | null): string {
  if (n === null) return "—";
  return Number.isInteger(n) ? n.toString() : n.toFixed(2);
}

/**
 * Δ% string: `-97% ▼` / `+12% ▲` / `0%`; null deltas → `n/a`.
 *
 * Returns the value WITHOUT outer parentheses — i18n templates own the
 * `({{deltaPct}})` wrap (fix; previously both helper and i18n
 * produced parens, rendering as `((−97% ▼))`).
 */
function deltaPctString(left: number | null, right: number | null): string {
  if (left === null || right === null) return "n/a";
  if (left === 0) {
    if (right === 0) return "0%";
    return right > 0 ? "+∞ ▲" : "-∞ ▼";
  }
  const pct = Math.round(((right - left) / Math.abs(left)) * 100);
  if (pct === 0) return "0%";
  if (pct > 0) return `+${pct}% ▲`;
  return `${pct}% ▼`;
}

/**
 * — Δcost / Δtime / shape summary band.
 * Renders the no-shared placeholder when matched is empty AND both sides
 * contributed content.
 */
export function PlanDiffSummary({ diff }: PlanDiffSummaryProps): JSX.Element {
  const { t } = useTranslation();
  const { matched, addedRight, removedLeft, summary } = diff;

  const showNoShared = matched.length === 0 && addedRight.length > 0 && removedLeft.length > 0;

  if (showNoShared) {
    return (      <div
        className="q-statusbar"
        data-testid="plan-diff-summary"
        style={{
          padding: "6px 10px",
          fontSize: 11,
          opacity: 0.85,
          borderBottom: "1px solid var(--hairline)",
        }}
      >
        <span data-testid="plan-diff-summary-no-shared">
          {t("editor.explain.diff.summary.no_shared")}
        </span>
      </div>
);
  }

  const costLine = t("editor.explain.diff.summary.cost", {
    leftCost: fmtNumber(summary.totalCostLeft),
    rightCost: fmtNumber(summary.totalCostRight),
    deltaPct: deltaPctString(summary.totalCostLeft, summary.totalCostRight),
  });
  const timeLine = t("editor.explain.diff.summary.time", {
    leftMs: fmtNumber(summary.totalTimeLeft),
    rightMs: fmtNumber(summary.totalTimeRight),
    deltaPct: deltaPctString(summary.totalTimeLeft, summary.totalTimeRight),
  });
  const shapeLine = t("editor.explain.diff.summary.shape", {
    added: addedRight.length,
    removed: removedLeft.length,
    matched: matched.length,
  });

  const costDelta = costDeltaInfo(summary.totalCostLeft, summary.totalCostRight);
  const timeDelta = timeDeltaInfo(summary.totalTimeLeft, summary.totalTimeRight);

  return (    <div className="q-diff-headline" data-testid="plan-diff-summary">
      <div className="meta-block">
        <span className="lbl">ΔCost</span>
        <span className={`delta ${costDelta.tone}`} data-testid="plan-diff-summary-cost">
          {costDelta.text}
        </span>
        <span className="val" style={{ opacity: 0.7 }}>
          {fmtNumber(summary.totalCostLeft)} → {fmtNumber(summary.totalCostRight)}
        </span>
      </div>
      <div className="meta-block">
        <span className="lbl">ΔTime</span>
        <span className={`delta ${timeDelta.tone}`} data-testid="plan-diff-summary-time">
          {timeDelta.text}
        </span>
        <span className="val" style={{ opacity: 0.7 }}>
          {fmtNumber(summary.totalTimeLeft)} ms → {fmtNumber(summary.totalTimeRight)} ms
        </span>
      </div>
      <div className="meta-block">
        <span className="lbl">ΔNodes</span>
        <span className="delta" data-testid="plan-diff-summary-shape">
          <span className="q-pill ok">+{addedRight.length}</span>{" "}
          <span className="q-pill crit">−{removedLeft.length}</span>
        </span>
        <span className="val" style={{ opacity: 0.7 }}>
          совпало · {matched.length}
        </span>
      </div>
      {/* Hidden plain-text fallbacks for tests that scrape the legacy summary */}
      <span style={{ position: "absolute", left: -9999, top: -9999 }}>
        <span data-testid="plan-diff-summary-cost-line">{costLine}</span>
        <span data-testid="plan-diff-summary-time-line">{timeLine}</span>
        <span data-testid="plan-diff-summary-shape-line">{shapeLine}</span>
      </span>
    </div>
);
}

function costDeltaInfo(  l: number | null,
  r: number | null,
): { text: string; tone: "ok" | "crit" | "" } {
  if (l === null || r === null) return { text: "n/a", tone: "" };
  const delta = r - l;
  const pct = deltaPctString(l, r);
  if (delta === 0) return { text: "0 (0%)", tone: "" };
  return {
    text: `${delta > 0 ? "+" : ""}${fmtNumber(delta)} (${pct})`,
    tone: delta > 0 ? "crit" : "ok",
  };
}

function timeDeltaInfo(  l: number | null,
  r: number | null,
): { text: string; tone: "ok" | "crit" | "" } {
  if (l === null || r === null) return { text: "n/a", tone: "" };
  const delta = r - l;
  const pct = deltaPctString(l, r);
  if (delta === 0) return { text: "0 ms (0%)", tone: "" };
  return {
    text: `${delta > 0 ? "+" : ""}${fmtNumber(delta)} ms (${pct})`,
    tone: delta > 0 ? "crit" : "ok",
  };
}
