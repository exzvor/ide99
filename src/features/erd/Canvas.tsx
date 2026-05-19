import { type JSX, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FkEdge } from "./FkEdge";
import { TableCard } from "./TableCard";
import type { LaidErd, LaidErdNode } from "./layout";

interface CanvasProps {
  laid: LaidErd;
  highlight: { nodeId: string | null; edgeId: string | null };
  onNodeFocus(nodeId: string): void;
  panX: number;
  panY: number;
  zoom: number;
  /** Forwarded to wheel/mouse handlers from 's usePanZoom. */
  onWheel?(e: React.WheelEvent<SVGSVGElement>): void;
  onMouseDown?(e: React.MouseEvent<SVGSVGElement>): void;
  onMouseMove?(e: React.MouseEvent<SVGSVGElement>): void;
  onMouseUp?(e: React.MouseEvent<SVGSVGElement>): void;
  /**
   * — keyboard pan/zoom. Arrow keys pan ±32 px (or ×4 with Shift),
   * `=` / `+` and `-` / `_` (plus Cmd+= / Cmd+−) zoom around the canvas
   * centre, and `0` resets. Wired on the SVG itself so the focused-table-card
   * captures Tab navigation while spacing/zoom hotkeys still work as long as
   * the SVG (or any descendant) holds focus. */
  onKeyDown?(e: React.KeyboardEvent<SVGSVGElement>): void;
  /** When true, the cursor flips to "grabbing" (parent tracks drag state). */
  panning?: boolean;
  /** — `read` keeps the canvas as a static rendering surface;
   * `edit` wires drag-positioning + FK-drag affordances. */
  mode?: "read" | "edit";
  onTableDragMove?(tableId: string, x: number, y: number): void;
  onTableDragEnd?(tableId: string, x: number, y: number): void;
  onFkDragStart?(sourceTableId: string): void;
  onFkDragOver?(targetTableId: string | null): void;
  onFkDragEnd?(targetTableId: string | null): void;
  /** — inline edit pass-throughs forwarded to TableCard. */
  onRenameTable?(nodeId: string, newName: string): void;
  onRenameColumn?(nodeId: string, columnId: string, newName: string): void;
  onRetypeColumn?(nodeId: string, columnId: string, type: string, nullable: boolean): void;
  onAddColumn?(nodeId: string): void;
}

interface TableDragState {
  tableId: string;
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
}

interface FkDragState {
  sourceId: string;
  cursorX: number;
  cursorY: number;
  hovered: string | null;
}

/**
 * — top-level ERD SVG canvas.
 *
 * No `viewBox`: with `width="100%" height="100%"` and no viewBox, 1 SVG
 * unit equals 1 CSS pixel, which keeps the pan/zoom math (event-coordinate
 * → translate/scale) in a single coordinate space. An earlier draft used
 * a viewBox sized to the laid graph, which made `e.clientX - rect.left`
 * (CSS px) and `translate(panX panY)` (SVG units, scaled) drift relative
 * to each other and was the root cause of "graph offscreen / fit
 * inconsistent" QA findings.
 *
 * Pan/zoom state is owned by the parent (ErdPane via `usePanZoom`) so the
 * canvas stays a pure rendering surface.
 *
 * — opt-in edit mode. When `mode="edit"`, header mousedown on a
 * `TableCard` starts a table-drag that walks `onTableDragMove`/`End`; the
 * 🔗 FK link-handle starts a FK-drag that renders a dashed line from the
 * source center to the cursor and walks `onFkDragStart`/`Over`/`End`.
 */
