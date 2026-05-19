import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ColumnMeta, EditorTabRow, QueryErrorPayload, QueryResult } from "../../lib/tauri";

const tabsListMock = vi.fn();
const tabsSaveMock = vi.fn();
const tabsDeleteMock = vi.fn();
const queryRunBatchMock = vi.fn();
const queryFetchPageMock = vi.fn();
const queryCancelMock = vi.fn();
const queryCloseCursorMock = vi.fn();

vi.mock("../../lib/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../lib/tauri")>("../../lib/tauri");
  return {
    ...actual,
    tabsList: () => tabsListMock(),
    tabsSave: (tab: EditorTabRow) => tabsSaveMock(tab),
    tabsDelete: (id: string) => tabsDeleteMock(id),
    // Post-S14: runQuery now dispatches through queryRunBatch instead of
    // queryOpenCursor. Tests mock the new entry-point and shape.
    queryRunBatch: (connId: string, statements: string[], cursorForLast: boolean) =>
      queryRunBatchMock(connId, statements, cursorForLast),
    queryFetchPage: (cursorId: string, limit: number) => queryFetchPageMock(cursorId, limit),
    queryCancel: (cursorId: string) => queryCancelMock(cursorId),
    queryCloseCursor: (cursorId: string) => queryCloseCursorMock(cursorId),
  };
});

import { QueryError } from "../../lib/tauri";
import { __testing, mapPositionToLineCol, useEditor } from "./store";

const sampleColumn: ColumnMeta = {
  name: "id",
  typeName: "int4",
  isNumeric: true,
};

const sampleResult: QueryResult = {
  columns: [sampleColumn],
  rows: [["1"]],
  truncated: false,
  durationMs: 5,
  affectedRows: null,
  statusMessage: "SELECT 1",
};

/**
 * Build a `BatchResult` carrying ONE rowset statement so the legacy
 * single-statement runQuery tests keep their assertion shape (one streaming
 * RunState entry per tab) without rewriting every one.
 */
function makeBatchResult(sql: string) {
  return {
    statements: [
      {
        kind: "rowset" as const,
        index: 0,
        sql,
        columns: [sampleColumn],
        rows: [["1"]],
        truncated: false,
        cursorId: null,
        exhausted: true,
        durationMs: 5,
        statusMessage: "SELECT 1",
      },
    ],
    totalDurationMs: 5,
    failedAt: null,
  };
}

function makeEditorRow(overrides: Partial<EditorTabRow> = {}): EditorTabRow {
  return {
    id: "tab-1",
    kind: "editor",
    name: "untitled-1",
    content: "SELECT 1",
    connectionId: "conn-1",
    nodeKey: null,
    cursorLine: 1,
    cursorCol: 1,
    createdAt: "2026-04-27T10:00:00.000Z",
    updatedAt: "2026-04-27T10:00:00.000Z",
    ...overrides,
  };
}

function makeObjectRow(overrides: Partial<EditorTabRow> = {}): EditorTabRow {
  return {
    id: "table:public/users",
    kind: "object",
    name: "table:public/users",
    content: "",
    connectionId: "conn-1",
    nodeKey: "table:public/users",
    cursorLine: 1,
    cursorCol: 1,
    createdAt: "2026-04-27T10:01:00.000Z",
    updatedAt: "2026-04-27T10:01:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  tabsListMock.mockReset();
  tabsSaveMock.mockReset();
  tabsDeleteMock.mockReset();
  queryRunBatchMock.mockReset();
  queryFetchPageMock.mockReset();
  queryCancelMock.mockReset();
  queryCloseCursorMock.mockReset();
  tabsSaveMock.mockResolvedValue(undefined);
  tabsDeleteMock.mockResolvedValue(undefined);
  queryCloseCursorMock.mockResolvedValue(undefined);
  __testing.reset();
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
});

afterEach(() => {
  vi.useRealTimers();
});

