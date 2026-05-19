import { useVirtualizer } from "@tanstack/react-virtual";
import { type JSX, type MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConceptTooltip } from "../concept-tooltips";
import { useConnections } from "../connections/store";
import { useJsonbEditor } from "../jsonb/state/store";
import {
  type DistanceOp,
  KnnBrowseDialog,
  KnnBrowseResultPane,
  detectVectorColumns,
} from "../pgvector";
import { detectGeometryColumns } from "../postgis";
import { Cell } from "./Cell";
import { FilterDropdown } from "./FilterDropdown";
import { ValueModal } from "./ValueModal";
import { type RunState, useEditor } from "./store";

const ROW_HEIGHT = 28;
const PREFETCH_THRESHOLD = 200;
const DEFAULT_COL_WIDTH = 160;

const JSON_TYPES = new Set(["json", "jsonb"]);

type Streaming = Extract<RunState, { status: "streaming" }>;

/**
 * Virtualized result grid (§4.3).
 *
 * - TanStack Virtual with fixed `ROW_HEIGHT` for 60fps scroll.
 * - Header click cycles sort state none→asc→desc→none (Q6).
 * - Right-edge handle on each header drags column width (Q § 4.4).
 * - Mousedown on header + mouseup on a different header swaps `columnOrder`.
 * - Click on a cell selects it; Cmd/Ctrl+C copies the value to clipboard.
 * - Prefetch trigger fires `fetchMore` when the last visible row index is
 * within `PREFETCH_THRESHOLD` of the loaded edge — never re-fires while
 * `prefetching=true` or `exhausted=true`.
 */
