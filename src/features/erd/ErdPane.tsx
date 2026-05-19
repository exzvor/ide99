/**
 * + 19 — ERD diagram pane.
 *
 * Composes the data-fetch hook (`useErdGraph`), the dagre layout
 * (`./layout.layoutGraph`), the pan / zoom hook (`./usePanZoom`), the
 * toolbar (`./Toolbar`) and the SVG canvas (`./Canvas`).
 *
 * additions:
 * - `useEditStore` provides the per-tab op-log + edit-mode flag. When
 * edit-mode is on, we layout the **WorkingErdGraph** (= base + applyOps)
 * instead of the read-only base, so renames/new-tables/new-columns
 * render immediately on the canvas.
 * - `useErdPositions` persists drag positions per `(connId, schemasKey)`
 * and feeds them as overrides into `layoutGraph`. Reset Layout clears
 * the cache and re-applies dagre.
 * - DDL preview panel mounts at the bottom in edit-mode; Apply opens an
 * ApplyConfirmModal which calls `schemaApplyDdl` (atomic TX).
 * - FK drag → FkPickerModal → `addFk` op.
 *
 * State branches use a `data-state` attribute on the root container
 * (`loading | empty | error | ready`).
 */

import { Loader2 } from "lucide-react";
import { type JSX, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "../../components/Toast";
import { type ApplyError, type ErdSchemaGraph, schemaApplyDdl } from "../../lib/tauri";
import { useConnections } from "../connections/store";
import { Canvas } from "./Canvas";
import { Toolbar } from "./Toolbar";
import { ApplyConfirmModal } from "./edit/ApplyConfirmModal";
import { DdlPreviewPanel } from "./edit/DdlPreviewPanel";
import { EditActionsBar } from "./edit/EditToolbar";
import { FkPickerModal } from "./edit/FkPickerModal";
import { applyOps } from "./edit/applyOps";
import { generateDdl } from "./edit/ddlGen";
import {
  type AnyTableRef,
  type ColumnRef,
  type Op,
  makeAddColumnOp,
  makeAddFkOp,
  makeAddTableOp,
  makeMoveTableOp,
  makeRenameColumnOp,
  makeRenameTableOp,
} from "./edit/ops";
import { useErdPositions } from "./edit/positions";
import { useEditStore } from "./edit/store";
import type { WorkingErdGraph, WorkingTable } from "./edit/types";
import { validateOps } from "./edit/validation";
import { type LaidErd, layoutGraph } from "./layout";
import { useErdAvailableSchemas, useErdGraph, useErdStore } from "./store";
import { usePanZoom } from "./usePanZoom";

const EMPTY_OPS: Op[] = [];

interface ErdPaneProps {
  connId: string;
  schemas: string[] | undefined;
  tabId: string;
}

const PANE_BASE_STYLE = {
  height: "100%",
  width: "100%",
  display: "flex",
  flexDirection: "column" as const,
  minHeight: 0,
  background: "var(--bg)",
};

function schemasFilterKey(schemas: string[] | undefined): string {
  if (schemas === undefined) return "*";
  return [...schemas].sort().join(",");
}

/** Convert WorkingErdGraph → ErdSchemaGraph shape that `layoutGraph` ingests.
 * Uses `working.id` as the synthetic table-name so the layout's `nodeId =
 * `${schema}.${name}`` is unique even when two new tables share a real name
 * (validation flags that as duplicate-table error). Post-layout we restore
 * the real name on each node and remap edge ids back to working-ids. */
function workingToLayoutInput(working: WorkingErdGraph): {
  graph: ErdSchemaGraph;
  layoutIdToWorkingId: Map<string, string>;
} {
  const layoutIdToWorkingId = new Map<string, string>();
  const tables: ErdSchemaGraph["tables"] = working.tables.map((t) => {
    layoutIdToWorkingId.set(`${t.schema}.${t.id}`, t.id);
    return {
      schema: t.schema,
      name: t.id, // synthetic — replaced below post-layout
      columns: t.columns.map((c, i) => ({
        name: c.name,
        dataType: c.dataType,
        nullable: c.nullable,
        isPrimaryKey: c.isPrimaryKey,
        isForeignKey: c.isForeignKey,
        ordinal: i + 1,
      })),
    };
  });
  const foreignKeys: ErdSchemaGraph["foreignKeys"] = [];
  for (const fk of working.fks) {
    const srcT = working.tables.find((t) => t.id === fk.source.tableId);
    const tgtT = working.tables.find((t) => t.id === fk.target.tableId);
    if (!srcT || !tgtT) continue;
    foreignKeys.push({
      name: fk.name,
      sourceSchema: srcT.schema,
      sourceTable: srcT.id, // synthetic
      sourceColumns: fk.source.columnIds.map(        (cid) => srcT.columns.find((c) => c.id === cid)?.name ?? cid,
),
      targetSchema: tgtT.schema,
      targetTable: tgtT.id, // synthetic
      targetColumns: fk.target.columnIds.map(        (cid) => tgtT.columns.find((c) => c.id === cid)?.name ?? cid,
),
    });
  }
  return {
    graph: { tables, foreignKeys, fetchedInMs: 0 },
    layoutIdToWorkingId,
  };
}

/** Map a working-graph table back to an `AnyTableRef` for op construction.
 * Existing tables ref by their ORIGINAL schema/name (pre-rename) so subsequent
 * ops compose cleanly. New tables ref by `_new: addOpId`. */
function tableRefForWorking(t: WorkingTable): AnyTableRef {
  if (t.addOpId) return { _new: t.addOpId };
  return { schema: t.schema, name: t.originalName ?? t.name };
}

interface FkPickerOpenState {
  source: WorkingTable;
  target: WorkingTable;
}

export function ErdPane({ connId, schemas, tabId }: ErdPaneProps): JSX.Element {
  const { t } = useTranslation();
  const toast = useToast();
  const { state, retry } = useErdGraph(connId, schemas);
  const availableSchemas = useErdAvailableSchemas(connId);
  const panZoom = usePanZoom();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);

  // edit-mode wiring. Empty-array sentinel keeps memo deps stable
  // when no tab-state exists yet (otherwise every render returns a fresh
  // `[]` reference and downstream `useMemo` consumers thrash, blowing up
  // the auto-fit effect into an infinite loop).
  const mode = useEditStore((s) => s.tabs.get(tabId)?.mode ?? "read");
  const ops = useEditStore((s) => s.tabs.get(tabId)?.ops ?? EMPTY_OPS);
  const isDirty = useEditStore((s) => (s.tabs.get(tabId)?.ops.length ?? 0) > 0);
  const pushOp = useEditStore((s) => s.pushOp);
  const discard = useEditStore((s) => s.discard);
  // S20 + �� Apply must be blocked while a SQL parse error is
  // active and must use the user's verbatim text when the latest change came
  // from typing in the DDL panel (so unrepresentable statements / ordered
  // scripts survive).
  const astParseError = useEditStore((s) => s.tabs.get(tabId)?.astParseError ?? null);
  const lastChangeBy = useEditStore((s) => s.tabs.get(tabId)?.lastChangeBy ?? null);
  const lastReverseText = useEditStore((s) => s.tabs.get(tabId)?.lastReverseText ?? null);

  const filterKey = schemasFilterKey(schemas);
  const positionsApi = useErdPositions(connId, filterKey);
  const connections = useConnections((s) => s.connections);
  const connectionName = connections.find((c) => c.id === connId)?.name ?? connId;

  const [applyConfirmOpen, setApplyConfirmOpen] = useState(false);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [applyError, setApplyError] = useState<ApplyError | null>(null);
  const [fkPicker, setFkPicker] = useState<FkPickerOpenState | null>(null);
  const fkDragSourceRef = useRef<string | null>(null);

  // Compute working graph (memoized on graph + ops identity).
  const baseGraph: ErdSchemaGraph =
    state.kind === "ready" ? state.graph : { tables: [], foreignKeys: [], fetchedInMs: 0 };
  const working = useMemo<WorkingErdGraph>(    () => applyOps(baseGraph, ops as Op[]),
    [baseGraph, ops],
);
  const ddl = useMemo(() => generateDdl(baseGraph, ops as Op[]), [baseGraph, ops]);
  const issues = useMemo(() => validateOps(baseGraph, ops as Op[]), [baseGraph, ops]);
  // S20 a SQL parse error must block Apply (same kind of gate as a
  // hard validation error).
  const hasErrors = issues.some((i) => i.severity === "error") || astParseError !== null;

  // Build the layout input. In read mode the working graph identity-maps
  // to base. In edit mode synthetic ids prevent name collisions while
  // tables are being constructed.
  const { layoutInput, layoutIdToWorkingId } = useMemo(() => {
    const out = workingToLayoutInput(working);
    return { layoutInput: out.graph, layoutIdToWorkingId: out.layoutIdToWorkingId };
  }, [working]);

  // Translate positions cache (keyed by working-id) into layout-id map for
  // `layoutGraph({ overrides })`.
  const layoutOverrides = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    for (const t of working.tables) {
      const layoutId = `${t.schema}.${t.id}`;
      const pos = positionsApi.positions.get(t.id);
      if (pos) m.set(layoutId, pos);
    }
    return m;
  }, [working.tables, positionsApi.positions]);

  const laid: LaidErd | null = useMemo(() => {
    if (state.kind !== "ready") return null;
    const raw = layoutGraph(layoutInput, { overrides: layoutOverrides });
    // Post-layout: replace synthetic node ids/names with working ids/names,
    // and stash WorkingColumn.id on each laid column so inline-edit handlers
    // (fix) can route renames through the op-log even after the
    // user has changed the displayed name.
    const nodes = raw.nodes.map((n, i) => {
      const t = working.tables[i];
      return {
        ...n,
        id: t.id,
        name: t.name,
        columns: n.columns.map((c, ci) => ({
          ...c,
          id: t.columns[ci]?.id ?? c.name,
        })),
      };
    });
    const edges = raw.edges.map((e) => {
      const fromWid = layoutIdToWorkingId.get(e.fromNodeId) ?? e.fromNodeId;
      const toWid = layoutIdToWorkingId.get(e.toNodeId) ?? e.toNodeId;
      return { ...e, fromNodeId: fromWid, toNodeId: toWid };
    });
    return { ...raw, nodes, edges };
  }, [state, layoutInput, layoutOverrides, working.tables, layoutIdToWorkingId]);

  const getSvgEl = useCallback((): SVGSVGElement | null => {
    return (      (containerRef.current?.querySelector('[data-testid="erd-canvas"]') as SVGSVGElement | null) ??
      null
);
  }, []);

  /**
   * Compute the live viewport dims that the canvas SVG actually occupies.
   * Returns `null` when the SVG is still 0×0 (between mount and first
   * paint), which is the signal for the auto-fit driver to retry on the
   * next frame instead of bailing out silently (fix — large
   * "All schemas" graphs were getting fit against a near-zero viewport
   * height and ended up clamped to MIN_ZOOM at the bottom edge).
   */
  const measureViewport = useCallback((): { width: number; height: number } | null => {
    const svg = getSvgEl();
    const svgRect = svg?.getBoundingClientRect();
    if (svgRect && svgRect.width > 4 && svgRect.height > 4) {
      return { width: svgRect.width, height: svgRect.height };
    }
    return null;
  }, [getSvgEl]);

  const fitNow = useCallback(    (currentLaid: LaidErd) => {
      const viewport = measureViewport();
      if (!viewport) return false;
      panZoom.fitToScreen({ width: currentLaid.width, height: currentLaid.height }, viewport);
      return true;
    },
    [measureViewport, panZoom],
);

  const onFit = useCallback((): void => {
    if (!laid) return;
    fitNow(laid);
  }, [laid, fitNow]);

  // Auto-fit on first ready-render or schema-filter change. Retry on
  // subsequent frames + via ResizeObserver until the SVG reports a real
  // size — `requestAnimationFrame` alone is not enough on large graphs
  // because the canvas's flex parent often hasn't been measured yet on
  // the first ready paint ().
  const lastFitKey = useRef<string | null>(null);
  useEffect(() => {
    if (!laid) {
      lastFitKey.current = null;
      return;
    }
    const key = `${laid.width}x${laid.height}x${laid.nodes.length}`;
    if (lastFitKey.current === key) return;

    let cancelled = false;
    let rafHandle = 0;
    let resizeObserver: ResizeObserver | null = null;
    let attempts = 0;
    const MAX_ATTEMPTS = 30; // ~0.5s at 60fps

    const tryFit = () => {
      if (cancelled) return;
      attempts += 1;
      if (fitNow(laid)) {
        lastFitKey.current = key;
        return;
      }
      if (attempts < MAX_ATTEMPTS) {
        rafHandle = requestAnimationFrame(tryFit);
      }
    };
    rafHandle = requestAnimationFrame(tryFit);

    // Belt-and-braces: when the SVG resizes (e.g. window resize, parent
    // pane finally getting a real height), re-attempt the fit until we
    // succeed for this `key`.
    const svg = getSvgEl();
    if (svg && typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        if (cancelled || lastFitKey.current === key) return;
        if (fitNow(laid)) lastFitKey.current = key;
      });
      resizeObserver.observe(svg);
    }

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafHandle);
      resizeObserver?.disconnect();
    };
  }, [laid, fitNow, getSvgEl]);

  // ─── Edit-mode handlers ───────────────────────────────────────────────────

  const onAddTable = useCallback(() => {
    const defaultSchema = working.tables[0]?.schema ?? "public";
    const newCount = working.tables.filter((t) => t.addOpId).length;
    pushOp(tabId, makeAddTableOp(defaultSchema, `new_table_${newCount + 1}`));
  }, [working.tables, pushOp, tabId]);

  const onApply = useCallback(() => {
    if (!isDirty || hasErrors) return;
    setApplyError(null);
    setApplyConfirmOpen(true);
  }, [isDirty, hasErrors]);

  const onConfirmApply = useCallback(async () => {
    setApplyConfirmOpen(false);
    // S20 + fix: when the user typed the script in the DDL
    // panel, send their verbatim text so unrepresentable statements
    // (`CREATE INDEX`, etc.) survive AND statement order is preserved exactly
    // as authored. Fall back to the regenerated DDL when the latest change
    // came from a visual canvas op.
    const sqlToApply =
      lastChangeBy === "text" && lastReverseText !== null ? lastReverseText : ddl.sql;
    try {
      const result = await schemaApplyDdl(connId, sqlToApply);
      // Success: clear ops, refresh base graph, toast.
      discard(tabId);
      useErdStore.getState().invalidate(connId);
      toast.success(        t("erd.edit.toast.apply_success", {
          n: result.statementsExecuted,
          ms: result.durationMs,
        }),
);
    } catch (raw) {
      // Coerced ApplyError from schemaApplyDdl wrapper.
      const e = raw as ApplyError;
      setApplyError(e);
      toast.error(`${e.pgErrorCode}: ${e.pgMessage}`);
    }
  }, [connId, ddl.sql, discard, tabId, toast, t, lastChangeBy, lastReverseText]);

  const onDiscardClick = useCallback(() => {
    if (!isDirty) return;
    setDiscardConfirmOpen(true);
  }, [isDirty]);

  const onConfirmDiscard = useCallback(() => {
    discard(tabId);
    setApplyError(null);
    setDiscardConfirmOpen(false);
  }, [discard, tabId]);

  // fix: Reset Layout opens a confirm modal first; the reset
  // itself only fires after the user confirms.
  const onResetLayoutClick = useCallback(() => {
    setResetConfirmOpen(true);
  }, []);
  const onConfirmResetLayout = useCallback(() => {
    void positionsApi.reset();
    setResetConfirmOpen(false);
  }, [positionsApi]);

  // Canvas drag-table handlers — update positions cache live (so the canvas
  // re-renders the table at the cursor) and on drop also push a moveTable
  // op when in edit-mode (so undo restores prior position).
  const onTableDragMove = useCallback(    (nodeId: string, x: number, y: number) => {
      positionsApi.setPosition(nodeId, x, y);
    },
    [positionsApi],
);
  const onTableDragEnd = useCallback(    (nodeId: string, x: number, y: number) => {
      positionsApi.setPosition(nodeId, x, y);
      if (mode === "edit") {
        const t = working.tables.find((wt) => wt.id === nodeId);
        if (t) pushOp(tabId, makeMoveTableOp(tableRefForWorking(t), x, y));
      }
    },
    [positionsApi, mode, working.tables, pushOp, tabId],
);

  // FK drag — open picker on drop.
  const onFkDragStart = useCallback((sourceId: string) => {
    fkDragSourceRef.current = sourceId;
  }, []);
  const onFkDragEnd = useCallback(    (targetId: string | null) => {
      const source = fkDragSourceRef.current;
      fkDragSourceRef.current = null;
      if (!source || !targetId || source === targetId) return;
      const srcT = working.tables.find((t) => t.id === source);
      const tgtT = working.tables.find((t) => t.id === targetId);
      if (!srcT || !tgtT) return;
      setFkPicker({ source: srcT, target: tgtT });
    },
    [working.tables],
);

  const onFkPickerConfirm = useCallback(    (sourceColIds: string[], targetColIds: string[], constraintName: string) => {
      if (!fkPicker) return;
      const srcRefs: ColumnRef[] = sourceColIds.map((cid) => {
        const c = fkPicker.source.columns.find((cc) => cc.id === cid)!;
        if (c.addOpId) return { table: tableRefForWorking(fkPicker.source), _newCol: c.addOpId };
        return {
          table: {
            schema: fkPicker.source.schema,
            name: fkPicker.source.originalName ?? fkPicker.source.name,
          },
          column: c.originalName ?? c.name,
        };
      });
      const tgtRefs: ColumnRef[] = targetColIds.map((cid) => {
        const c = fkPicker.target.columns.find((cc) => cc.id === cid)!;
        if (c.addOpId) return { table: tableRefForWorking(fkPicker.target), _newCol: c.addOpId };
        return {
          table: {
            schema: fkPicker.target.schema,
            name: fkPicker.target.originalName ?? fkPicker.target.name,
          },
          column: c.originalName ?? c.name,
        };
      });
      pushOp(tabId, makeAddFkOp(srcRefs, tgtRefs, constraintName));
      setFkPicker(null);
    },
    [fkPicker, pushOp, tabId],
);

  // Inline edit handlers — TableCard-side click → renameTable / addColumn.
  const onRenameTable = useCallback(    (nodeId: string, newName: string) => {
      const t = working.tables.find((wt) => wt.id === nodeId);
      if (!t) return;
      pushOp(tabId, makeRenameTableOp(tableRefForWorking(t), newName));
    },
    [working.tables, pushOp, tabId],
);
  const onRenameColumn = useCallback(    (nodeId: string, columnId: string, newName: string) => {
      const t = working.tables.find((wt) => wt.id === nodeId);
      if (!t) return;
      const col = t.columns.find((c) => c.id === columnId);
      if (!col) return;
      const ref: ColumnRef = col.addOpId
        ? { table: tableRefForWorking(t), _newCol: col.addOpId }
        : {
            table: { schema: t.schema, name: t.originalName ?? t.name },
            column: col.originalName ?? col.name,
          };
      pushOp(tabId, makeRenameColumnOp(ref, newName));
    },
    [working.tables, pushOp, tabId],
);
  const onAddColumn = useCallback(    (nodeId: string) => {
      const t = working.tables.find((wt) => wt.id === nodeId);
      if (!t) return;
      const idx = t.columns.length + 1;
      pushOp(tabId, makeAddColumnOp(tableRefForWorking(t), `col_${idx}`, "TEXT", true, false));
    },
    [working.tables, pushOp, tabId],
);

  // (a11y, acceptance #3) — keyboard pan/zoom for the ERD canvas.
  // Arrow keys pan in 32 px steps (×4 with Shift); `=` / `+` zoom in; `-`
  // zooms out; `0` resets. We swallow only the keys we handle so Tab still
  // moves focus between table cards (per `09-accessibility.md` §2 ERD).
  const onCanvasKeyDown = useCallback(    (e: React.KeyboardEvent<SVGSVGElement>) => {
      const PAN_STEP = 32;
      const step = e.shiftKey ? PAN_STEP * 4 : PAN_STEP;
      switch (e.key) {
        case "ArrowUp":
          e.preventDefault();
          panZoom.panBy?.(0, step);
          break;
        case "ArrowDown":
          e.preventDefault();
          panZoom.panBy?.(0, -step);
          break;
        case "ArrowLeft":
          e.preventDefault();
          panZoom.panBy?.(step, 0);
          break;
        case "ArrowRight":
          e.preventDefault();
          panZoom.panBy?.(-step, 0);
          break;
        case "+":
        case "=":
          e.preventDefault();
          panZoom.zoomIn();
          break;
        case "-":
        case "_":
          e.preventDefault();
          panZoom.zoomOut();
          break;
        case "0":
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            onFit();
          } else {
            e.preventDefault();
            panZoom.reset();
          }
          break;
        default:
          break;
      }
    },
    [panZoom, onFit],
);

  // ─── Loading ───────────────────────────────────────────────────────────────
  if (state.kind === "loading" || state.kind === "idle") {
    return (      <div
        ref={containerRef}
        data-testid="erd-pane"
        data-state="loading"
        data-conn-id={connId}
        data-schemas={schemas?.join(",") ?? ""}
        data-tab-id={tabId}
        style={{
          ...PANE_BASE_STYLE,
          alignItems: "center",
          justifyContent: "center",
          color: "var(--ink-3)",
          fontSize: 12,
          gap: 8,
        }}
      >
        <Loader2 size={16} className="animate-spin" aria-hidden="true" />
        <span>{t("erd.loading")}</span>
      </div>
);
  }

  // ─── Error ─────────────────────────────────────────────────────────────────
  if (state.kind === "error") {
    return (      <div
        ref={containerRef}
        data-testid="erd-pane"
        data-state="error"
        data-conn-id={connId}
        data-schemas={schemas?.join(",") ?? ""}
        data-tab-id={tabId}
        style={{
          ...PANE_BASE_STYLE,
          alignItems: "center",
          justifyContent: "center",
          color: "var(--ink-2)",
          fontSize: 12,
          gap: 12,
        }}
      >
        <div style={{ fontWeight: 500 }}>{t("erd.error.title")}</div>
        <div style={{ color: "var(--ink-4)", fontSize: 11, maxWidth: 480, textAlign: "center" }}>
          {state.message}
        </div>
        <button
          type="button"
          className="btn-icon"
          onClick={retry}
          data-testid="erd-retry"
          style={{ height: 26, padding: "0 12px", fontSize: 11 }}
        >
          {t("erd.error.retry")}
        </button>
      </div>
);
  }

  // ─── Empty ─────────────────────────────────────────────────────────────────
  if (state.kind === "ready" && state.graph.tables.length === 0 && working.tables.length === 0) {
    return (      <div
        ref={containerRef}
        data-testid="erd-pane"
        data-state="empty"
        data-conn-id={connId}
        data-schemas={schemas?.join(",") ?? ""}
        data-tab-id={tabId}
        style={{
          ...PANE_BASE_STYLE,
          alignItems: "center",
          justifyContent: "center",
          color: "var(--ink-3)",
          fontSize: 12,
          gap: 6,
          textAlign: "center",
          padding: 24,
        }}
      >
        <div style={{ fontSize: 13, color: "var(--ink-2)", fontWeight: 500 }}>
          {t("erd.empty.title")}
        </div>
        <div style={{ color: "var(--ink-4)", fontSize: 11, maxWidth: 360 }}>
          {t("erd.empty.body")}
        </div>
      </div>
);
  }

  // ─── Ready ─────────────────────────────────────────────────────────────────
  if (laid && state.kind === "ready") {
    return (      <div
        ref={containerRef}
        data-testid="erd-pane"
        data-state="ready"
        data-conn-id={connId}
        data-schemas={schemas?.join(",") ?? ""}
        data-tab-id={tabId}
        style={PANE_BASE_STYLE}
      >
        <Toolbar
          tabId={tabId}
          graph={state.graph}
          availableSchemas={availableSchemas}
          layoutMs={laid.layoutMs}
          selectedSchemas={schemas}
          onZoomIn={() => panZoom.zoomIn()}
          onZoomOut={() => panZoom.zoomOut()}
          onZoomReset={panZoom.reset}
          onFit={onFit}
          getSvgEl={getSvgEl}
        />
        {mode === "edit" && (          <EditActionsBar
            tabId={tabId}
            onApply={onApply}
            onDiscard={onDiscardClick}
            onResetLayout={onResetLayoutClick}
            onAddTable={onAddTable}
            canResetLayout={positionsApi.positions.size > 0}
            canApply={!hasErrors}
          />
)}
        <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
          <Canvas
            laid={laid}
            highlight={{ nodeId: focusedNodeId, edgeId: null }}
            onNodeFocus={setFocusedNodeId}
            panX={panZoom.panX}
            panY={panZoom.panY}
            zoom={panZoom.zoom}
            panning={panZoom.isDragging}
            onWheel={panZoom.onWheel}
            onMouseDown={panZoom.onMouseDown}
            onMouseMove={panZoom.onMouseMove}
            onMouseUp={panZoom.onMouseUp}
            onKeyDown={onCanvasKeyDown}
            mode={mode}
            onTableDragMove={onTableDragMove}
            onTableDragEnd={onTableDragEnd}
            onFkDragStart={onFkDragStart}
            onFkDragEnd={onFkDragEnd}
            onRenameTable={onRenameTable}
            onRenameColumn={onRenameColumn}
            onAddColumn={onAddColumn}
          />
        </div>
        {mode === "edit" && (          <DdlPreviewPanel
            ddl={ddl}
            issues={issues}
            applyError={applyError}
            tabId={tabId}
            baseGraph={baseGraph}
          />
)}
        <ApplyConfirmModal
          open={applyConfirmOpen}
          statementCount={ddl.statements.length}
          connectionName={connectionName}
          onConfirm={onConfirmApply}
          onCancel={() => setApplyConfirmOpen(false)}
        />
        {fkPicker && (          <FkPickerModal
            open
            sourceTable={{
              id: fkPicker.source.id,
              name: fkPicker.source.name,
              columns: fkPicker.source.columns.map((c) => ({
                id: c.id,
                name: c.name,
                dataType: c.dataType,
                isPkOrUnique: c.isPrimaryKey,
              })),
            }}
            targetTable={{
              id: fkPicker.target.id,
              name: fkPicker.target.name,
              columns: fkPicker.target.columns.map((c) => ({
                id: c.id,
                name: c.name,
                dataType: c.dataType,
                isPkOrUnique: c.isPrimaryKey,
              })),
            }}
            onConfirm={onFkPickerConfirm}
            onCancel={() => setFkPicker(null)}
          />
)}
        {discardConfirmOpen && (          <div
            data-testid="discard-confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="discard-confirm-title"
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.5)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 1000,
            }}
          >
            <div
              style={{
                background: "var(--bg)",
                padding: 20,
                borderRadius: 6,
                minWidth: 380,
                maxWidth: 520,
              }}
            >
              <h2 id="discard-confirm-title" style={{ margin: 0, marginBottom: 8 }}>
                {t("erd.edit.confirm.discard.title")}
              </h2>
              <p style={{ marginBottom: 16, color: "var(--ink-3)" }}>
                {t("erd.edit.confirm.discard.body", { n: ops.length })}
              </p>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 12,
                  justifyContent: "flex-end",
                }}
              >
                <button
                  type="button"
                  data-testid="discard-confirm-cancel"
                  className="btn-icon"
                  onClick={() => setDiscardConfirmOpen(false)}
                  style={{ minWidth: 96, padding: "0 14px", height: 30 }}
                >
                  {t("erd.edit.cancel")}
                </button>
                <button
                  type="button"
                  data-testid="discard-confirm-ok"
                  className="btn-icon"
                  style={{
                    minWidth: 96,
                    padding: "0 14px",
                    height: 30,
                    background: "var(--accent, #4a90e2)",
                    color: "#fff",
                  }}
                  onClick={onConfirmDiscard}
                >
                  {t("erd.edit.discard")}
                </button>
              </div>
            </div>
          </div>
)}
        {resetConfirmOpen && (          <div
            data-testid="reset-confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-confirm-title"
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.5)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 1000,
            }}
          >
            <div
              style={{
                background: "var(--bg)",
                padding: 20,
                borderRadius: 6,
                minWidth: 380,
                maxWidth: 520,
              }}
            >
              <h2 id="reset-confirm-title" style={{ margin: 0, marginBottom: 16 }}>
                {t("erd.edit.confirm.reset_layout")}
              </h2>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 12,
                  justifyContent: "flex-end",
                }}
              >
                <button
                  type="button"
                  data-testid="reset-confirm-cancel"
                  className="btn-icon"
                  onClick={() => setResetConfirmOpen(false)}
                  style={{ minWidth: 96, padding: "0 14px", height: 30 }}
                >
                  {t("erd.edit.cancel")}
                </button>
                <button
                  type="button"
                  data-testid="reset-confirm-ok"
                  className="btn-icon"
                  style={{
                    minWidth: 96,
                    padding: "0 14px",
                    height: 30,
                    background: "var(--accent, #4a90e2)",
                    color: "#fff",
                  }}
                  onClick={onConfirmResetLayout}
                >
                  {t("erd.edit.reset_layout")}
                </button>
              </div>
            </div>
          </div>
)}
      </div>
);
  }

  return (    <div
      ref={containerRef}
      data-testid="erd-pane"
      data-state="loading"
      data-conn-id={connId}
      data-schemas={schemas?.join(",") ?? ""}
      data-tab-id={tabId}
      style={PANE_BASE_STYLE}
    />
);
}