describe("mapPositionToLineCol", () => {
  test("first character → line 1, col 1", () => {
    expect(mapPositionToLineCol("SELECT 1", 1)).toEqual({ line: 1, col: 1 });
  });

  test("position after newlines maps line/col correctly", () => {
    const sql = "SELECT 1,\n  GARBAGE\nFROM t";
    // pos points at the 'G' (1-based offset of "GARBAGE")
    const gIdx = sql.indexOf("G") + 1;
    expect(mapPositionToLineCol(sql, gIdx)).toEqual({ line: 2, col: 3 });
  });

  test("invalid pos clamps to (1, 1)", () => {
    expect(mapPositionToLineCol("SELECT", 0)).toEqual({ line: 1, col: 1 });
  });
});

describe("hydrateFromSqlite", () => {
  test("loads rows and sets active tab from localStorage when present", async () => {
    tabsListMock.mockResolvedValueOnce([makeEditorRow(), makeObjectRow()]);
    window.localStorage.setItem("ide99:editor.activeTabId", "table:public/users");

    await useEditor.getState().hydrateFromSqlite();

    const state = useEditor.getState();
    expect(state.tabs).toHaveLength(2);
    expect(state.hydrated).toBe(true);
    expect(state.activeTabId).toBe("table:public/users");
    expect(state.untitledCounter).toBe(1);
  });

  test("falls back to first tab when localStorage entry is stale", async () => {
    tabsListMock.mockResolvedValueOnce([
      makeEditorRow({ id: "tab-3", name: "untitled-3" }),
      makeEditorRow({ id: "tab-7", name: "untitled-7" }),
    ]);
    window.localStorage.setItem("ide99:editor.activeTabId", "ghost-tab");

    await useEditor.getState().hydrateFromSqlite();

    const state = useEditor.getState();
    expect(state.activeTabId).toBe("tab-3");
    expect(state.untitledCounter).toBe(7);
  });

  test("empty list → no active tab, hydrated=true", async () => {
    tabsListMock.mockResolvedValueOnce([]);
    await useEditor.getState().hydrateFromSqlite();
    const state = useEditor.getState();
    expect(state.tabs).toEqual([]);
    expect(state.activeTabId).toBeNull();
    expect(state.hydrated).toBe(true);
  });

  test("skips malformed object rows missing nodeKey", async () => {
    tabsListMock.mockResolvedValueOnce([
      makeEditorRow(),
      makeObjectRow({ id: "broken", nodeKey: null }),
    ]);
    await useEditor.getState().hydrateFromSqlite();
    expect(useEditor.getState().tabs).toHaveLength(1);
  });
});

describe("openEditorTab", () => {
  test("creates with defaults, persists, and activates", () => {
    const tab = useEditor.getState().openEditorTab("conn-1");
    const state = useEditor.getState();
    expect(state.tabs).toEqual([tab]);
    expect(state.activeTabId).toBe(tab.id);
    expect(state.untitledCounter).toBe(1);
    expect(tab.name).toBe("untitled-1");
    expect(tab.connectionId).toBe("conn-1");
    expect(tab.cursorPos).toEqual({ line: 1, col: 1 });
    expect(tab.dirty).toBe(false);
    expect(tabsSaveMock).toHaveBeenCalledTimes(1);
  });

  test("counter persists across opens (does not reuse closed N)", () => {
    const a = useEditor.getState().openEditorTab(null);
    const b = useEditor.getState().openEditorTab(null);
    expect(a.name).toBe("untitled-1");
    expect(b.name).toBe("untitled-2");
  });
});

describe("openObjectTab", () => {
  test("creates new tab and activates", () => {
    const tab = useEditor.getState().openObjectTab("table:public/users", "conn-1");
    expect(tab.id).toBe("table:public/users");
    expect(tab.kind).toBe("object");
    expect(useEditor.getState().activeTabId).toBe(tab.id);
    expect(tabsSaveMock).toHaveBeenCalledTimes(1);
  });

  test("dedupes by id — second open just activates the existing tab", () => {
    useEditor.getState().openObjectTab("table:public/users", "conn-1");
    useEditor.getState().openEditorTab("conn-1");
    tabsSaveMock.mockClear();

    const tab = useEditor.getState().openObjectTab("table:public/users", "conn-1");
    expect(useEditor.getState().tabs.filter((t) => t.id === tab.id)).toHaveLength(1);
    expect(useEditor.getState().activeTabId).toBe(tab.id);
    expect(tabsSaveMock).not.toHaveBeenCalled();
  });
});

