/**
 * — usePanZoom hook (C2) tests.
 *
 * The math we care about:
 * - Wheel up at point P preserves P's graph-coordinate (within 1 px).
 * - Drag accumulates movementX/Y onto panX/Y (1:1 in screen space).
 * - fitToScreen(box, viewport) computes scale = min(vw/bw, vh/bh) * 0.95.
 * - reset clears state.
 *
 * jsdom does not implement layout, so we stub `getBoundingClientRect`
 * on the synthetic event's currentTarget where needed.
 */

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { usePanZoom } from "./usePanZoom";

type WheelHandler = ReturnType<typeof usePanZoom>["onWheel"];
type MouseHandler = ReturnType<typeof usePanZoom>["onMouseDown"];

interface FakeRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

function fakeWheelEvent(opts: {
  clientX: number;
  clientY: number;
  deltaY: number;
  rect: FakeRect;
}): Parameters<WheelHandler>[0] {
  const target = {
    getBoundingClientRect: () => ({
      ...opts.rect,
      right: opts.rect.left + opts.rect.width,
      bottom: opts.rect.top + opts.rect.height,
      x: opts.rect.left,
      y: opts.rect.top,
      toJSON: () => ({}),
    }),
  } as unknown as SVGSVGElement;
  return {
    deltaY: opts.deltaY,
    clientX: opts.clientX,
    clientY: opts.clientY,
    currentTarget: target,
    preventDefault: () => {},
  } as unknown as Parameters<WheelHandler>[0];
}

function fakeMouseEvent(opts: {
  clientX?: number;
  clientY?: number;
  movementX?: number;
  movementY?: number;
  button?: number;
}): Parameters<MouseHandler>[0] {
  return {
    clientX: opts.clientX ?? 0,
    clientY: opts.clientY ?? 0,
    movementX: opts.movementX ?? 0,
    movementY: opts.movementY ?? 0,
    button: opts.button ?? 0,
    preventDefault: () => {},
  } as unknown as Parameters<MouseHandler>[0];
}

