import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/tauri", () => ({
  jsonbInferenceRequest: vi.fn(),
  jsonbInferenceInvalidate: vi.fn(),
  subscribeJsonbInference: vi.fn(async () => () => {}),
}));

import * as tauri from "../../../lib/tauri";

import { useJsonbInference } from "./store";

describe("S16 jsonb inference store", () => {
  beforeEach(() => {
    useJsonbInference.setState({
      byKey: {},
      pendingCallbacks: {},
      initialized: false,
      unsubscribe: null,
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const fqn = { schema: "s", table: "t", column: "c" };

  it("ready response sets entry and fires onReady", async () => {
    (tauri.jsonbInferenceRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "ready",
      schema: { nodes: [], sampleCount: 0, generatedAt: 0 },
    });
    const onReady = vi.fn();
    useJsonbInference.getState().request("c1", fqn, onReady);
    await vi.waitFor(() => {
      expect(onReady).toHaveBeenCalledOnce();
    });
    const entry = useJsonbInference.getState().byKey["c1::s::t::c"];
    expect(entry?.status).toBe("ready");
  });

  it("stale response stores entry but does NOT fire onReady (event will)", async () => {
    (tauri.jsonbInferenceRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "stale",
      schema: { nodes: [], sampleCount: 0, generatedAt: 0 },
    });
    const onReady = vi.fn();
    useJsonbInference.getState().request("c1", fqn, onReady);
    // Allow the promise microtask to run.
    await new Promise((r) => setTimeout(r, 5));
    expect(onReady).not.toHaveBeenCalled();
    const entry = useJsonbInference.getState().byKey["c1::s::t::c"];
    expect(entry?.status).toBe("stale");
  });

  it("pending response leaves placeholder; onReady not yet fired", async () => {
    (tauri.jsonbInferenceRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "pending",
    });
    const onReady = vi.fn();
    useJsonbInference.getState().request("c1", fqn, onReady);
    await new Promise((r) => setTimeout(r, 5));
    expect(onReady).not.toHaveBeenCalled();
    const entry = useJsonbInference.getState().byKey["c1::s::t::c"];
    expect(entry?.status).toBe("pending");
  });

  it("rejected request sets error entry", async () => {
    (tauri.jsonbInferenceRequest as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("boom"));
    useJsonbInference.getState().request("c1", fqn);
    await vi.waitFor(() => {
      const entry = useJsonbInference.getState().byKey["c1::s::t::c"];
      expect(entry?.status).toBe("error");
    });
  });

  it("getCached returns schema for ready and stale, null otherwise", () => {
    const schema = { nodes: [], sampleCount: 0, generatedAt: 0 } as any;
    useJsonbInference.setState({
      byKey: {
        "c1::s::t::c": { status: "ready", schema },
        "c1::s::t::d": { status: "stale", schema },
        "c1::s::t::e": { status: "pending" },
        "c1::s::t::f": { status: "error", message: "x" },
      },
    });
    expect(useJsonbInference.getState().getCached("c1", fqn)).toBe(schema);
    expect(useJsonbInference.getState().getCached("c1", { ...fqn, column: "d" })).toBe(schema);
    expect(useJsonbInference.getState().getCached("c1", { ...fqn, column: "e" })).toBeNull();
    expect(useJsonbInference.getState().getCached("c1", { ...fqn, column: "f" })).toBeNull();
  });

  it("invalidate clears entry then re-requests", async () => {
    (tauri.jsonbInferenceInvalidate as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (tauri.jsonbInferenceRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "pending",
    });
    useJsonbInference.setState({
      byKey: {
        "c1::s::t::c": {
          status: "ready",
          schema: { nodes: [], sampleCount: 0, generatedAt: 0 } as any,
        },
      },
    });
    await useJsonbInference.getState().invalidate("c1", fqn);
    expect(tauri.jsonbInferenceInvalidate).toHaveBeenCalledOnce();
    expect(tauri.jsonbInferenceRequest).toHaveBeenCalledOnce();
  });

  it("init is idempotent across calls", async () => {
    await useJsonbInference.getState().init();
    await useJsonbInference.getState().init();
    expect(tauri.subscribeJsonbInference).toHaveBeenCalledOnce();
  });

  it("multiple onReady callbacks fire on ready response", async () => {
    (tauri.jsonbInferenceRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "ready",
      schema: { nodes: [], sampleCount: 0, generatedAt: 0 },
    });
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    useJsonbInference.getState().request("c1", fqn, cb1);
    useJsonbInference.getState().request("c1", fqn, cb2);
    await vi.waitFor(() => {
      expect(cb1).toHaveBeenCalledOnce();
      expect(cb2).toHaveBeenCalledOnce();
    });
  });
});