describe("closeTab", () => {
  test("removes the tab and persists deletion", async () => {
    const a = useEditor.getState().openEditorTab(null);
    const b = useEditor.getState().openEditorTab(null);
    tabsDeleteMock.mockClear();

    const ok = await useEditor.getState().closeTab(a.id);
    expect(ok).toBe(true);
    expect(useEditor.getState().tabs).toEqual([expect.objectContaining({ id: b.id })]);
    expect(tabsDeleteMock).toHaveBeenCalledWith(a.id);
  });

  test("activates the right neighbor when active tab is closed", async () => {
    const a = useEditor.getState().openEditorTab(null);
    const b = useEditor.getState().openEditorTab(null);
    const c = useEditor.getState().openEditorTab(null);
    useEditor.getState().switchTab(b.id);

    await useEditor.getState().closeTab(b.id);
    expect(useEditor.getState().activeTabId).toBe(c.id);
    // Sanity: a is unchanged
    expect(useEditor.getState().tabs.map((t) => t.id)).toEqual([a.id, c.id]);
  });

  test("activates the left neighbor when the rightmost active tab is closed", async () => {
    const a = useEditor.getState().openEditorTab(null);
    const b = useEditor.getState().openEditorTab(null);
    useEditor.getState().switchTab(b.id);

    await useEditor.getState().closeTab(b.id);
    expect(useEditor.getState().activeTabId).toBe(a.id);
  });

  test("clears active when last tab is closed", async () => {
    const a = useEditor.getState().openEditorTab(null);
    await useEditor.getState().closeTab(a.id);
    expect(useEditor.getState().activeTabId).toBeNull();
    expect(useEditor.getState().tabs).toEqual([]);
  });
});

