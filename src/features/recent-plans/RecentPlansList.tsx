import { useVirtualizer } from "@tanstack/react-virtual";
import { type JSX, useRef } from "react";
import { useTranslation } from "react-i18next";
import { RecentPlansRow } from "./RecentPlansRow";
import { useRecentPlans } from "./store";

const ESTIMATED_ROW_HEIGHT = 78; // sql + meta + tables + actions ≈ 70-90px

/**
 * — virtualized Recent Plans list.
 *
 * Uses @tanstack/react-virtual (already a dep, used by S5 ResultGrid) to
 * keep DOM size bounded even when the LRU cap is later raised. Empty
 * state distinguishes "no rows in DB" from "filter excludes everything".
 */
export function RecentPlansList(): JSX.Element {
  const { t } = useTranslation();
  const rows = useRecentPlans((s) => s.rows);
  const total = useRecentPlans((s) => s.total);
  const loading = useRecentPlans((s) => s.loading);
  const filterQuery = useRecentPlans((s) => s.filter.query);

  const parentRef = useRef<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    overscan: 5,
  });

  if (rows.length === 0 && !loading) {
    return (      <div data-testid="recent-plans-list-empty" style={{ padding: 20, opacity: 0.6 }}>
        {filterQuery ? t("recent_plans.empty_filtered") : t("recent_plans.empty")}
      </div>
);
  }

  return (    <div ref={parentRef} style={{ flex: 1, overflowY: "auto" }} data-testid="recent-plans-list">
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((vrow) => {
          const row = rows[vrow.index];
          return (            <div
              key={row.id}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                transform: `translateY(${vrow.start}px)`,
              }}
              ref={virtualizer.measureElement}
              data-index={vrow.index}
            >
              <RecentPlansRow row={row} />
            </div>
);
        })}
      </div>
      {rows.length < total && (        <div style={{ padding: 8, textAlign: "center" }}>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => void useRecentPlans.getState().loadMore()}
          >
            {t("recent_plans.load_more")}
          </button>
        </div>
)}
    </div>
);
}
