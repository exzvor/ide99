import { Pin, PinOff, Trash2 } from "lucide-react";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import type { RecentPlanRow as RowDTO } from "../../lib/tauri";
import { useRecentPlans } from "./store";

interface RecentPlansRowProps {
  row: RowDTO;
}

const SQL_PREVIEW_MAX = 200;
const TABLE_PILLS_MAX = 4;
const SLOW_THRESHOLD_MS = 1000;

/**
 * — single Recent Plans list row.
 * — in compare mode renders a leading checkbox.
 * — quiet card layout: ANALYZE/EXPLAIN badge + duration metric +
 * SQL preview + table pills + cost. Click on the card itself selects in
 * preview mode, or toggles selection in compare mode.
 */
export function RecentPlansRow({ row }: RecentPlansRowProps): JSX.Element {
  const { t } = useTranslation();
  const selected = useRecentPlans((s) => s.selectedId === row.id);
  const compareMode = useRecentPlans((s) => s.compareMode);
  const isChecked = useRecentPlans((s) => s.compareSelected.includes(row.id));
  const sqlPreview =
    row.sql.length > SQL_PREVIEW_MAX ? `${row.sql.slice(0, SQL_PREVIEW_MAX)}…` : row.sql;
  const cost = row.totalCost == null ? null : row.totalCost.toFixed(2);

  function onRowClick(): void {
    if (compareMode) {
      useRecentPlans.getState().toggleCompareSelected(row.id);
    } else {
      useRecentPlans.getState().selectRow(row.id);
    }
  }

  const slow = row.durationMs >= SLOW_THRESHOLD_MS;
  const isSelectedInList = !compareMode && selected;
  const isHighlighted = compareMode ? isChecked : isSelectedInList;
  const tablesShown = row.involvedTables.slice(0, TABLE_PILLS_MAX);
  const moreTables = row.involvedTables.length - tablesShown.length;
  const mode = row.mode === "analyze" ? "ANALYZE" : "EXPLAIN";

  return (    <div
      className={`q-plan-row ${isHighlighted ? "selected" : ""} ${compareMode && !isChecked ? "dim" : ""}`}
      data-testid={`recent-plans-row-${row.id}`}
      style={{ margin: "4px 6px", cursor: compareMode ? "pointer" : "default" }}
      onClick={compareMode ? onRowClick : undefined}
      onKeyDown={
        compareMode
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onRowClick();
              }
            }
          : undefined
      }
      role={compareMode ? "button" : undefined}
      tabIndex={compareMode ? 0 : undefined}
    >
      <div className="head">
        {compareMode ? (          <input
            type="checkbox"
            checked={isChecked}
            onChange={() => useRecentPlans.getState().toggleCompareSelected(row.id)}
            onClick={(e) => e.stopPropagation()}
            data-testid={`recent-plans-row-checkbox-${row.id}`}
            aria-label={t("recent_plans.compare.toggle")}
          />
) : (          <button
            type="button"
            aria-label={row.pinned ? t("recent_plans.row.unpin") : t("recent_plans.row.toggle_pin")}
            title={row.pinned ? t("recent_plans.row.unpin") : t("recent_plans.row.toggle_pin")}
            onClick={(e) => {
              e.stopPropagation();
              void useRecentPlans.getState().togglePinned(row.id);
            }}
            className="btn-icon"
          >
            {row.pinned ? <Pin size={12} /> : <PinOff size={12} />}
          </button>
)}
        <span className={`q-pill ${row.mode === "analyze" ? "brand" : "info"}`}>{mode}</span>
        <span className="meta">{row.connectionName}</span>
        <div style={{ flex: 1 }} />
        <span className={`q-metric-bar ${slow ? "hot" : ""}`}>
          <span className="v">{row.durationMs}ms</span>
        </span>
      </div>
      <div className="sql">{sqlPreview}</div>
      <div className="footer">
        {tablesShown.map((tName) => (          <span key={tName} className="q-pill info" style={{ fontFamily: "var(--font-mono-q)" }}>
            {tName}
          </span>
))}
        {moreTables > 0 ? (          <span className="q-pill" style={{ fontFamily: "var(--font-mono-q)" }}>
            +{moreTables}
          </span>
) : null}
        <span className="cost">
          cost <b>{cost ?? t("recent_plans.row.no_cost")}</b>
        </span>
        {!compareMode && (          <>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={(e) => {
                e.stopPropagation();
                useRecentPlans.getState().selectRow(row.id);
              }}
            >
              {t("recent_plans.row.action.open")}
            </button>
            <button
              type="button"
              className="btn-icon"
              aria-label={t("recent_plans.row.action.delete")}
              title={t("recent_plans.row.action.delete")}
              data-testid={`recent-plans-row-delete-${row.id}`}
              onClick={(e) => {
                e.stopPropagation();
                if (window.confirm(t("recent_plans.delete_confirm"))) {
                  void useRecentPlans.getState().deleteRow(row.id);
                }
              }}
            >
              <Trash2 size={12} aria-hidden="true" />
            </button>
          </>
)}
      </div>
    </div>
);
}
