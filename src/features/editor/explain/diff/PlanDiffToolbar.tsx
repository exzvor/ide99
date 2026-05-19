import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { type PlanDiffSide, useEditor } from "../../store";

interface PlanDiffToolbarProps {
  tabId: string;
  left: PlanDiffSide;
  right: PlanDiffSide;
  leftLabel: string;
  rightLabel: string;
}

/**
 * — toolbar above the diff with side labels + Swap + Open A/B.
 * Open A/B routes to `openEditorFromRecent` (recent side) or
 * `openEditorTab` with a prefill (runtime side).
 */
export function PlanDiffToolbar({
  tabId,
  left,
  right,
  leftLabel,
  rightLabel,
}: PlanDiffToolbarProps): JSX.Element {
  const { t } = useTranslation();

  function openSide(side: PlanDiffSide): void {
    if (side.kind === "recent") {
      void useEditor.getState().openEditorFromRecent(side.recentPlanId);
    } else {
      useEditor.getState().openEditorTab(side.connectionId, { prefillSql: side.sql });
    }
  }

  return (    <div
      className="q-runbar"
      data-testid="plan-diff-toolbar"
      style={{ display: "flex", gap: 8, alignItems: "center" }}
    >
      <div style={{ display: "flex", flexDirection: "column", fontSize: 11 }}>
        <span data-testid="plan-diff-left-label">A: {leftLabel}</span>
        <span data-testid="plan-diff-right-label">B: {rightLabel}</span>
      </div>
      <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => useEditor.getState().swapPlanDiff(tabId)}
          data-testid="plan-diff-swap"
        >
          ⇄ {t("editor.explain.diff.toolbar.swap")}
        </button>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => openSide(left)}
          data-testid="plan-diff-open-a"
        >
          📝 {t("editor.explain.diff.toolbar.open_a")}
        </button>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => openSide(right)}
          data-testid="plan-diff-open-b"
        >
          📝 {t("editor.explain.diff.toolbar.open_b")}
        </button>
      </div>
    </div>
);
}
