import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Connection } from "../../../lib/tauri";
import * as tauri from "../../../lib/tauri";
import { useConnections } from "../../connections/store";
import { __testing, useEditor } from "../store";

vi.mock("../../../lib/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/tauri")>("../../../lib/tauri");
  return {
    ...actual,
    queryExplain: vi.fn(),
    queryExplainCancel: vi.fn().mockResolvedValue(undefined),
    queryExplainCost: vi.fn().mockResolvedValue(50),
    tabsList: vi.fn().mockResolvedValue([]),
    tabsSave: vi.fn().mockResolvedValue(undefined),
    tabsDelete: vi.fn().mockResolvedValue(undefined),
  };
});

const mockedQueryExplain = vi.mocked(tauri.queryExplain);

const localConn: Connection = {
  id: "c1",
  name: "test",
  host: "h",
  port: 5432,
  database: "d",
  username: "u",
  sslMode: "disable",
  hasPassword: false,
  createdAt: "",
  updatedAt: "",
  lastTestedAt: null,
  lastTestOk: null,
  excludeFromHistory: false,
  excludeFromRecentPlans: false,
  environment: "local",
  readOnly: false,
  slowQueryWarning: false,
  confirmDestructive: false,
};

beforeEach(() => {
  __testing.reset();
  useConnections.setState({
    connections: [localConn],
    selectedId: null,
    formMode: { type: "closed" },
    loading: false,
    error: null,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

/** Helper — stamps `content` on the editor tab without triggering setContent
 * (which would kick the debounce timer + dirty bookkeeping the tests don't
 * care about). */
function setTabContent(tabId: string, content: string): void {
  useEditor.setState({
    tabs: useEditor
      .getState()
      .tabs.map((t) => (t.id === tabId && t.kind === "editor" ? { ...t, content } : t)),
  });
}

describe("runExplain", () => {
  it("creates a singleton explain tab and lands in `ready` with the plan", async () => {
    mockedQueryExplain.mockResolvedValueOnce({
      planJson: [{ Plan: { "Node Type": "Seq Scan" } }],
      durationMs: 12,
      statusMessage: "EXPLAIN · 12ms",
    });
    const tab = useEditor.getState().openEditorTab("c1");
    setTabContent(tab.id, "SELECT 1");

    await useEditor.getState().runExplain(tab.id, "explain");

    const explainId = `explain-${tab.id}`;
    const explainTab = useEditor.getState().tabs.find((t) => t.id === explainId);
    expect(explainTab).toBeDefined();
    expect(explainTab?.kind).toBe("explain");

    const rs = useEditor.getState().explainRunStates.get(explainId);
    expect(rs?.status).toBe("ready");
    if (rs?.status === "ready") {
      expect(rs.plan).toEqual([{ Plan: { "Node Type": "Seq Scan" } }]);
      expect(rs.durationMs).toBe(12);
      expect(rs.statusMessage).toBe("EXPLAIN · 12ms");
    }
  });

  it("running it twice reuses the same explain tab id (mode swap)", async () => {
    mockedQueryExplain.mockResolvedValue({
      planJson: [],
      durationMs: 1,
      statusMessage: "",
    });
    const tab = useEditor.getState().openEditorTab("c1");
    setTabContent(tab.id, "SELECT 1");

    await useEditor.getState().runExplain(tab.id, "explain");
    const ids1 = useEditor
      .getState()
      .tabs.filter((t) => t.kind === "explain")
      .map((t) => t.id);

    await useEditor.getState().runExplain(tab.id, "analyze");
    const ids2 = useEditor
      .getState()
      .tabs.filter((t) => t.kind === "explain")
      .map((t) => t.id);

    expect(ids1).toEqual(ids2);
    expect(ids2).toEqual([`explain-${tab.id}`]);
  });

  it("no_connection error when the source tab has no connection", async () => {
    const tab = useEditor.getState().openEditorTab(null);
    setTabContent(tab.id, "SELECT 1");

    await useEditor.getState().runExplain(tab.id, "explain");

    const rs = useEditor.getState().explainRunStates.get(`explain-${tab.id}`);
    expect(rs?.status).toBe("error");
    if (rs?.status === "error") expect(rs.code).toBe("no_connection");
    expect(mockedQueryExplain).not.toHaveBeenCalled();
  });

  it("does not call backend when SQL is empty (whitespace-only tab content)", async () => {
    const tab = useEditor.getState().openEditorTab("c1");
    setTabContent(tab.id, "   \n  ");

    await useEditor.getState().runExplain(tab.id, "explain");

    expect(mockedQueryExplain).not.toHaveBeenCalled();
    // Singleton tab not even created — the SQL guard fires before the
    // get-or-create branch.
    expect(useEditor.getState().tabs.some((t) => t.id === `explain-${tab.id}`)).toBe(false);
  });

  it("closeTab cascade removes the explain spouse and its runState", async () => {
    mockedQueryExplain.mockResolvedValue({
      planJson: [],
      durationMs: 1,
      statusMessage: "",
    });
    const tab = useEditor.getState().openEditorTab("c1");
    setTabContent(tab.id, "SELECT 1");

    await useEditor.getState().runExplain(tab.id, "explain");
    expect(useEditor.getState().tabs.some((t) => t.id === `explain-${tab.id}`)).toBe(true);
    expect(useEditor.getState().explainRunStates.has(`explain-${tab.id}`)).toBe(true);

    await useEditor.getState().closeTab(tab.id);

    expect(useEditor.getState().tabs.some((t) => t.id === `explain-${tab.id}`)).toBe(false);
    expect(useEditor.getState().explainRunStates.has(`explain-${tab.id}`)).toBe(false);
  });
});
