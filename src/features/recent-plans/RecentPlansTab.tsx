import { type JSX, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { RecentPlansFilters } from "./RecentPlansFilters";
import { RecentPlansList } from "./RecentPlansList";
import { RecentPlansPreview } from "./RecentPlansPreview";
import { useRecentPlans } from "./store";

const SQL_PREVIEW_MAX = 80;

/**
 * — Recent Plans browser pane.
 * — compare-mode bar + hide preview when active.
 */
export function RecentPlansTab(): JSX.Element {
  const { t } = useTranslation();
  // First mount → fetch with default filter.
  useEffect(() => {
    void useRecentPlans.getState().refresh();
  }, []);

  const compareMode = useRecentPlans((s) => s.compareMode);
  const selected = useRecentPlans((s) => s.compareSelected);
  const rows = useRecentPlans((s) => s.rows);

  const previews = useMemo(() => {
    return selected.map((id) => rows.find((r) => r.id === id) ?? null);
  }, [rows, selected]);

  return (
    <div
      style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}
      data-testid="recent-plans-tab"
    >
      <RecentPlansFilters />
      {compareMode ? (
        <div
          data-testid="recent-plans-compare-bar"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
            padding: "8px 10px",
            borderBottom: "1px solid var(--hairline)",
            background: "var(--bg-elev)",
          }}
        >
          <div style={{ fontSize: 11 }}>
            {t("recent_plans.compare.selected_count", { count: selected.length })}
          </div>
          {previews[0] ? (
            <div style={{ fontSize: 11, fontFamily: "var(--font-mono)", opacity: 0.85 }}>
              {t("recent_plans.compare.row_label_a")}{" "}
              {previews[0].sql.length > SQL_PREVIEW_MAX
                ? `${previews[0].sql.slice(0, SQL_PREVIEW_MAX)}…`
                : previews[0].sql}
            </div>
          ) : null}
          {previews[1] ? (
            <div style={{ fontSize: 11, fontFamily: "var(--font-mono)", opacity: 0.85 }}>
              {t("recent_plans.compare.row_label_b")}{" "}
              {previews[1].sql.length > SQL_PREVIEW_MAX
                ? `${previews[1].sql.slice(0, SQL_PREVIEW_MAX)}…`
                : previews[1].sql}
            </div>
          ) : null}
          <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
            <button
              type="button"
              className="btn btn-sm btn-accent"
              disabled={selected.length !== 2}
              onClick={() => useRecentPlans.getState().startCompare()}
              data-testid="recent-plans-compare-run"
            >
              ⇄ {t("recent_plans.compare.run")}
            </button>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => useRecentPlans.getState().toggleCompareMode()}
              data-testid="recent-plans-compare-cancel"
            >
              {t("recent_plans.compare.cancel")}
            </button>
          </div>
        </div>
      ) : null}
      <div
        style={{ flex: 1, minHeight: 0, display: "flex", flexWrap: "wrap" }}
        data-testid="recent-plans-split"
      >
        <div
          style={{
            width: compareMode ? "100%" : "45%",
            minWidth: 0,
            flex: compareMode ? "1 1 100%" : "1 1 280px",
            display: "flex",
            flexDirection: "column",
            borderRight: compareMode ? undefined : "1px solid var(--hairline)",
          }}
        >
          <RecentPlansList />
        </div>
        {!compareMode ? (
          <div
            style={{
              flex: "1 1 280px",
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <RecentPlansPreview />
          </div>
        ) : null}
      </div>
    </div>
  );
}