describe("usePanZoom", () => {
  it("starts at pan=(0,0), zoom=1", () => {
    const { result } = renderHook(() => usePanZoom());
    expect(result.current.panX).toBe(0);
    expect(result.current.panY).toBe(0);
    expect(result.current.zoom).toBe(1);
  });

  it("wheel up at (100,100) zooms in and keeps that point under the cursor", () => {
    const { result } = renderHook(() => usePanZoom());
    const before = {
      px: result.current.panX,
      py: result.current.panY,
      z: result.current.zoom,
    };
    // The graph-coord under (cursorX, cursorY) is
    // gx = (cursorX - panX) / zoom,  gy = (cursorY - panY) / zoom.
    const gx = (100 - before.px) / before.z;
    const gy = (100 - before.py) / before.z;

    act(() => {
      result.current.onWheel(        fakeWheelEvent({
          clientX: 100,
          clientY: 100,
          deltaY: -100,
          rect: { left: 0, top: 0, width: 800, height: 600 },
        }),
);
    });

    expect(result.current.zoom).toBeGreaterThan(before.z);
    // Re-derive the screen position of (gx, gy) under the new transform.
    const screenX = gx * result.current.zoom + result.current.panX;
    const screenY = gy * result.current.zoom + result.current.panY;
    expect(Math.abs(screenX - 100)).toBeLessThan(1);
    expect(Math.abs(screenY - 100)).toBeLessThan(1);
  });

  it("clamps zoom at MIN_ZOOM and MAX_ZOOM", () => {
    const { result } = renderHook(() => usePanZoom());

    // Spam wheel-up until we hit the ceiling.
    act(() => {
      for (let i = 0; i < 100; i++) {
        result.current.onWheel(          fakeWheelEvent({
            clientX: 0,
            clientY: 0,
            deltaY: -100,
            rect: { left: 0, top: 0, width: 100, height: 100 },
          }),
);
      }
    });
    expect(result.current.zoom).toBeLessThanOrEqual(4);

    act(() => {
      for (let i = 0; i < 100; i++) {
        result.current.onWheel(          fakeWheelEvent({
            clientX: 0,
            clientY: 0,
            deltaY: 100,
            rect: { left: 0, top: 0, width: 100, height: 100 },
          }),
);
      }
    });
    // post-QA: lowered MIN_ZOOM to 0.05 so 50+-table graphs
    // always fit; the only invariant is that zoom never goes negative or
    // hits the floor.
    expect(result.current.zoom).toBeGreaterThanOrEqual(0.05);
  });

  it("drag (mousedown → mousemove) pans by movementX/movementY", () => {
    const { result } = renderHook(() => usePanZoom());

    act(() => {
      result.current.onMouseDown(fakeMouseEvent({ button: 0, clientX: 0, clientY: 0 }));
    });
    act(() => {
      result.current.onMouseMove(fakeMouseEvent({ movementX: 10, movementY: 20 }));
    });
    expect(result.current.panX).toBe(10);
    expect(result.current.panY).toBe(20);

    // Another move continues to accumulate.
    act(() => {
      result.current.onMouseMove(fakeMouseEvent({ movementX: -3, movementY: 5 }));
    });
    expect(result.current.panX).toBe(7);
    expect(result.current.panY).toBe(25);

    // Mouse up stops the drag — subsequent moves are ignored.
    act(() => {
      result.current.onMouseUp(fakeMouseEvent({}));
    });
    act(() => {
      result.current.onMouseMove(fakeMouseEvent({ movementX: 99, movementY: 99 }));
    });
    expect(result.current.panX).toBe(7);
    expect(result.current.panY).toBe(25);
  });

  it("fitToScreen on a 1000×1000 graph in a 500×500 viewport yields zoom ≈ 0.46", () => {
    const { result } = renderHook(() => usePanZoom());
    act(() => {
      result.current.fitToScreen({ width: 1000, height: 1000 }, { width: 500, height: 500 });
    });
    // 0.5 * FIT_PADDING = 0.5 * 0.92 = 0.46
    expect(Math.abs(result.current.zoom - 0.46)).toBeLessThan(1e-6);
    // The graph's center (500, 500) should land at the viewport's center
    // (250, 250). That gives panX = 250 - 500 * 0.475 = 12.5.
    const screenCenterX = 500 * result.current.zoom + result.current.panX;
    const screenCenterY = 500 * result.current.zoom + result.current.panY;
    expect(Math.abs(screenCenterX - 250)).toBeLessThan(1);
    expect(Math.abs(screenCenterY - 250)).toBeLessThan(1);
  });

  it("zoomIn / zoomOut multiply zoom by ~1.2 / ~1/1.2 around the viewport center", () => {
    const { result } = renderHook(() => usePanZoom());
    act(() => {
      result.current.zoomIn();
    });
    expect(result.current.zoom).toBeCloseTo(1.2, 5);
    act(() => {
      result.current.zoomOut();
      result.current.zoomOut();
    });
    expect(result.current.zoom).toBeCloseTo(1.2 / 1.2 / 1.2, 5);
  });

  it("reset returns to (0,0,1)", () => {
    const { result } = renderHook(() => usePanZoom());
    act(() => {
      result.current.onMouseDown(fakeMouseEvent({ button: 0 }));
      result.current.onMouseMove(fakeMouseEvent({ movementX: 50, movementY: 60 }));
      result.current.zoomIn();
    });
    expect(result.current.zoom).not.toBe(1);
    act(() => {
      result.current.reset();
    });
    expect(result.current.panX).toBe(0);
    expect(result.current.panY).toBe(0);
    expect(result.current.zoom).toBe(1);
  });

  // — keyboard pan delta. ErdPane wires Arrow keys / Shift-Arrow
  // to `panBy` so screen-reader users can move the canvas without a mouse;
  // the math is a straight pan += dx (1:1 in screen pixels).
  it("panBy adds dx/dy to current pan (acceptance #3 keyboard nav)", () => {
    const { result } = renderHook(() => usePanZoom());
    act(() => {
      result.current.panBy(32, -16);
    });
    expect(result.current.panX).toBe(32);
    expect(result.current.panY).toBe(-16);
    act(() => {
      result.current.panBy(-32, 16);
    });
    expect(result.current.panX).toBe(0);
    expect(result.current.panY).toBe(0);
  });
});
