import { ArrowDown, Search } from "lucide-react";
import { type JSX, type ReactNode, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SlowQuery, SlowSnapshot, SlowSortBy } from "../../../lib/tauri";
import { useEditor } from "../../editor/store";
import { CardStateRouter } from "../CardStateRouter";
import { useLiveOps } from "../store";
import type { CardData } from "../types";

interface Props {
  connId: string;
}

type TimeRange = "1h" | "24h" | "all";

function pluralRu(count: number, key: (suffix: "one" | "few" | "many") => string): string {
  const n10 = count % 10;
  const n100 = count % 100;
  if (n100 >= 11 && n100 <= 14) return key("many");
  if (n10 === 1) return key("one");
  if (n10 >= 2 && n10 <= 4) return key("few");
  return key("many");
}

function formatMs(value: number): string {
  if (value >= 1000) {
    const s = (value / 1000).toFixed(1);
    return `${s} s`;
  }
  return `${value.toFixed(1)} ms`;
}

function formatThousands(n: number): string {
  return n.toLocaleString("ru-RU").replace(/ /g, " ");
}

interface SortHeaderProps {
  col: SlowSortBy;
  current: SlowSortBy;
  children: ReactNode;
  onClick: () => void;
}
function SortHeader({ col, current, children, onClick }: SortHeaderProps): JSX.Element {
  const isCurrent = col === current;
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: header sort click is mouse-only by design; keyboard users can still re-sort via context cycle
    <th
      onClick={onClick}
      aria-sort={isCurrent ? "descending" : "none"}
      data-testid={`slow-sort-${col}`}
      className={isCurrent ? "is-sorted" : ""}
    >
      <span className="th-inner">
        {children}
        {isCurrent ? <ArrowDown size={10} aria-hidden="true" /> : null}
      </span>
    </th>
  );
}

export function SlowQueriesPane({ connId }: Props): JSX.Element | null {
  const { t } = useTranslation();
  const slice = useLiveOps((s) => s.byConn.get(connId));
  const [search, setSearch] = useState("");
  const [range, setRange] = useState<TimeRange>("1h");
  if (!slice) return null;
  const { sortBy, data } = slice.slow;

  const onClickRow = (q: string): void => {
    useEditor.getState().openEditorTab(connId, { prefillSql: q });
  };

  const onExplain = async (q: string): Promise<void> => {
    const editor = useEditor.getState();
    const tab = editor.openEditorTab(connId, { prefillSql: q });
    await editor.runExplain(tab.id, "explain");
  };

  return (
    <div className="live-ops-slow" data-testid="live-ops-slow">
      <div className="live-ops-toolbar">
        <label className="live-ops-search">
          <Search size={13} aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("live_ops.slow.search_placeholder")}
            data-testid="live-ops-slow-search"
            aria-label={t("live_ops.slow.search_placeholder")}
          />
        </label>
        <select
          className="live-ops-time-range"
          value={range}
          onChange={(e) => setRange(e.target.value as TimeRange)}
          aria-label={t("live_ops.slow.time_range.label")}
          data-testid="live-ops-slow-range"
        >
          <option value="1h">{t("live_ops.slow.time_range.1h")}</option>
          <option value="24h">{t("live_ops.slow.time_range.24h")}</option>
          <option value="all">{t("live_ops.slow.time_range.all")}</option>
        </select>
        <SlowSummaryChip data={data} search={search} />
      </div>

      <div className="live-ops-slow-scroll">
        <CardStateRouter
          state={data}
          renderReady={(snap) => {
            const filtered = filterAndSort(snap.rows, search, sortBy);
            if (snap.rows.length === 0) {
              return <div className="live-ops-shimmer">{t("live_ops.slow.empty")}</div>;
            }
            if (filtered.length === 0) {
              return <div className="live-ops-shimmer">{t("live_ops.slow.empty_filtered")}</div>;
            }
            const maxMean = filtered.reduce((m, r) => Math.max(m, r.meanExecTimeMs), 0);
            return (
              <table className="live-ops-slow-table v2" data-testid="live-ops-slow-table">
                <thead>
                  <tr>
                    <SortHeader
                      col="meanExecTime"
                      current={sortBy}
                      onClick={() => useLiveOps.getState().setSortBy(connId, "meanExecTime")}
                    >
                      {t("live_ops.slow.col.mean")}
                    </SortHeader>
                    <SortHeader
                      col="totalExecTime"
                      current={sortBy}
                      onClick={() => useLiveOps.getState().setSortBy(connId, "totalExecTime")}
                    >
                      {t("live_ops.slow.col.total")}
                    </SortHeader>
                    <SortHeader
                      col="calls"
                      current={sortBy}
                      onClick={() => useLiveOps.getState().setSortBy(connId, "calls")}
                    >
                      {t("live_ops.slow.col.calls")}
                    </SortHeader>
                    <SortHeader
                      col="meanRows"
                      current={sortBy}
                      onClick={() => useLiveOps.getState().setSortBy(connId, "meanRows")}
                    >
                      {t("live_ops.slow.col.rows")}
                    </SortHeader>
                    <th>{t("live_ops.slow.col.query")}</th>
                    <th aria-label={t("live_ops.slow.explain")} />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r, i) => {
                    const isHot = sortBy === "meanExecTime" && r.meanExecTimeMs === maxMean;
                    return (
                      // biome-ignore lint/a11y/useKeyWithClickEvents: row-click opens a new editor tab; keyboard users can use Cmd+E from the editor pane
                      <tr
                        key={`${r.query}-${i}`}
                        onClick={() => onClickRow(r.query)}
                        data-testid="slow-query-row"
                      >
                        <td className={`num${isHot ? " is-hot" : ""}`}>
                          {formatMs(r.meanExecTimeMs)}
                        </td>
                        <td className="num">{(r.totalExecTimeMs / 1000).toFixed(1)} s</td>
                        <td className="num">{formatThousands(r.calls)}</td>
                        <td className="num soft">
                          {t("live_ops.slow.rows_per_call", { count: Math.round(r.meanRows) })}
                        </td>
                        <td className="query mono">
                          <span className="query-text">{r.query}</span>
                        </td>
                        <td className="explain-cell">
                          <button
                            type="button"
                            className="btn-ghost-sm explain-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              void onExplain(r.query);
                            }}
                          >
                            {t("live_ops.slow.explain")}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            );
          }}
        />
      </div>
    </div>
  );
}

