/**
 * — ERD store (C1) tests.
 *
 * Covers:
 * - cache hit: two `loadGraph(connId, schemas)` with the same key → 1 IPC call.
 * - cache miss across different schema filters → 2 IPC calls, 2 cache entries.
 * - `invalidate(connId)` evicts every key prefixed with the connection id.
 * - error path stores the error message verbatim (component owns localization).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ErdSchemaGraph, erdGetSchemaGraph } from "../../lib/tauri";

vi.mock("../../lib/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../lib/tauri")>("../../lib/tauri");
  return {
    ...actual,
    erdGetSchemaGraph: vi.fn(),
  };
});

import { useErdStore } from "./store";

const emptyGraph: ErdSchemaGraph = {
  tables: [],
  foreignKeys: [],
  fetchedInMs: 0,
};

const mocked = erdGetSchemaGraph as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  // Reset internal map between tests.
  useErdStore.setState({ entries: new Map() });
  mocked.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useErdStore", () => {
  it("loadGraph twice with the same key invokes erdGetSchemaGraph once", async () => {
    mocked.mockResolvedValue(emptyGraph);

    await useErdStore.getState().loadGraph("conn-1", ["public"]);
    await useErdStore.getState().loadGraph("conn-1", ["public"]);

    expect(mocked).toHaveBeenCalledTimes(1);
    const state = useErdStore.getState().getState("conn-1", ["public"]);
    expect(state.kind).toBe("ready");
  });

  it("different schemas arrays yield separate cache entries and two invocations", async () => {
    mocked.mockResolvedValue(emptyGraph);

    await useErdStore.getState().loadGraph("conn-1", ["public"]);
    await useErdStore.getState().loadGraph("conn-1", ["public", "auth"]);
    await useErdStore.getState().loadGraph("conn-1", undefined);

    expect(mocked).toHaveBeenCalledTimes(3);
    expect(useErdStore.getState().getState("conn-1", ["public"]).kind).toBe("ready");
    expect(useErdStore.getState().getState("conn-1", ["public", "auth"]).kind).toBe("ready");
    expect(useErdStore.getState().getState("conn-1", undefined).kind).toBe("ready");
  });

  it("ignores element order when computing the cache key", async () => {
    mocked.mockResolvedValue(emptyGraph);
    await useErdStore.getState().loadGraph("conn-1", ["public", "auth"]);
    await useErdStore.getState().loadGraph("conn-1", ["auth", "public"]);
    expect(mocked).toHaveBeenCalledTimes(1);
  });

  it("invalidate(connId) evicts every cache entry for that connection", async () => {
    mocked.mockResolvedValue(emptyGraph);
    await useErdStore.getState().loadGraph("conn-1", ["public"]);
    await useErdStore.getState().loadGraph("conn-1", undefined);
    await useErdStore.getState().loadGraph("conn-2", ["public"]);

    useErdStore.getState().invalidate("conn-1");

    expect(useErdStore.getState().getState("conn-1", ["public"]).kind).toBe("idle");
    expect(useErdStore.getState().getState("conn-1", undefined).kind).toBe("idle");
    expect(useErdStore.getState().getState("conn-2", ["public"]).kind).toBe("ready");
  });

  it("stores the raw error message on failure", async () => {
    mocked.mockRejectedValue(new Error("boom"));
    await useErdStore.getState().loadGraph("conn-1", undefined);
    const state = useErdStore.getState().getState("conn-1", undefined);
    expect(state.kind).toBe("error");
    if (state.kind === "error") {
      expect(state.message).toBe("boom");
    }
  });
});