export function ResultGrid({ tabId, run }: { tabId: string; run: Streaming }): JSX.Element {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const fetchMore = useEditor((s) => s.fetchMore);
  const setSort = useEditor((s) => s.setSort);
  const setColumnWidth = useEditor((s) => s.setColumnWidth);
  const setColumnOrder = useEditor((s) => s.setColumnOrder);
  // S20 — bidirectional filter UI
  const queryShape = useEditor((s) => s.queryShapes.get(tabId) ?? null);
  const setFilter = useEditor((s) => s.setFilter);
  const [openFilterIdx, setOpenFilterIdx] = useState<number | null>(null);
  const filtersActive = queryShape !== null && queryShape.unrepresentableTail === null;

  // — subtle prod-env tint on the header row.
  const tabs = useEditor((s) => s.tabs);
  const connections = useConnections((s) => s.connections);
  const isProd = useMemo(() => {
    const tab = tabs.find((x) => x.id === tabId);
    if (!tab || !("connectionId" in tab) || tab.connectionId === null) return false;
    return connections.find((c) => c.id === tab.connectionId)?.environment === "prod";
  }, [tabs, tabId, connections]);

  const virtualizer = useVirtualizer({
    count: run.rows.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 50,
  });

  const items = virtualizer.getVirtualItems();
  const lastIdx = items.length === 0 ? -1 : items[items.length - 1].index;
  // Prefetch: fire fetchMore when the bottom of the visible window approaches
  // the loaded edge. Single-flight guarded by `prefetching` in the store.
  useEffect(() => {
    if (lastIdx < 0) return;
    if (run.exhausted || run.prefetching || run.cursorId === null) return;
    if (lastIdx + PREFETCH_THRESHOLD > run.rows.length) {
      void fetchMore(tabId);
    }
  }, [lastIdx, run.exhausted, run.prefetching, run.cursorId, run.rows.length, fetchMore, tabId]);

  // Sort cycle: none → asc → desc → none on header click.
  function onHeaderClick(srcColumnIdx: number) {
    const cur = run.sort;
    if (cur === null || cur.columnIdx !== srcColumnIdx) {
      setSort(tabId, srcColumnIdx, "asc");
    } else if (cur.dir === "asc") {
      setSort(tabId, srcColumnIdx, "desc");
    } else {
      setSort(tabId, srcColumnIdx, null);
    }
  }

  // Column reorder: mousedown on a header, mouseup on a different header.
  // Same-header up = no swap (sort cycle wins via the click handler).
  const dragRef = useRef<{ srcIdx: number } | null>(null);
  function onHeaderMouseDown(srcIdx: number, e: MouseEvent) {
    if (e.button !== 0) return;
    dragRef.current = { srcIdx };
    function onUp(ev: globalThis.MouseEvent) {
      const start = dragRef.current;
      dragRef.current = null;
      window.removeEventListener("mouseup", onUp);
      if (!start) return;
      const target = document.elementFromPoint(ev.clientX, ev.clientY);
      const headerEl = target?.closest('[role="columnheader"]') as HTMLElement | null;
      if (!headerEl) return;
      const dstAttr = headerEl.getAttribute("data-srcidx");
      if (dstAttr === null) return;
      const dstIdx = Number(dstAttr);
      if (dstIdx === start.srcIdx) return;
      const order = [...run.columnOrder];
      const a = order.indexOf(start.srcIdx);
      const b = order.indexOf(dstIdx);
      if (a < 0 || b < 0) return;
      [order[a], order[b]] = [order[b] as number, order[a] as number];
      setColumnOrder(tabId, order);
    }
    window.addEventListener("mouseup", onUp);
  }

  // Cell selection state. Single-cell only on S5; multi-cell range deferred.
  const [selected, setSelected] = useState<{ row: number; col: number } | null>(null);

  // S26 — kNN context-menu wiring. Auto-detects vector columns from the run's
  // typeName metadata; menu only appears when at least one vector column is
  // present in the result.
  const vectorCols = useMemo(
    () => detectVectorColumns(run.columns.map((c) => ({ name: c.name, typeName: c.typeName }))),
    [run.columns],
  );
  // S27 — PostGIS Map View button: gated on geometry/geography column presence.
  const geometryCols = useMemo(
    () => detectGeometryColumns(run.columns.map((c) => ({ name: c.name, typeName: c.typeName }))),
    [run.columns],
  );
  const openMapViewTab = useEditor((s) => s.openMapViewTab);
  const [knnMenu, setKnnMenu] = useState<{ x: number; y: number } | null>(null);
  const [knnDialog, setKnnDialog] = useState<{ vectorColumn: string } | null>(null);
  const [knnResult, setKnnResult] = useState<{
    sql: string;
    pivotPreview: string;
    distanceOp: DistanceOp;
  } | null>(null);
  const tabConnId = useEditor((s) => {
    const tab = s.tabs.find((t) => t.id === tabId);
    if (!tab) return null;
    return "connectionId" in tab ? (tab.connectionId ?? null) : null;
  });
  const tabSql = useEditor((s) => {
    const tab = s.tabs.find((t) => t.id === tabId);
    return tab && tab.kind === "editor" ? tab.content : "";
  });
  // Best-effort `FROM <qualified_table>` extraction for the kNN dialog.
  // If the query is too complex to parse, fall back to empty string and the
  // dialog will still build a SQL skeleton that the user can edit.
  const inferredTable = useMemo(() => {
    const match = /\bFROM\s+("?\w+"?(?:\."?\w+"?)?)/i.exec(tabSql);
    return match ? (match[1] ?? "") : "";
  }, [tabSql]);
  useEffect(() => {
    if (!knnMenu) return;
    const close = () => setKnnMenu(null);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", close);
    };
  }, [knnMenu]);
  // modal opens at the grid level so Enter / double-click work even
  // when the keyboard focus didn't make it down to the per-cell <span> (Cell
  // renderers don't tabIndex themselves, so prior to this their onDoubleClick
  // worked but Enter went to the still-focused Monaco editor).
  const [preview, setPreview] = useState<{ value: string; language: "json" | "text" } | null>(null);

  function openSelected() {
    if (!selected) return;
    const srcIdx = run.columnOrder[selected.col];
    if (srcIdx === undefined) return;
    const col = run.columns[srcIdx];
    const value = run.rows[selected.row]?.[srcIdx];
    if (value === undefined || value === null) return;
    if (col && JSON_TYPES.has(col.typeName)) {
      // — json/jsonb cells open the editable JSONB editor
      // instead of the read-only ValueModal.
      void useJsonbEditor
        .getState()
        .openEditor({ tabId, rowIdx: selected.row, srcColIdx: srcIdx }, value);
      return;
    }
    setPreview({ value, language: "text" });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "c" && selected) {
      e.preventDefault();
      const { row, col } = selected;
      const srcIdx = run.columnOrder[col];
      if (srcIdx === undefined) return;
      const value = run.rows[row]?.[srcIdx];
      if (value !== undefined && value !== null) {
        void navigator.clipboard?.writeText(value);
      }
      return;
    }
    if (e.key === "Enter" && selected) {
      e.preventDefault();
      e.stopPropagation();
      openSelected();
    }
  }

  function colWidth(srcIdx: number): number {
    return run.columnWidths.get(srcIdx) ?? DEFAULT_COL_WIDTH;
  }

  return (
    // ARIA-roles biome rules are disabled for this file in biome.json — the
    // virtualized grid intentionally uses divs+roles rather than <table>/<tr>/<th>
    // because TanStack Virtual's fixed-row-height + absolute-positioning model
    // doesn't compose with semantic table markup.
    <div
      ref={containerRef}
      role="grid"
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="q-scroll"
      style={{
        position: "relative",
        height: "100%",
        width: "100%",
        overflow: "auto",
        outline: "none",
        fontFamily: "var(--font-mono-q)",
        fontSize: 12,
      }}
      data-testid="result-grid"
    >
      <div
        role="row"
        className={isProd ? "header-prod-tint" : undefined}
        style={{
          position: "sticky",
          top: 0,
          zIndex: 10,
          display: "flex",
          background: isProd ? "rgba(244, 63, 94, 0.06)" : "var(--bg-sunken)",
          borderBottom: "1px solid var(--border-q)",
          height: ROW_HEIGHT,
        }}
      >
        {run.columnOrder.map((srcIdx) => {
          const col = run.columns[srcIdx];
          if (!col) return null;
          const isSorted = run.sort?.columnIdx === srcIdx;
          const sortMark = isSorted ? (run.sort?.dir === "asc" ? " ▲" : " ▼") : "";
          return (
            <div
              key={srcIdx}
              style={{
                position: "relative",
                display: "flex",
                flexShrink: 0,
                borderRight: "1px solid var(--hairline)",
                background: isSorted ? "var(--accent-soft)" : undefined,
                width: colWidth(srcIdx),
              }}
            >
              <button
                role="columnheader"
                type="button"
                data-srcidx={srcIdx}
                onClick={() => onHeaderClick(srcIdx)}
                onMouseDown={(e) => onHeaderMouseDown(srcIdx, e)}
                style={{
                  width: "100%",
                  background: "transparent",
                  border: 0,
                  padding: "0 10px",
                  textAlign: "left",
                  fontFamily: "var(--font-sans-q)",
                  fontSize: 11,
                  fontWeight: 500,
                  color: isSorted ? "var(--accent-strong)" : "var(--ink-3)",
                  letterSpacing: "0.01em",
                  textTransform: "lowercase",
                  cursor: "default",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                onMouseOver={(e) => {
                  if (!isSorted)
                    (e.currentTarget as HTMLElement).style.background = "var(--bg-sunken)";
                }}
                onMouseOut={(e) => {
                  if (!isSorted) (e.currentTarget as HTMLElement).style.background = "transparent";
                }}
                onFocus={(e) => {
                  if (!isSorted)
                    (e.currentTarget as HTMLElement).style.background = "var(--bg-sunken)";
                }}
                onBlur={(e) => {
                  if (!isSorted) (e.currentTarget as HTMLElement).style.background = "transparent";
                }}
              >
                {JSON_TYPES.has(col.typeName) ? ( // — Easy mode hover-explanation for json/jsonb
                  // columns. No-op in Standard mode.
                  <ConceptTooltip id="jsonb" showHelpIcon={false}>
                    <span>{col.name}</span>
                  </ConceptTooltip>
                ) : (
                  col.name
                )}
                {sortMark}
              </button>
              <ResizeHandle
                srcIdx={srcIdx}
                initialWidth={colWidth(srcIdx)}
                onResize={(w) => setColumnWidth(tabId, srcIdx, w)}
              />
              {filtersActive && (
                <button
                  type="button"
                  data-testid={`filter-icon-${srcIdx}`}
                  aria-label={t("filter.column_button_aria", { column: col.name })}
                  className={
                    queryShape?.filters.some((f) => f.column === col.name)
                      ? "filter-icon active"
                      : "filter-icon"
                  }
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpenFilterIdx((cur) => (cur === srcIdx ? null : srcIdx));
                  }}
                  style={{
                    position: "absolute",
                    top: 4,
                    right: 14,
                    background: "transparent",
                    border: 0,
                    padding: "0 4px",
                    cursor: "pointer",
                    fontSize: 11,
                    color: queryShape?.filters.some((f) => f.column === col.name)
                      ? "var(--accent-strong)"
                      : "var(--ink-3)",
                  }}
                  title={t("filter.column_button_title")}
                >
                  ⛀
                </button>
              )}
              {filtersActive && openFilterIdx === srcIdx && (
                <div
                  data-testid={`filter-dropdown-host-${srcIdx}`}
                  style={{
                    position: "absolute",
                    top: ROW_HEIGHT,
                    right: 0,
                    zIndex: 20,
                    background: "var(--bg-1)",
                    border: "1px solid var(--border)",
                    boxShadow: "0 6px 16px rgba(0,0,0,0.15)",
                    padding: 8,
                    minWidth: 220,
                  }}
                >
                  <FilterDropdown
                    current={queryShape?.filters.find((f) => f.column === col.name) ?? null}
                    columnName={col.name}
                    dataType={col.typeName}
                    onApply={(filter) => setFilter(tabId, col.name, filter)}
                    onClose={() => setOpenFilterIdx(null)}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {items.map((vi) => {
          const row = run.rows[vi.index];
          if (!row) return null;
          return (
            <div
              key={vi.key}
              role="row"
              style={{
                position: "absolute",
                left: 0,
                display: "flex",
                borderBottom: "1px solid var(--hairline)",
                transform: `translateY(${vi.start}px)`,
                height: vi.size,
              }}
            >
              {run.columnOrder.map((srcIdx, displayIdx) => {
                const col = run.columns[srcIdx];
                if (!col) return null;
                const isSelected = selected?.row === vi.index && selected?.col === displayIdx;
                return (
                  <div
                    key={srcIdx}
                    role="gridcell"
                    aria-selected={isSelected}
                    data-testid={`cell-${vi.index}-${displayIdx}`}
                    onClick={() => {
                      setSelected({ row: vi.index, col: displayIdx });
                      // bring keyboard focus to the grid container
                      // so Enter / Cmd+C / arrow keys land here instead of
                      // sliding back to whatever held focus before (typically
                      // the Monaco editor, which then ate Enter as a newline).
                      containerRef.current?.focus();
                    }}
                    onContextMenu={(e) => {
                      if (vectorCols.vectorColumns.length === 0) return;
                      e.preventDefault();
                      setKnnMenu({ x: e.clientX, y: e.clientY });
                    }}
                    onDoubleClick={() => {
                      setSelected({ row: vi.index, col: displayIdx });
                      const value = row[srcIdx];
                      if (value === undefined || value === null) return;
                      if (JSON_TYPES.has(col.typeName)) {
                        // — json/jsonb cells open the editable
                        // JSONB editor instead of the read-only ValueModal.
                        void useJsonbEditor
                          .getState()
                          .openEditor({ tabId, rowIdx: vi.index, srcColIdx: srcIdx }, value);
                        return;
                      }
                      setPreview({ value, language: "text" });
                    }}
                    style={{
                      flexShrink: 0,
                      borderRight: "1px solid var(--hairline)",
                      padding: "0 10px",
                      lineHeight: `${ROW_HEIGHT}px`,
                      width: colWidth(srcIdx),
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      background: isSelected ? "var(--accent-soft)" : "transparent",
                      boxShadow: isSelected ? "inset 0 0 0 1.5px var(--accent)" : "none",
                      color: "var(--ink-2)",
                      cursor: "default",
                    }}
                  >
                    <Cell column={col} value={row[srcIdx]} />
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      <ValueModal
        open={preview !== null}
        onClose={() => setPreview(null)}
        value={preview?.value ?? ""}
        language={preview?.language ?? "text"}
      />
      {geometryCols.length > 0 ? (
        <button
          type="button"
          data-testid="result-grid-open-map-view"
          onClick={() =>
            openMapViewTab({
              connectionId: tabConnId,
              rowsSnapshot: run.rows.map((row) => row.map((cell) => cell ?? "")),
              columns: run.columns,
              geometryColumn: geometryCols[0]?.name ?? "",
            })
          }
          style={{
            position: "absolute",
            top: 8,
            right: 12,
            zIndex: 5,
            padding: "4px 10px",
            fontSize: 12,
            border: "1px solid var(--hairline)",
            borderRadius: 4,
            background: "var(--bg, #fff)",
            cursor: "pointer",
          }}
        >
          Open Map View
        </button>
      ) : null}
      {knnMenu && vectorCols.vectorColumns.length > 0 ? (
        <ul
          role="menu"
          data-testid="knn-context-menu"
          style={{
            position: "fixed",
            top: knnMenu.y,
            left: knnMenu.x,
            margin: 0,
            padding: 4,
            listStyle: "none",
            background: "var(--bg, #fff)",
            border: "1px solid var(--hairline)",
            borderRadius: 4,
            boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
            zIndex: 1000,
            fontSize: 12,
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {vectorCols.vectorColumns.map((vc) => (
            <li key={vc.name}>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setKnnMenu(null);
                  setKnnDialog({ vectorColumn: vc.name });
                }}
                style={{
                  background: "transparent",
                  border: "none",
                  padding: "6px 12px",
                  cursor: "pointer",
                  width: "100%",
                  textAlign: "left",
                }}
              >
                Find nearest by {vc.name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {knnDialog && tabConnId !== null ? (
        <KnnBrowseDialog
          open={true}
          connId={tabConnId}
          qualifiedTable={inferredTable}
          vectorColumn={knnDialog.vectorColumn}
          onClose={() => setKnnDialog(null)}
          onSubmit={(req) => {
            setKnnDialog(null);
            setKnnResult(req);
          }}
        />
      ) : null}
      {knnResult && tabConnId !== null ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1100,
            background: "rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          onMouseDown={() => setKnnResult(null)}
        >
          <div
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              background: "var(--bg, #fff)",
              border: "1px solid var(--hairline)",
              borderRadius: 6,
              padding: 0,
              minWidth: 600,
              maxWidth: "90vw",
              maxHeight: "80vh",
              overflow: "auto",
            }}
          >
            <KnnBrowseResultPane
              connId={tabConnId}
              sql={knnResult.sql}
              onClose={() => setKnnResult(null)}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Right-edge drag handle that resizes a single column. */
function ResizeHandle({
  srcIdx,
  initialWidth,
  onResize,
}: {
  srcIdx: number;
  initialWidth: number;
  onResize: (px: number) => void;
}): JSX.Element {
  const startRef = useRef<{ pageX: number; w: number } | null>(null);
  function handleMouseDown(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    startRef.current = { pageX: e.pageX, w: initialWidth };
    function onMove(ev: globalThis.MouseEvent) {
      if (!startRef.current) return;
      const delta = ev.pageX - startRef.current.pageX;
      onResize(startRef.current.w + delta);
    }
    function onUp() {
      startRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }
  return (
    // biome-ignore lint/a11y/useKeyWithMouseEvents: 4px column-resize handle is a pointer-only drag affordance — keyboard column resize is intentionally surfaced via the column header sort/resize action menu (S5+) and would be dead code here.
    <div
      data-testid={`col-resize-${srcIdx}`}
      onMouseDown={handleMouseDown}
      style={{
        position: "absolute",
        right: 0,
        top: 0,
        height: "100%",
        width: 4,
        cursor: "col-resize",
        background: "transparent",
      }}
      onMouseOver={(e) => {
        (e.currentTarget as HTMLElement).style.background = "var(--accent)";
      }}
      onMouseOut={(e) => {
        (e.currentTarget as HTMLElement).style.background = "transparent";
      }}
    />
  );
}