function filterAndSort(
  rows: readonly SlowQuery[],
  search: string,
  sortBy: SlowSortBy,
): SlowQuery[] {
  const needle = search.trim().toLowerCase();
  const filtered = needle
    ? rows.filter((r) => r.query.toLowerCase().includes(needle))
    : rows.slice();
  switch (sortBy) {
    case "meanExecTime":
      filtered.sort((a, b) => b.meanExecTimeMs - a.meanExecTimeMs);
      break;
    case "totalExecTime":
      filtered.sort((a, b) => b.totalExecTimeMs - a.totalExecTimeMs);
      break;
    case "calls":
      filtered.sort((a, b) => b.calls - a.calls);
      break;
    case "meanRows":
      filtered.sort((a, b) => b.meanRows - a.meanRows);
      break;
  }
  return filtered;
}

interface SummaryProps {
  data: CardData<SlowSnapshot>;
  search: string;
}
function SlowSummaryChip({ data, search }: SummaryProps): JSX.Element | null {
  const { t } = useTranslation();
  const summary = useMemo(() => {
    if (data.status !== "ready") return null;
    const needle = search.trim().toLowerCase();
    const rows = needle
      ? data.data.rows.filter((r) => r.query.toLowerCase().includes(needle))
      : data.data.rows;
    if (rows.length === 0) return null;
    const p99 = rows.reduce((m, r) => Math.max(m, r.meanExecTimeMs), 0);
    return { count: rows.length, p99 };
  }, [data, search]);
  if (!summary) return null;
  const label = pluralRu(summary.count, (s) =>
    t(`live_ops.slow.summary.queries_${s}`, { count: summary.count }),
  );
  const p99Label = t("live_ops.slow.summary.p99", {
    ms: Math.round(summary.p99).toLocaleString("ru-RU").replace(/ /g, " "),
  });
  return (
    <span className="live-ops-summary-chip has-blocked" data-testid="live-ops-slow-summary">
      {label} · <span className="num-strong">{p99Label}</span>
    </span>
  );
}