export function Canvas({
  laid,
  highlight,
  onNodeFocus,
  panX,
  panY,
  zoom,
  onWheel,
  onMouseDown,
  onMouseMove,
  onMouseUp,
  onKeyDown,
  panning,
  mode = "read",
  onTableDragMove,
  onTableDragEnd,
  onFkDragStart,
  onFkDragOver,
  onFkDragEnd,
  onRenameTable,
  onRenameColumn,
  onRetypeColumn,
  onAddColumn,
}: CanvasProps): JSX.Element {
  const { t } = useTranslation();
  const editable = mode === "edit";
  const tableDragRef = useRef<TableDragState | null>(null);
  const [fkDrag, setFkDrag] = useState<FkDragState | null>(null);

  const findEnclosingCardId = (target: EventTarget | null): string | null => {
    if (!(target instanceof Element)) return null;
    const card = target.closest("[data-table-id]");
    return card?.getAttribute("data-table-id") ?? null;
  };

  const handleSvgMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (editable) {
      // Begin table drag if mousedown is inside a card and not on an
      // interactive control inside it (FK handle, +column, inputs).
      const target = e.target as Element | null;
      if (
        target &&
        !target.closest("[data-testid='table-card-fk-handle']") &&
        !target.closest("[data-testid='table-card-add-column']") &&
        !target.closest("input")
      ) {
        const tableId = findEnclosingCardId(e.target);
        if (tableId) {
          const node = laid.nodes.find((n) => n.id === tableId);
          if (node) {
            tableDragRef.current = {
              tableId,
              startClientX: e.clientX,
              startClientY: e.clientY,
              startX: node.x,
              startY: node.y,
              lastX: node.x,
              lastY: node.y,
            };
          }
        }
      }
    }
    onMouseDown?.(e);
  };

  const handleSvgMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (editable) {
      const drag = tableDragRef.current;
      if (drag) {
        const dx = (e.clientX - drag.startClientX) / (zoom || 1);
        const dy = (e.clientY - drag.startClientY) / (zoom || 1);
        const nx = drag.startX + dx;
        const ny = drag.startY + dy;
        drag.lastX = nx;
        drag.lastY = ny;
        onTableDragMove?.(drag.tableId, nx, ny);
      }
      if (fkDrag) {
        const svg = e.currentTarget;
        const rect = svg.getBoundingClientRect();
        const cx = (e.clientX - rect.left - panX) / (zoom || 1);
        const cy = (e.clientY - rect.top - panY) / (zoom || 1);
        const overId = findEnclosingCardId(e.target);
        if (overId !== fkDrag.hovered) {
          onFkDragOver?.(overId);
        }
        setFkDrag({ ...fkDrag, cursorX: cx, cursorY: cy, hovered: overId });
      }
    }
    onMouseMove?.(e);
  };

  const handleSvgMouseUp = (e: React.MouseEvent<SVGSVGElement>) => {
    if (editable) {
      const drag = tableDragRef.current;
      if (drag) {
        onTableDragEnd?.(drag.tableId, drag.lastX, drag.lastY);
        tableDragRef.current = null;
      }
      if (fkDrag) {
        onFkDragEnd?.(fkDrag.hovered);
        setFkDrag(null);
      }
    }
    onMouseUp?.(e);
  };

  const handleStartFkDrag = (node: LaidErdNode) => {
    onFkDragStart?.(node.id);
    setFkDrag({
      sourceId: node.id,
      cursorX: node.x + node.width / 2,
      cursorY: node.y + node.height / 2,
      hovered: null,
    });
  };

  const fkSourceNode = fkDrag ? laid.nodes.find((n) => n.id === fkDrag.sourceId) : null;

  return (
    <svg
      data-testid="erd-canvas"
      width="100%"
      height="100%"
      role="img"
      aria-label={t("erd.canvas.aria_label")}
      tabIndex={-1}
      onWheel={onWheel}
      onMouseDown={handleSvgMouseDown}
      onMouseMove={handleSvgMouseMove}
      onMouseUp={handleSvgMouseUp}
      onMouseLeave={handleSvgMouseUp}
      onKeyDown={onKeyDown}
      style={{
        display: "block",
        background: "var(--bg)",
        cursor: panning ? "grabbing" : fkDrag ? "crosshair" : "grab",
        userSelect: "none",
      }}
    >
      <defs>
        <marker
          id="erd-arrow"
          viewBox="0 0 6 6"
          refX={6}
          refY={3}
          markerWidth={6}
          markerHeight={6}
          orient="auto-start-reverse"
        >
          <path d="M0,0 L6,3 L0,6 z" fill="var(--ink-4)" />
        </marker>
      </defs>
      <g data-testid="erd-canvas-inner" transform={`translate(${panX} ${panY}) scale(${zoom})`}>
        {laid.edges.map((edge) => (
          <FkEdge key={edge.id} edge={edge} highlighted={highlight.edgeId === edge.id} />
        ))}
        {laid.nodes.map((node) => (
          <TableCard
            key={node.id}
            node={node}
            highlighted={highlight.nodeId === node.id}
            onFocus={() => onNodeFocus(node.id)}
            editable={editable}
            isDropTarget={
              editable && !!fkDrag && fkDrag.hovered === node.id && fkDrag.sourceId !== node.id
            }
            isFkDragSource={editable && !!fkDrag && fkDrag.sourceId === node.id}
            onStartFkDrag={editable ? () => handleStartFkDrag(node) : undefined}
            onRenameTable={
              editable && onRenameTable ? (next) => onRenameTable(node.id, next) : undefined
            }
            onRenameColumn={
              editable && onRenameColumn
                ? (colId, next) => onRenameColumn(node.id, colId, next)
                : undefined
            }
            onRetypeColumn={
              editable && onRetypeColumn
                ? (colId, type, nullable) => onRetypeColumn(node.id, colId, type, nullable)
                : undefined
            }
            onAddColumn={editable && onAddColumn ? () => onAddColumn(node.id) : undefined}
          />
        ))}
        {fkDrag && fkSourceNode && (
          <line
            data-testid="erd-fk-drag-line"
            x1={fkSourceNode.x + fkSourceNode.width / 2}
            y1={fkSourceNode.y + fkSourceNode.height / 2}
            x2={fkDrag.cursorX}
            y2={fkDrag.cursorY}
            stroke="var(--accent)"
            strokeWidth={1.5}
            strokeDasharray="4 3"
            pointerEvents="none"
          />
        )}
      </g>
    </svg>
  );
}
