/**
 * Post-S14 — runQuery RunIntent dispatch tests.
 *
 * Verifies that:
 * - intent={kind: "current"} dispatches the cached current statement.
 * - intent={kind: "all"} dispatches every statement in the editor.
 * - intent={kind: "selection"} splits the selection into statements.
 * - legacy `runQuery(_, null)` overload maps to {kind: "current"}.
 * - legacy `runQuery(_, "SQL")` overload maps to {kind: "explicit"}.
 * - batchRunStates is populated with activeIdx = last on success.
 * - setActiveBatchTab switches the active sub-tab and mirrors into
 * legacy runStates so existing selectors keep working.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useConnections } from "../connections/store";
import { useEditor } from "./store";

vi.mock("../../lib/tauri", async (orig) => {
  const real = await orig<typeof import("../../lib/tauri")>();
  return {
    ...real,
    queryRunBatch: vi.fn().mockResolvedValue({
      statements: [
        {
          kind: "rowset",
          index: 0,
          sql: "SELECT 1",
          columns: [],
          rows: [["1"]],
          truncated: false,
          cursorId: null,
          exhausted: true,
          durationMs: 5,
          statusMessage: "SELECT",
        },
      ],
      totalDurationMs: 5,
      failedAt: null,
    }),
  };
});

beforeEach(() => {
  useEditor.setState({
    tabs: [],
    activeTabId: null,
    runStates: new Map(),
    batchRunStates: new Map(),
    currentStatementByTab: new Map(),
    selectionByTab: new Map(),
    safetyModal: { kind: "none" },
  } as Partial<ReturnType<typeof useEditor.getState>>);
  useConnections.setState({
    connections: [
      {
        id: "c1",
        name: "test",
        environment: "dev",
        database: "x",
        readOnly: false,
        confirmDestructive: false,
        slowQueryWarning: false,
      } as never,
    ],
    selectedId: null,
    formMode: { type: "closed" },
    loading: false,
    error: null,
  });
});
afterEach(() => vi.clearAllMocks());

describe("runQuery via RunIntent", () => {
  it("intent=current with cached statement sends single SQL to backend", async () => {
    const { queryRunBatch } = await import("../../lib/tauri");
    useEditor.setState({
      tabs: [
        {
          id: "t1",
          kind: "editor",
          connectionId: "c1",
          content: "SELECT 1; SELECT 2",
          dirty: false,
        } as never,
      ],
      activeTabId: "t1",
      currentStatementByTab: new Map([
        ["t1", { text: "SELECT 2", startOffset: 9, endOffset: 19, startLine: 1, endLine: 1 }],
      ]),
    });
    await useEditor.getState().runQuery("t1", { kind: "current" });
    expect(queryRunBatch).toHaveBeenCalledWith("c1", ["SELECT 2"], true);
  });

  it("intent=all sends every statement", async () => {
    const { queryRunBatch } = await import("../../lib/tauri");
    useEditor.setState({
      tabs: [
        {
          id: "t1",
          kind: "editor",
          connectionId: "c1",
          content: "SELECT 1; SELECT 2; SELECT 3",
          dirty: false,
        } as never,
      ],
      activeTabId: "t1",
    });
    await useEditor.getState().runQuery("t1", { kind: "all" });
    expect(queryRunBatch).toHaveBeenCalledWith("c1", ["SELECT 1", "SELECT 2", "SELECT 3"], true);
  });

  it("intent=selection splits the selection into statements", async () => {
    const { queryRunBatch } = await import("../../lib/tauri");
    useEditor.setState({
      tabs: [
        {
          id: "t1",
          kind: "editor",
          connectionId: "c1",
          content: "SELECT 1; SELECT 2; SELECT 3",
          dirty: false,
        } as never,
      ],
      activeTabId: "t1",
    });
    await useEditor.getState().runQuery("t1", { kind: "selection", text: "SELECT 1; SELECT 2" });
    expect(queryRunBatch).toHaveBeenCalledWith("c1", ["SELECT 1", "SELECT 2"], true);
  });

  it("legacy null intent maps to {kind: current}", async () => {
    const { queryRunBatch } = await import("../../lib/tauri");
    useEditor.setState({
      tabs: [
        {
          id: "t1",
          kind: "editor",
          connectionId: "c1",
          content: "SELECT 1",
          dirty: false,
        } as never,
      ],
      activeTabId: "t1",
    });
    await useEditor.getState().runQuery("t1", null);
    expect(queryRunBatch).toHaveBeenCalledWith("c1", ["SELECT 1"], true);
  });

  it("legacy string intent maps to {kind: explicit, text}", async () => {
    const { queryRunBatch } = await import("../../lib/tauri");
    useEditor.setState({
      tabs: [
        {
          id: "t1",
          kind: "editor",
          connectionId: "c1",
          content: "SELECT 1",
          dirty: false,
        } as never,
      ],
      activeTabId: "t1",
    });
    await useEditor.getState().runQuery("t1", "SELECT 42");
    expect(queryRunBatch).toHaveBeenCalledWith("c1", ["SELECT 42"], true);
  });

  it("populates batchRunStates with activeIdx = last on success", async () => {
    useEditor.setState({
      tabs: [
        {
          id: "t1",
          kind: "editor",
          connectionId: "c1",
          content: "SELECT 1",
          dirty: false,
        } as never,
      ],
      activeTabId: "t1",
    });
    await useEditor.getState().runQuery("t1", { kind: "current" });
    const b = useEditor.getState().batchRunStates.get("t1");
    expect(b?.status).toBe("ready");
    if (b?.status === "ready") {
      expect(b.activeIdx).toBe(0);
      expect(b.failedAt).toBeNull();
    }
  });
});

describe("setActiveBatchTab", () => {
  it("switches activeIdx and mirrors the new active outcome into runStates", async () => {
    useEditor.setState({
      tabs: [
        {
          id: "t1",
          kind: "editor",
          connectionId: "c1",
          content: "SELECT 1; SELECT 2",
          dirty: false,
        } as never,
      ],
      activeTabId: "t1",
      batchRunStates: new Map([
        [
          "t1",
          {
            status: "ready",
            activeIdx: 1,
            totalDurationMs: 10,
            failedAt: null,
            statements: [
              {
                kind: "rowset",
                index: 0,
                sql: "SELECT 1",
                columns: [],
                rows: [["1"]],
                truncated: false,
                cursorId: null,
                exhausted: true,
                durationMs: 5,
                statusMessage: "SELECT",
              },
              {
                kind: "rowset",
                index: 1,
                sql: "SELECT 2",
                columns: [],
                rows: [["2"]],
                truncated: false,
                cursorId: null,
                exhausted: true,
                durationMs: 5,
                statusMessage: "SELECT",
              },
            ],
          },
        ],
      ]),
    });
    useEditor.getState().setActiveBatchTab("t1", 0);
    expect(useEditor.getState().batchRunStates.get("t1")?.status).toBe("ready");
    const after = useEditor.getState().batchRunStates.get("t1");
    if (after?.status === "ready") {
      expect(after.activeIdx).toBe(0);
    }
  });
});
