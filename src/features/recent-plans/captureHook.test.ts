import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recentPlansSave } from "../../lib/tauri";
import { useConnections } from "../connections/store";
import { __testing, useEditor } from "../editor/store";

vi.mock("../../lib/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../lib/tauri")>("../../lib/tauri");
  return {
    ...actual,
    queryExplain: vi.fn().mockResolvedValue({
      planJson: [{ Plan: { "Node Type": "Result" } }],
      durationMs: 5,
      statusMessage: "EXPLAIN · 5ms",
    }),
    recentPlansSave: vi.fn().mockResolvedValue("saved-id"),
    tabsList: vi.fn().mockResolvedValue([]),
    tabsSave: vi.fn().mockResolvedValue(undefined),
    tabsDelete: vi.fn().mockResolvedValue(undefined),
  };
});

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
  } as unknown as ReturnType<typeof useConnections.getState>);
});

afterEach(() => vi.clearAllMocks());

describe("runExplain capture hook", () => {
  async function runOnce() {
    const tab = useEditor.getState().openEditorTab("c1");
    useEditor.setState({
      tabs: useEditor
        .getState()
        .tabs.map((t) =>
          t.id === tab.id && t.kind === "editor" ? { ...t, content: "SELECT 1" } : t,
),
    });
    await useEditor.getState().runExplain(tab.id, "explain");
  }

  it("calls recentPlansSave on success", async () => {
    await runOnce();
    expect(vi.mocked(recentPlansSave)).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(recentPlansSave).mock.calls[0][0];
    expect(arg.connectionId).toBe("c1");
    expect(arg.sql).toBe("SELECT 1");
    expect(arg.mode).toBe("explain");
  });

  it("skips when connection has excludeFromRecentPlans=true", async () => {
    useConnections.setState({
      connections: [
        {
          ...useConnections.getState().connections[0],
          excludeFromRecentPlans: true,
        },
      ],
    } as unknown as ReturnType<typeof useConnections.getState>);
    await runOnce();
    expect(vi.mocked(recentPlansSave)).not.toHaveBeenCalled();
  });

  it("does not break runExplain when capture throws", async () => {
    vi.mocked(recentPlansSave).mockRejectedValueOnce(new Error("disk full"));
    await runOnce();
    // EXPLAIN tab still ready — capture failure must not break UX.
    const explain = useEditor.getState().tabs.find((t) => t.kind === "explain");
    expect(explain).toBeDefined();
    if (explain) {
      const rs = useEditor.getState().explainRunStates.get(explain.id);
      expect(rs?.status).toBe("ready");
    }
  });
});
