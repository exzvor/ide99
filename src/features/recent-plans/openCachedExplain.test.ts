import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type RecentPlanRow, recentPlansGet } from "../../lib/tauri";
import { useConnections } from "../connections/store";
import { __testing, useEditor } from "../editor/store";

vi.mock("../../lib/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../lib/tauri")>("../../lib/tauri");
  return {
    ...actual,
    tabsList: vi.fn().mockResolvedValue([]),
    tabsSave: vi.fn().mockResolvedValue(undefined),
    tabsDelete: vi.fn().mockResolvedValue(undefined),
    queryExplain: vi.fn(),
    queryExplainCancel: vi.fn(),
    recentPlansGet: vi.fn(),
  };
});

const sampleRow: RecentPlanRow = {
  id: "row-1",
  connectionId: "c1",
  connectionName: "test",
  sql: "SELECT 1",
  planJson: JSON.stringify([{ Plan: { "Node Type": "Result" } }]),
  executedAt: "2026-04-28T19:00:00Z",
  durationMs: 12,
  totalCost: 1.0,
  mode: "explain",
  optionsJson: JSON.stringify({ mode: "explain", verbose: false, wal: false, timing: false }),
  involvedTables: [],
  pinned: false,
};

beforeEach(() => __testing.reset());
afterEach(() => vi.clearAllMocks());

describe("openCachedExplain", () => {
  it("spawns ExplainTab id `explain-cached-${row.id}` with runState ready inline", () => {
    const tab = useEditor.getState().openCachedExplain(sampleRow);
    expect(tab.id).toBe("explain-cached-row-1");
    expect(tab.kind).toBe("explain");
    expect(tab.sourceTabId).toBeNull();
    expect(tab.cachedRecentPlanId).toBe("row-1");
    const rs = useEditor.getState().explainRunStates.get(tab.id);
    expect(rs?.status).toBe("ready");
    if (rs?.status === "ready") {
      expect(rs.plan).toEqual([{ Plan: { "Node Type": "Result" } }]);
      expect(rs.durationMs).toBe(12);
    }
  });

  it("re-opens the same row → same tab id (singleton)", () => {
    const a = useEditor.getState().openCachedExplain(sampleRow);
    const b = useEditor.getState().openCachedExplain(sampleRow);
    expect(a.id).toBe(b.id);
    expect(useEditor.getState().tabs.filter((t) => t.id === a.id)).toHaveLength(1);
  });
});

describe("openEditorFromRecent", () => {
  beforeEach(() => {
    __testing.reset();
    useConnections.setState({
      connections: [
        {
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
        },
      ],
      selectedId: null,
      openCreateForm: () => {},
      closeCreateForm: () => {},
    } as unknown as ReturnType<typeof useConnections.getState>);
  });

  it("opens an editor tab with prefillSql + connId when conn alive", async () => {
    vi.mocked(recentPlansGet).mockResolvedValueOnce({ ...sampleRow, sql: "SELECT 42" });
    await useEditor.getState().openEditorFromRecent("row-1");
    const editorTab = useEditor.getState().tabs.find((t) => t.kind === "editor");
    expect(editorTab).toBeDefined();
    if (editorTab && editorTab.kind === "editor") {
      expect(editorTab.content).toBe("SELECT 42");
      expect(editorTab.connectionId).toBe("c1");
    }
  });

  it("opens an editor tab WITHOUT connId when conn deleted", async () => {
    vi.mocked(recentPlansGet).mockResolvedValueOnce({
      ...sampleRow,
      connectionId: "c-gone",
      connectionName: "ghost",
      sql: "SELECT 99",
    });
    await useEditor.getState().openEditorFromRecent("row-1");
    const editorTab = useEditor.getState().tabs.find((t) => t.kind === "editor");
    expect(editorTab).toBeDefined();
    if (editorTab && editorTab.kind === "editor") {
      expect(editorTab.content).toBe("SELECT 99");
      expect(editorTab.connectionId).toBeNull();
    }
  });

  it("no-op when row no longer exists", async () => {
    vi.mocked(recentPlansGet).mockResolvedValueOnce(null);
    await useEditor.getState().openEditorFromRecent("row-1");
    expect(useEditor.getState().tabs.some((t) => t.kind === "editor")).toBe(false);
  });
});
