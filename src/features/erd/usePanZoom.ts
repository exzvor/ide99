/**
 * — pan / zoom state machine for the ERD canvas (, task C2).
 *
 * Returns event handlers consumable by `<Canvas onWheel onMouseDown … />`
 * plus imperative actions (`fitToScreen`, `zoomIn`, `zoomOut`, `reset`).
 *
 * Math:
 * - Zoom transform applies as `screen = graph * zoom + pan`. Inverting,
 * `graph = (screen - pan) / zoom`.
 * - Wheel: zoom around the cursor — pre-compute the graph-coord under
 * the cursor, scale, then back-solve for new pan that keeps that
 * graph-coord under the same screen point.
 * - Drag: while a primary-button drag is active, accumulate
 * `movementX/movementY` directly into pan (1:1 in screen space).
 *
 * Bounds are MIN_ZOOM = 0.05, MAX_ZOOM = 4. The lower bound is intentionally
 * permissive so 50+-table graphs always fit in the viewport.
 */

import { useCallback, useRef, useState } from "react";

export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 4;
const WHEEL_FACTOR = 1.1;
const BUTTON_FACTOR = 1.2;
const FIT_PADDING = 0.92;

export interface PanZoomState {
  panX: number;
  panY: number;
  zoom: number;
  /** True between mouse-down and mouse-up while a pan-drag is in progress. */
  isDragging: boolean;
  onWheel(e: React.WheelEvent<SVGSVGElement>): void;
  onMouseDown(e: React.MouseEvent<SVGSVGElement>): void;
  onMouseMove(e: React.MouseEvent<SVGSVGElement>): void;
  onMouseUp(e: React.MouseEvent<SVGSVGElement>): void;
  fitToScreen(
    box: { width: number; height: number },
    viewport: { width: number; height: number },
  ): void;
  zoomIn(viewportCenter?: { x: number; y: number }): void;
  zoomOut(viewportCenter?: { x: number; y: number }): void;
  reset(): void;
  /**
   * — keyboard pan delta. Adds `dx` / `dy` (screen-space pixels)
   * to the current pan. Used by ErdPane's keydown handler so arrow keys
   * move the canvas without going through a synthetic wheel event. */
  panBy(dx: number, dy: number): void;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

export function usePanZoom(): PanZoomState {
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const dragging = useRef(false);

  const zoomAt = useCallback((cursorX: number, cursorY: number, factor: number) => {
    setZoom((oldZoom) => {
      const newZoom = clamp(oldZoom * factor, MIN_ZOOM, MAX_ZOOM);
      if (newZoom === oldZoom) return oldZoom;
      // Keep the graph-coord under the cursor stationary.
      // graph = (cursor - pan) / oldZoom
      // newPan = cursor - graph * newZoom
      // = cursor - (cursor - pan) * (newZoom / oldZoom)
      // = pan + (cursor - pan) * (1 - newZoom / oldZoom)
      const ratio = newZoom / oldZoom;
      setPanX((px) => cursorX - (cursorX - px) * ratio);
      setPanY((py) => cursorY - (cursorY - py) * ratio);
      return newZoom;
    });
  }, []);

  const onWheel = useCallback<PanZoomState["onWheel"]>(
    (e) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? WHEEL_FACTOR : 1 / WHEEL_FACTOR;
      zoomAt(cursorX, cursorY, factor);
    },
    [zoomAt],
  );

  const onMouseDown = useCallback<PanZoomState["onMouseDown"]>((e) => {
    if (e.button !== 0) return;
    dragging.current = true;
    setIsDragging(true);
  }, []);

  const onMouseMove = useCallback<PanZoomState["onMouseMove"]>((e) => {
    if (!dragging.current) return;
    setPanX((p) => p + e.movementX);
    setPanY((p) => p + e.movementY);
  }, []);

  const onMouseUp = useCallback<PanZoomState["onMouseUp"]>(() => {
    if (!dragging.current) return;
    dragging.current = false;
    setIsDragging(false);
  }, []);

  const fitToScreen = useCallback<PanZoomState["fitToScreen"]>((box, viewport) => {
    if (box.width <= 0 || box.height <= 0) {
      setPanX(0);
      setPanY(0);
      setZoom(1);
      return;
    }
    const fitZoom = clamp(
      Math.min(viewport.width / box.width, viewport.height / box.height) * FIT_PADDING,
      MIN_ZOOM,
      MAX_ZOOM,
    );
    // Center the box inside the viewport.
    const newPanX = (viewport.width - box.width * fitZoom) / 2;
    const newPanY = (viewport.height - box.height * fitZoom) / 2;
    setZoom(fitZoom);
    setPanX(newPanX);
    setPanY(newPanY);
  }, []);

  const zoomIn = useCallback<PanZoomState["zoomIn"]>(
    (center) => {
      zoomAt(center?.x ?? 0, center?.y ?? 0, BUTTON_FACTOR);
    },
    [zoomAt],
  );

  const zoomOut = useCallback<PanZoomState["zoomOut"]>(
    (center) => {
      zoomAt(center?.x ?? 0, center?.y ?? 0, 1 / BUTTON_FACTOR);
    },
    [zoomAt],
  );

  const reset = useCallback<PanZoomState["reset"]>(() => {
    setPanX(0);
    setPanY(0);
    setZoom(1);
  }, []);

  const panBy = useCallback<PanZoomState["panBy"]>((dx, dy) => {
    if (dx === 0 && dy === 0) return;
    setPanX((p) => p + dx);
    setPanY((p) => p + dy);
  }, []);

  return {
    panX,
    panY,
    zoom,
    isDragging,
    onWheel,
    onMouseDown,
    onMouseMove,
    onMouseUp,
    fitToScreen,
    zoomIn,
    zoomOut,
    reset,
    panBy,
  };
}
