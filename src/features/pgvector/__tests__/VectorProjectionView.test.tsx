// — : smoke tests for the projection view.
// Strategy: mock `queryExecute` to return a small fixed table (4 collinear
// 3-D vectors) so PCA produces a real, non-degenerate first axis. Stub the
// global Worker so "Refine with UMAP" can be exercised without a real worker
// runtime — our fake schedules its callback on the next microtask.
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queryExecuteMock = vi.fn();
vi.mock("../../../lib/tauri", () => ({
  queryExecute: (...args: unknown[]) => queryExecuteMock(...args),
}));

import { VectorProjectionView } from "../VectorProjectionView";

type WorkerMessage = MessageEvent<unknown>;
interface FakeWorkerOptions {
  respond: "done" | "error";
}

class FakeWorker {
  static current: FakeWorker | null = null;
  static options: FakeWorkerOptions = { respond: "done" };
  private listeners: Array<(e: WorkerMessage) => void> = [];
  onmessage: ((e: WorkerMessage) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  terminated = false;

  constructor(_url: string | URL, _opts?: WorkerOptions) {
    FakeWorker.current = this;
  }
  postMessage(_data: unknown): void {
    queueMicrotask(() => {
      const payload =
        FakeWorker.options.respond === "done"
          ? { type: "done", xy: [Float32Array.from([0.1, 0.2])] }
          : { type: "error", message: "boom" };
      const evt = { data: payload } as unknown as WorkerMessage;
      this.onmessage?.(evt);
      for (const l of this.listeners) l(evt);
    });
  }
  terminate(): void {
    this.terminated = true;
  }
  addEventListener(type: string, listener: (e: WorkerMessage) => void): void {
    if (type === "message") this.listeners.push(listener);
  }
  removeEventListener(): void {
    /* noop */
  }
  dispatchEvent(): boolean {
    return true;
  }
}

const FIXTURE_RESULT = {
  columns: [
    { name: "id", typeName: "int4", isNumeric: true },
    { name: "embedding", typeName: "vector(3)", isNumeric: false },
  ],
  rows: [
    ["1", "[1,1,0]"],
    ["2", "[2,2,0]"],
    ["3", "[3,3,0]"],
    ["4", "[4,4,0]"],
  ],
  truncated: false,
  durationMs: 1,
  affectedRows: null,
  statusMessage: "",
};

beforeEach(() => {
  queryExecuteMock.mockReset();
  queryExecuteMock.mockResolvedValue(FIXTURE_RESULT);
  FakeWorker.current = null;
  FakeWorker.options = { respond: "done" };
  vi.stubGlobal("Worker", FakeWorker as unknown as typeof Worker);
  // jsdom doesn't implement HTMLCanvasElement.prototype.getContext; stub it
  // with a no-op 2D context so the component's redraw effect runs cleanly.
  HTMLCanvasElement.prototype.getContext = (() => ({
    clearRect: () => {},
    beginPath: () => {},
    arc: () => {},
    fill: () => {},
    fillStyle: "",
  })) as unknown as HTMLCanvasElement["getContext"];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("VectorProjectionView", () => {
  it("calls queryExecute on mount and renders the canvas after PCA finishes", async () => {
    render(
      <VectorProjectionView
        connId="conn-1"
        qualifiedTable="public.items"
        pk="id"
        vectorColumn="embedding"
        rowCount={1000}
        onClose={() => {}}
      />,
    );

    await waitFor(() => expect(queryExecuteMock).toHaveBeenCalledTimes(1));
    const sql = queryExecuteMock.mock.calls[0][1] as string;
    expect(sql).toContain("public.items");
    expect(sql).toContain("embedding");
    expect(sql).toContain("ORDER BY random()");

    expect(await screen.findByTestId("vector-projection-canvas")).toBeInTheDocument();
  });

  it("uses TABLESAMPLE for large tables and shows the banner", async () => {
    render(
      <VectorProjectionView
        connId="conn-1"
        qualifiedTable="public.huge"
        pk="id"
        vectorColumn="embedding"
        rowCount={1_000_000}
        onClose={() => {}}
      />,
    );
    await waitFor(() => expect(queryExecuteMock).toHaveBeenCalledTimes(1));
    const sql = queryExecuteMock.mock.calls[0][1] as string;
    expect(sql).toContain("TABLESAMPLE BERNOULLI");
    expect(screen.getByTestId("vector-projection-banner")).toBeInTheDocument();
  });

  it("shows loading state and clears it once the worker reports done", async () => {
    render(
      <VectorProjectionView
        connId="conn-1"
        qualifiedTable="public.items"
        pk="id"
        vectorColumn="embedding"
        rowCount={1000}
        onClose={() => {}}
      />,
    );
    await screen.findByTestId("vector-projection-canvas");

    FakeWorker.options = { respond: "done" };
    await userEvent.click(screen.getByTestId("projection-refine"));

    // Loading overlay flashes; assert it eventually clears.
    await waitFor(() => {
      expect(screen.queryByTestId("vector-projection-loading")).not.toBeInTheDocument();
    });
    expect(screen.getByTestId("vector-projection-canvas")).toBeInTheDocument();
    expect(FakeWorker.current?.terminated).toBe(true);
  });

  it("renders error text when the worker posts an error", async () => {
    render(
      <VectorProjectionView
        connId="conn-1"
        qualifiedTable="public.items"
        pk="id"
        vectorColumn="embedding"
        rowCount={1000}
        onClose={() => {}}
      />,
    );
    await screen.findByTestId("vector-projection-canvas");

    FakeWorker.options = { respond: "error" };
    await userEvent.click(screen.getByTestId("projection-refine"));

    await waitFor(() => expect(screen.getByTestId("vector-projection-error")).toBeInTheDocument());
    expect(screen.queryByTestId("vector-projection-loading")).not.toBeInTheDocument();
    expect(FakeWorker.current?.terminated).toBe(true);
  });
});