describe("setContent (debounced persistence)", () => {
  test("marks dirty immediately, persists once after 500ms idle", async () => {
    vi.useFakeTimers();
    const tab = useEditor.getState().openEditorTab(null);
    tabsSaveMock.mockClear();

    useEditor.getState().setContent(tab.id, "SELECT 1");
    useEditor.getState().setContent(tab.id, "SELECT 2");
    useEditor.getState().setContent(tab.id, "SELECT 3");

    // Pre-debounce: dirty=true, no save yet
    const mid = useEditor.getState().tabs[0];
    expect(mid.kind === "editor" && mid.dirty).toBe(true);
    expect(tabsSaveMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(500);
    expect(tabsSaveMock).toHaveBeenCalledTimes(1);
    expect(tabsSaveMock).toHaveBeenCalledWith(      expect.objectContaining({ id: tab.id, content: "SELECT 3" }),
);

    // Post-save: dirty cleared
    const after = useEditor.getState().tabs[0];
    expect(after.kind === "editor" && after.dirty).toBe(false);
  });

  test("noop if id is not an editor tab", () => {
    useEditor.getState().openObjectTab("table:public/users", "conn-1");
    tabsSaveMock.mockClear();
    useEditor.getState().setContent("table:public/users", "ignored");
    // Object tab unchanged; no debounce timer
    expect(__testing.pendingContentTimers()).toBe(0);
  });
});

describe("setTabConnection", () => {
  test("updates connectionId and persists immediately", () => {
    const tab = useEditor.getState().openEditorTab(null);
    tabsSaveMock.mockClear();
    useEditor.getState().setTabConnection(tab.id, "conn-2");
    const updated = useEditor.getState().tabs[0];
    expect(updated.kind === "editor" && updated.connectionId).toBe("conn-2");
    expect(tabsSaveMock).toHaveBeenCalledTimes(1);
  });
});

describe("closeObjectTabsForConnection", () => {
  test("removes only object tabs of the matching connection", async () => {
    const editor = useEditor.getState().openEditorTab("conn-1");
    useEditor.getState().openObjectTab("table:public/users", "conn-1");
    useEditor.getState().openObjectTab("table:public/orders", "conn-1");
    useEditor.getState().openObjectTab("table:other/foo", "conn-2");
    tabsDeleteMock.mockClear();

    await useEditor.getState().closeObjectTabsForConnection("conn-1");

    const ids = useEditor.getState().tabs.map((t) => t.id);
    expect(ids).toContain(editor.id);
    expect(ids).toContain("table:other/foo");
    expect(ids).not.toContain("table:public/users");
    expect(ids).not.toContain("table:public/orders");
    expect(tabsDeleteMock).toHaveBeenCalledWith("table:public/users");
    expect(tabsDeleteMock).toHaveBeenCalledWith("table:public/orders");
  });
});

describe("runQuery", () => {
  test("success path enters streaming state with first page", async () => {
    const tab = useEditor.getState().openEditorTab("conn-1");
    useEditor.getState().setContent(tab.id, "SELECT 1");
    queryRunBatchMock.mockResolvedValueOnce(makeBatchResult("SELECT 1"));

    await useEditor.getState().runQuery(tab.id);

    const run = useEditor.getState().runStates.get(tab.id);
    expect(run?.status).toBe("streaming");
    if (run?.status === "streaming") {
      expect(run.cursorId).toBeNull(); // null cursorId → fully inline
      expect(run.exhausted).toBe(true);
      expect(run.rows).toEqual(sampleResult.rows);
      expect(run.loadedCount).toBe(sampleResult.rows.length);
    }
    expect(queryRunBatchMock).toHaveBeenCalledWith("conn-1", ["SELECT 1"], true);
  });

  test("postgresError with position maps to line/col", async () => {
    const tab = useEditor.getState().openEditorTab("conn-1");
    const sql = "SELECT 1,\n  GARBAGE\nFROM t";
    useEditor.getState().setContent(tab.id, sql);
    const gIdx = sql.indexOf("G") + 1;
    // Post-S14: errors arrive as a `StatementResult.error` entry inside
    // the BatchResult, not as a thrown QueryError.
    queryRunBatchMock.mockResolvedValueOnce({
      statements: [
        {
          kind: "error" as const,
          index: 0,
          sql,
          error: {
            kind: "postgresError",
            message: 'syntax error at or near "GARBAGE"',
            position: gIdx,
          } satisfies QueryErrorPayload,
        },
      ],
      totalDurationMs: 1,
      failedAt: 0,
    });

    await useEditor.getState().runQuery(tab.id);

    const run = useEditor.getState().runStates.get(tab.id);
    expect(run?.status).toBe("error");
    if (run?.status === "error") {
      expect(run.line).toBe(2);
      expect(run.col).toBe(3);
      expect(run.code).toBe("postgres_error");
      expect(run.detail).toContain("GARBAGE");
    }
  });

  test("notConnected error → error state with message, no line/col", async () => {
    const tab = useEditor.getState().openEditorTab("conn-1");
    useEditor.getState().setContent(tab.id, "SELECT 1");
    // Backend invocation failure (notConnected) is still surfaced via a
    // thrown QueryError because the batch never got far enough to return
    // a structured result.
    queryRunBatchMock.mockRejectedValueOnce(      new QueryError({ kind: "notConnected", connId: "conn-1" }),
);

    await useEditor.getState().runQuery(tab.id);

    const run = useEditor.getState().runStates.get(tab.id);
    expect(run?.status).toBe("error");
    if (run?.status === "error") {
      expect(run.line).toBeUndefined();
      expect(run.col).toBeUndefined();
      expect(run.code).toBe("not_connected");
    }
  });

  test("cancelled QueryError propagates as cancelled state (not error)", async () => {
    const tab = useEditor.getState().openEditorTab("conn-1");
    useEditor.getState().setContent(tab.id, "SELECT pg_sleep(60)");
    queryRunBatchMock.mockRejectedValueOnce(new QueryError({ kind: "cancelled" }));

    await useEditor.getState().runQuery(tab.id);

    expect(useEditor.getState().runStates.get(tab.id)?.status).toBe("cancelled");
  });

  test("no connection set → error state, no fetch", async () => {
    const tab = useEditor.getState().openEditorTab(null);
    useEditor.getState().setContent(tab.id, "SELECT 1");

    await useEditor.getState().runQuery(tab.id);

    expect(queryRunBatchMock).not.toHaveBeenCalled();
    expect(useEditor.getState().runStates.get(tab.id)?.status).toBe("error");
  });

  test("blank SQL → no-op (no fetch, no state change)", async () => {
    const tab = useEditor.getState().openEditorTab("conn-1");
    useEditor.getState().setContent(tab.id, "   \n\t  ");

    await useEditor.getState().runQuery(tab.id);
    expect(queryRunBatchMock).not.toHaveBeenCalled();
    expect(useEditor.getState().runStates.get(tab.id)).toBeUndefined();
  });

  test("sqlOverride wins over tab content", async () => {
    const tab = useEditor.getState().openEditorTab("conn-1");
    useEditor.getState().setContent(tab.id, "SELECT all");
    queryRunBatchMock.mockResolvedValueOnce(makeBatchResult("SELECT 42"));

    await useEditor.getState().runQuery(tab.id, "SELECT 42");
    expect(queryRunBatchMock).toHaveBeenCalledWith("conn-1", ["SELECT 42"], true);
  });
});

describe("fetchMore + cancelRun + setSort", () => {
  function liveStreaming(tabId: string, overrides: Record<string, unknown> = {}) {
    useEditor.setState({
      runStates: new Map([
        [
          tabId,
          {
            status: "streaming",
            cursorId: "c_x",
            columns: [{ name: "i", typeName: "int4", isNumeric: true }],
            rows: [["1"], ["2"]],
            loadedCount: 2,
            exhausted: false,
            durationMs: 5,
            prefetching: false,
            affectedRows: null,
            statusMessage: "SELECT",
            sort: null,
            columnWidths: new Map(),
            columnOrder: [0],
            ...overrides,
          },
        ],
      ]),
    });
  }

  test("fetchMore appends rows + flips exhausted + clears cursorId", async () => {
    queryFetchPageMock.mockResolvedValueOnce({ rows: [["3"], ["4"]], exhausted: true });
    const tab = useEditor.getState().openEditorTab("conn-1");
    liveStreaming(tab.id);
    await useEditor.getState().fetchMore(tab.id);
    const run = useEditor.getState().runStates.get(tab.id);
    if (run?.status !== "streaming") throw new Error("expected streaming");
    expect(run.rows).toEqual([["1"], ["2"], ["3"], ["4"]]);
    expect(run.loadedCount).toBe(4);
    expect(run.exhausted).toBe(true);
    expect(run.cursorId).toBeNull();
  });

  test("fetchMore is a no-op while another fetch is in flight", async () => {
    const tab = useEditor.getState().openEditorTab("conn-1");
    liveStreaming(tab.id, { prefetching: true });
    await useEditor.getState().fetchMore(tab.id);
    expect(queryFetchPageMock).not.toHaveBeenCalled();
  });

  test("fetchMore is a no-op when exhausted", async () => {
    const tab = useEditor.getState().openEditorTab("conn-1");
    liveStreaming(tab.id, { exhausted: true, cursorId: null });
    await useEditor.getState().fetchMore(tab.id);
    expect(queryFetchPageMock).not.toHaveBeenCalled();
  });

  test("cancelRun: streaming preserves rows + fires queryCancel + freezes as exhausted", () => {
    // fix: cancel during streaming must NOT drop to a "cancelled"
    // empty panel — that wiped the partial rows already on screen. Instead
    // the rows stay, the cursor is closed on the backend, and the result is
    // marked exhausted so the loading/Cancel UI hides.
    queryCancelMock.mockResolvedValueOnce(undefined);
    const tab = useEditor.getState().openEditorTab("conn-1");
    liveStreaming(tab.id);
    useEditor.getState().cancelRun(tab.id);
    const run = useEditor.getState().runStates.get(tab.id);
    if (run?.status !== "streaming") throw new Error("expected streaming");
    expect(run.exhausted).toBe(true);
    expect(run.cursorId).toBeNull();
    expect(run.prefetching).toBe(false);
    expect(run.rows).toEqual([["1"], ["2"]]);
    expect(queryCancelMock).toHaveBeenCalledWith("c_x");
  });

  test("cancelRun: opening → cancelled (no rows yet to preserve)", () => {
    const tab = useEditor.getState().openEditorTab("conn-1");
    useEditor.setState({
      runStates: new Map([[tab.id, { status: "opening", startedAt: 1, cancelable: true }]]),
    });
    useEditor.getState().cancelRun(tab.id);
    expect(useEditor.getState().runStates.get(tab.id)?.status).toBe("cancelled");
  });

  test("setSort sorts rows asc then desc", () => {
    const tab = useEditor.getState().openEditorTab("conn-1");
    useEditor.setState({
      runStates: new Map([
        [
          tab.id,
          {
            status: "streaming",
            cursorId: null,
            columns: [{ name: "n", typeName: "int4", isNumeric: true }],
            rows: [["3"], ["1"], ["2"]],
            loadedCount: 3,
            exhausted: true,
            durationMs: 0,
            prefetching: false,
            affectedRows: null,
            statusMessage: "",
            sort: null,
            columnWidths: new Map(),
            columnOrder: [0],
          },
        ],
      ]),
    });
    useEditor.getState().setSort(tab.id, 0, "asc");
    let run = useEditor.getState().runStates.get(tab.id);
    if (run?.status !== "streaming") throw new Error();
    expect(run.rows.map((r) => r[0])).toEqual(["1", "2", "3"]);
    useEditor.getState().setSort(tab.id, 0, "desc");
    run = useEditor.getState().runStates.get(tab.id);
    if (run?.status !== "streaming") throw new Error();
    expect(run.rows.map((r) => r[0])).toEqual(["3", "2", "1"]);
  });

  test("closeTab fires queryCloseCursor on streaming with live cursorId", async () => {
    const tab = useEditor.getState().openEditorTab("conn-1");
    liveStreaming(tab.id);
    await useEditor.getState().closeTab(tab.id);
    expect(queryCloseCursorMock).toHaveBeenCalledWith("c_x");
  });

  test("setTabConnection fires queryCloseCursor on prev cursor", () => {
    queryCloseCursorMock.mockReset();
    queryCloseCursorMock.mockResolvedValue(undefined);
    const tab = useEditor.getState().openEditorTab("conn-1");
    liveStreaming(tab.id);
    useEditor.getState().setTabConnection(tab.id, "conn-2");
    expect(queryCloseCursorMock).toHaveBeenCalledWith("c_x");
  });
});

describe("switchTab", () => {
  test("only switches to known ids; persists to localStorage", () => {
    const a = useEditor.getState().openEditorTab(null);
    const b = useEditor.getState().openEditorTab(null);
    useEditor.getState().switchTab(a.id);
    expect(useEditor.getState().activeTabId).toBe(a.id);
    expect(window.localStorage.getItem("ide99:editor.activeTabId")).toBe(a.id);

    useEditor.getState().switchTab("ghost");
    expect(useEditor.getState().activeTabId).toBe(a.id);
    // sanity: b still exists
    expect(useEditor.getState().tabs.map((t) => t.id)).toContain(b.id);
  });
});

describe("openHistoryTab", () => {
  test("creates a new history tab and activates it when none exists", () => {
    const tab = useEditor.getState().openHistoryTab();
    const state = useEditor.getState();
    expect(tab.kind).toBe("history");
    expect(state.tabs).toEqual([tab]);
    expect(state.activeTabId).toBe(tab.id);
  });

  test("activates the existing history tab on second call (does not duplicate)", () => {
    const first = useEditor.getState().openHistoryTab();
    useEditor.getState().openEditorTab(null); // intermediate switch away
    const second = useEditor.getState().openHistoryTab();
    expect(second.id).toBe(first.id);
    const historyTabs = useEditor.getState().tabs.filter((t) => t.kind === "history");
    expect(historyTabs).toHaveLength(1);
    expect(useEditor.getState().activeTabId).toBe(first.id);
  });

  test("history tab opening does NOT call tabsSave (session-scope only)", () => {
    tabsSaveMock.mockClear();
    useEditor.getState().openHistoryTab();
    expect(tabsSaveMock).not.toHaveBeenCalled();
  });
});

describe("openEditorTab with prefillSql", () => {
  test("prefills tab content with the supplied SQL", () => {
    const tab = useEditor.getState().openEditorTab("conn-1", { prefillSql: "SELECT 42" });
    if (tab.kind !== "editor") throw new Error("expected editor kind");
    expect(tab.content).toBe("SELECT 42");
    expect(tab.connectionId).toBe("conn-1");
  });
});

describe("openRecentPlansTab", () => {
  test("openRecentPlansTab is singleton", () => {
    const a = useEditor.getState().openRecentPlansTab();
    const b = useEditor.getState().openRecentPlansTab();
    expect(a.id).toBe(b.id);
    expect(useEditor.getState().tabs.filter((t) => t.kind === "recent-plans")).toHaveLength(1);
  });
});

describe("openPlanDiff ", () => {
  test("recent×recent pair persists via tabsSave; singleton id stable on (A,B)/(B,A)", () => {
    const tab1 = useEditor
      .getState()
      .openPlanDiff({ kind: "recent", recentPlanId: "rA" }, { kind: "recent", recentPlanId: "rB" });
    expect(tabsSaveMock).toHaveBeenCalledTimes(1);
    expect(tabsSaveMock.mock.calls[0][0].kind).toBe("plan-diff");
    expect(tabsSaveMock.mock.calls[0][0].name).toBe("rA|rB");

    // Reverse order should land on the SAME singleton tab (id is commutative).
    const tab2 = useEditor
      .getState()
      .openPlanDiff({ kind: "recent", recentPlanId: "rB" }, { kind: "recent", recentPlanId: "rA" });
    expect(tab2.id).toBe(tab1.id);
    expect(useEditor.getState().tabs.filter((t) => t.kind === "plan-diff")).toHaveLength(1);
  });

  test("runtime side does NOT persist", () => {
    useEditor.getState().openPlanDiff(      { kind: "recent", recentPlanId: "rA" },
      {
        kind: "runtime",
        planJson: [{ Plan: { "Node Type": "Result" } }],
        sql: "SELECT 1",
        connectionId: "c1",
        executedAt: new Date().toISOString(),
        durationMs: 1,
        mode: "explain",
        optionsJson: "{}",
      },
);
    expect(tabsSaveMock).not.toHaveBeenCalled();
  });

  test("swapPlanDiff swaps left/right; id unchanged", () => {
    const tab = useEditor
      .getState()
      .openPlanDiff({ kind: "recent", recentPlanId: "rA" }, { kind: "recent", recentPlanId: "rB" });
    useEditor.getState().swapPlanDiff(tab.id);
    const after = useEditor.getState().tabs.find((t) => t.id === tab.id);
    if (!after || after.kind !== "plan-diff") throw new Error("missing");
    expect(after.left.kind === "recent" && after.left.recentPlanId).toBe("rB");
    expect(after.right.kind === "recent" && after.right.recentPlanId).toBe("rA");
  });
});

describe("openErdTab ", () => {
  test("creates an ErdTab keyed by connection id and activates it", () => {
    const tab = useEditor.getState().openErdTab("conn-1");
    expect(tab.kind).toBe("erd");
    expect(tab.id).toBe("erd-conn-1");
    if (tab.kind !== "erd") throw new Error("expected erd kind");
    expect(tab.connectionId).toBe("conn-1");
    expect(tab.schemas).toBeUndefined();
    expect(useEditor.getState().activeTabId).toBe("erd-conn-1");
  });

  test("is a singleton per connection — second call switches focus, no duplicate tab", () => {
    useEditor.getState().openErdTab("conn-1");
    useEditor.getState().openEditorTab(null); // intermediate switch away
    useEditor.getState().openErdTab("conn-1");
    const erdTabs = useEditor.getState().tabs.filter((t) => t.kind === "erd");
    expect(erdTabs).toHaveLength(1);
    expect(useEditor.getState().activeTabId).toBe("erd-conn-1");
  });

  test("supports an optional schemas filter on creation", () => {
    const tab = useEditor.getState().openErdTab("conn-2", { schemas: ["public"] });
    if (tab.kind !== "erd") throw new Error("expected erd kind");
    expect(tab.schemas).toEqual(["public"]);
  });

  test("ERD tab opening does NOT call tabsSave (session-scope only)", () => {
    tabsSaveMock.mockClear();
    useEditor.getState().openErdTab("conn-3");
    expect(tabsSaveMock).not.toHaveBeenCalled();
  });

  test("setErdTabSchemas updates the filter on an existing erd tab", () => {
    const tab = useEditor.getState().openErdTab("conn-4");
    useEditor.getState().setErdTabSchemas(tab.id, ["public", "app"]);
    const after = useEditor.getState().tabs.find((t) => t.id === tab.id);
    if (!after || after.kind !== "erd") throw new Error("expected erd kind");
    expect(after.schemas).toEqual(["public", "app"]);
  });
});

describe("hydrate restores recent×recent plan-diff tab ", () => {
  test("rowToTab rebuilds plan-diff with both recent sides", async () => {
    tabsListMock.mockResolvedValueOnce([
      {
        id: "plan-diff-r:rA-r:rB",
        kind: "plan-diff",
        name: "rA|rB",
        content: "",
        connectionId: null,
        nodeKey: null,
        cursorLine: 1,
        cursorCol: 1,
        createdAt: "2026-04-29T10:00:00.000Z",
        updatedAt: "2026-04-29T10:00:00.000Z",
      },
    ]);
    await useEditor.getState().hydrateFromSqlite();
    const tabs = useEditor.getState().tabs;
    expect(tabs).toHaveLength(1);
    const t = tabs[0];
    if (t.kind !== "plan-diff") throw new Error("expected plan-diff kind");
    expect(t.left.kind === "recent" && t.left.recentPlanId).toBe("rA");
    expect(t.right.kind === "recent" && t.right.recentPlanId).toBe("rB");
  });
});

describe("S23 — openObjectEditor", () => {
  test("creates a per-target singleton tab keyed on (connId, kind, schema, name, mode)", () => {
    const initial = useEditor.getState().tabs.length;
    const t = useEditor.getState().openObjectEditor({
      connectionId: "c-s23",
      objectKind: "table",
      mode: "edit",
      schema: "public",
      name: "users",
    });
    expect(t.id).toBe("object-editor-c-s23-table-public-users-edit");
    expect(t.kind).toBe("object-editor");
    expect(t.target.objectKind).toBe("table");
    expect(t.target.mode).toBe("edit");
    expect(t.target.schema).toBe("public");
    expect(t.target.name).toBe("users");
    const after = useEditor.getState().tabs.length;
    expect(after).toBe(initial + 1);
  });

  test("re-opening the same target focuses the existing tab (no duplicate)", () => {
    const tabs0 = useEditor.getState().tabs.length;
    useEditor.getState().openObjectEditor({
      connectionId: "c-s23-dup",
      objectKind: "view",
      mode: "edit",
      schema: "public",
      name: "v_users",
    });
    const tabs1 = useEditor.getState().tabs.length;
    useEditor.getState().openObjectEditor({
      connectionId: "c-s23-dup",
      objectKind: "view",
      mode: "edit",
      schema: "public",
      name: "v_users",
    });
    const tabs2 = useEditor.getState().tabs.length;
    expect(tabs1).toBe(tabs0 + 1);
    expect(tabs2).toBe(tabs1); // re-open is idempotent
  });

  test("create-mode uses _new placeholder in the id", () => {
    const t = useEditor.getState().openObjectEditor({
      connectionId: "c-s23-create",
      objectKind: "sequence",
      mode: "create",
      schema: "public",
    });
    expect(t.id).toBe("object-editor-c-s23-create-sequence-public-_new-create");
    expect(t.target.name).toBeUndefined();
  });
});

describe("S24 — function/procedure/trigger objectKind", () => {
  test("openObjectEditor accepts function/procedure/trigger objectKinds", () => {
    const f = useEditor.getState().openObjectEditor({
      connectionId: "c-s24",
      objectKind: "function",
      mode: "create",
      schema: "public",
    });
    expect(f.target.objectKind).toBe("function");

    const p = useEditor.getState().openObjectEditor({
      connectionId: "c-s24",
      objectKind: "procedure",
      mode: "create",
      schema: "public",
    });
    expect(p.target.objectKind).toBe("procedure");

    const t = useEditor.getState().openObjectEditor({
      connectionId: "c-s24",
      objectKind: "trigger",
      mode: "create",
      schema: "public",
    });
    expect(t.target.objectKind).toBe("trigger");
  });
});
