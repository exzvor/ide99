import { type JSX, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useConnections } from "../connections/store";
import { useRecentPlans } from "./store";

const DEBOUNCE_MS = 300;

/**
 * — top-bar filters for the Recent Plans list.
 *
 * - Search input is local + debounced 300ms before being pushed into the
 * store filter; this avoids one IPC round-trip per keystroke.
 * - Table dropdown is populated from the union of `involvedTables` across
 * currently-loaded rows, sorted alphabetically.
 * - Cost min/max + connection dropdown refresh immediately on change.
 * - Reset wipes both the local search state and the store filter.
 */
export function RecentPlansFilters(): JSX.Element {
  const { t } = useTranslation();
  const filter = useRecentPlans((s) => s.filter);
  const rows = useRecentPlans((s) => s.rows);
  const compareMode = useRecentPlans((s) => s.compareMode);
  const compareSelected = useRecentPlans((s) => s.compareSelected);
  const connections = useConnections((s) => s.connections);

  const [search, setSearch] = useState(filter.query ?? "");

  // Debounced search — push into the filter and trigger a refresh after
  // the user has stopped typing for DEBOUNCE_MS. We intentionally only
  // trigger on `search` changes; including filter.query would create a
  // debounce loop on every refresh response that round-trips back into
  // the store.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see comment above
  useEffect(() => {
    if (search === (filter.query ?? "")) return;
    const handle = setTimeout(() => {
      useRecentPlans.getState().setFilter({ query: search || undefined });
      void useRecentPlans.getState().refresh();
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [search]);

  // Tables present in the currently-loaded rows — populates the dropdown
  // cheaply without asking the backend for a distinct list.
  const tablesInRows = Array.from(new Set(rows.flatMap((r) => r.involvedTables))).sort();

  return (    <div
      className="q-runbar"
      data-testid="recent-plans-filters"
      style={{
        display: "flex",
        gap: 8,
        padding: "6px 10px",
        flexWrap: "wrap",
        alignItems: "center",
      }}
    >
      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t("recent_plans.filter.search")}
        className="q-input"
        style={{ flex: "1 1 220px", minWidth: 180, width: "auto" }}
      />
      <select
        value={filter.table ?? ""}
        onChange={(e) => {
          useRecentPlans.getState().setFilter({ table: e.target.value || undefined });
          void useRecentPlans.getState().refresh();
        }}
        className="q-input"
        style={{ flex: "0 0 auto", width: "auto", minWidth: 140 }}
      >
        <option value="">{t("recent_plans.filter.table_any")}</option>
        {tablesInRows.map((tName) => (          <option key={tName} value={tName}>
            {tName}
          </option>
))}
      </select>
      <input
        type="number"
        value={filter.costMin ?? ""}
        placeholder={t("recent_plans.filter.cost_min")}
        onChange={(e) => {
          const v = e.target.value === "" ? undefined : Number(e.target.value);
          useRecentPlans.getState().setFilter({ costMin: v });
          void useRecentPlans.getState().refresh();
        }}
        className="q-input"
        style={{ flex: "0 0 auto", width: 110 }}
      />
      <input
        type="number"
        value={filter.costMax ?? ""}
        placeholder={t("recent_plans.filter.cost_max")}
        onChange={(e) => {
          const v = e.target.value === "" ? undefined : Number(e.target.value);
          useRecentPlans.getState().setFilter({ costMax: v });
          void useRecentPlans.getState().refresh();
        }}
        className="q-input"
        style={{ flex: "0 0 auto", width: 110 }}
      />
      <select
        value={filter.connectionId ?? ""}
        onChange={(e) => {
          useRecentPlans.getState().setFilter({ connectionId: e.target.value || undefined });
          void useRecentPlans.getState().refresh();
        }}
        className="q-input"
        style={{ flex: "0 0 auto", width: "auto", minWidth: 160 }}
      >
        <option value="">{t("recent_plans.filter.conn_all")}</option>
        {connections.map((c) => (          <option key={c.id} value={c.id}>
            {c.name}
          </option>
))}
      </select>
      <button
        type="button"
        className="btn btn-sm btn-ghost"
        onClick={() => {
          setSearch("");
          useRecentPlans.getState().setFilter({
            query: undefined,
            table: undefined,
            costMin: undefined,
            costMax: undefined,
            connectionId: undefined,
          });
          void useRecentPlans.getState().refresh();
        }}
      >
        {t("recent_plans.filter.reset")}
      </button>
      <button
        type="button"
        className={`btn btn-sm ${compareMode ? "btn-accent" : "btn-ghost"}`}
        onClick={() => useRecentPlans.getState().toggleCompareMode()}
        data-testid="recent-plans-compare-toggle"
      >
        ⇄ {t("recent_plans.compare.toggle")}
        {compareMode ? ` (${compareSelected.length})` : ""}
      </button>
    </div>
);
}
