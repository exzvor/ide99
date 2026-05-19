import { type JSX, useState } from "react";
import { useTranslation } from "react-i18next";
import { recentPlansGet } from "../../../lib/tauri";
import { type EditorTab, type ExplainTab, type PlanDiffSide, useEditor } from "../store";
import { RecentPlansPickerModal } from "./RecentPlansPickerModal";

interface ExplainToolbarProps {
  tab: ExplainTab;
  isRunning: boolean;
}

const OPTION_KEYS: Array<"verbose" | "wal" | "timing"> = ["verbose", "wal", "timing"];

/**
 * — slim toolbar for an EXPLAIN tab.
 *
 * Layout (left → right): mode badge, three option toggle pills (verbose,
 * wal, timing — wal/timing greyed-out when mode === "explain" since plain
 * EXPLAIN ignores them), and on the right either Re-run (idle/ready/error
 * states) or Cancel (running). — adds `[Diff with…]` (visible
 * only when runState.status === "ready") that opens a `RecentPlansPickerModal`.
 */
export function ExplainToolbar({ tab, isRunning }: ExplainToolbarProps): JSX.Element {
  const { t } = useTranslation();
  const isAnalyze = tab.options.mode === "analyze";
  const isCached = tab.sourceTabId === null && tab.cachedRecentPlanId != null;
  const runState = useEditor((s) => s.explainRunStates.get(tab.id));
  const isReady = runState?.status === "ready";

  const [pickerOpen, setPickerOpen] = useState(false);
  const [defaultConnId, setDefaultConnId] = useState<string | null>(null);

  async function openPicker() {
    let connId: string | null = null;
    if (tab.cachedRecentPlanId) {
      const row = await recentPlansGet(tab.cachedRecentPlanId).catch(() => null);
      connId = row?.connectionId ?? null;
    } else if (tab.sourceTabId) {
      const source = useEditor
        .getState()
        .tabs.find((t): t is EditorTab => t.id === tab.sourceTabId && t.kind === "editor");
      connId = source?.connectionId ?? null;
    }
    setDefaultConnId(connId);
    setPickerOpen(true);
  }

  function buildCurrentSide(): PlanDiffSide | null {
    if (tab.cachedRecentPlanId) {
      return { kind: "recent", recentPlanId: tab.cachedRecentPlanId };
    }
    if (!runState || runState.status !== "ready") return null;
    let connectionId: string | null = null;
    if (tab.sourceTabId) {
      const source = useEditor
        .getState()
        .tabs.find((t): t is EditorTab => t.id === tab.sourceTabId && t.kind === "editor");
      connectionId = source?.connectionId ?? null;
    }
    return {
      kind: "runtime",
      planJson: runState.plan,
      sql: runState.executedSql,
      connectionId,
      executedAt: new Date(runState.ranAt).toISOString(),
      durationMs: runState.durationMs,
      mode: tab.options.mode,
      optionsJson: JSON.stringify(tab.options),
    };
  }

  return (    <div className="q-runbar" data-testid="explain-toolbar">
      <span className={isAnalyze ? "q-pill ok" : "q-pill"} data-testid="explain-mode-badge">
        {isAnalyze
          ? t("editor.explain.toolbar.mode_analyze")
          : t("editor.explain.toolbar.mode_explain")}
      </span>

      <div style={{ display: "flex", gap: 6, marginLeft: 12 }}>
        {OPTION_KEYS.map((key) => {
          const enabled = key === "verbose" || isAnalyze;
          const checked = tab.options[key];
          const disabled = !enabled || isCached;
          return (            <label
              key={key}
              className={`q-pill ${checked ? "ok" : ""}`}
              data-testid={`explain-toggle-${key}`}
              title={isCached ? t("editor.explain.toolbar.cached.no_options") : undefined}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                opacity: disabled ? 0.4 : 1,
                cursor: disabled ? "not-allowed" : "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={disabled}
                onChange={() => useEditor.getState().toggleExplainOption(tab.id, key)}
                aria-label={t(`editor.explain.toolbar.option_${key}`)}
                style={{ margin: 0 }}
              />
              <span>{t(`editor.explain.toolbar.option_${key}`)}</span>
            </label>
);
        })}
      </div>

      <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
        {isRunning ? (          <button
            type="button"
            className="btn btn-sm"
            onClick={() => useEditor.getState().cancelExplain(tab.id)}
            data-testid="explain-cancel"
          >
            {t("editor.explain.toolbar.cancel")}
          </button>
) : (          <>
            <button
              type="button"
              className="btn btn-accent btn-sm"
              onClick={() => void useEditor.getState().rerunExplain(tab.id)}
              disabled={isCached}
              title={isCached ? t("editor.explain.toolbar.cached.no_rerun") : undefined}
              data-testid="explain-rerun"
            >
              ↻ {t("editor.explain.toolbar.rerun")}
            </button>
            {isCached && (              <button
                type="button"
                className="btn btn-sm"
                onClick={() =>
                  // biome-ignore lint/style/noNonNullAssertion: isCached implies cachedRecentPlanId is set
                  void useEditor.getState().openEditorFromRecent(tab.cachedRecentPlanId!)
                }
                data-testid="explain-open-sql"
              >
                📝 {t("editor.explain.toolbar.open_sql")}
              </button>
)}
            {isReady && (              <button
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  void openPicker();
                }}
                data-testid="explain-diff-with"
              >
                {t("editor.explain.toolbar.diff_with")}
              </button>
)}
          </>
)}
      </div>

      <RecentPlansPickerModal
        open={pickerOpen}
        defaultConnectionId={defaultConnId}
        onPick={(side) => {
          const currentSide = buildCurrentSide();
          if (currentSide) {
            useEditor.getState().openPlanDiff(currentSide, side);
          }
          setPickerOpen(false);
        }}
        onCancel={() => setPickerOpen(false)}
      />
    </div>
);
}
