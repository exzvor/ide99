import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLiveOps } from "./store";

vi.mock("../../lib/tauri", async (orig) => {
  const real = await orig<typeof import("../../lib/tauri")>();
  return {
    ...real,
    liveOpsSessions: vi.fn().mockResolvedValue({
      ok: true,
      data: {
        sessions: [],
        blockingEdges: [],
        fetchedAt: new Date().toISOString(),
        truncated: false,
      },
    }),
    liveOpsSlow: vi.fn().mockResolvedValue({
      ok: true,
      data: {
        rows: [],
        sortBy: "meanExecTime",
        fetchedAt: new Date().toISOString(),
      },
    }),
    liveOpsReplication: vi.fn().mockResolvedValue({
      ok: true,
      data: {
        slots: [],
        publications: [],
        subscriptions: [],
        fetchedAt: new Date().toISOString(),
      },
    }),
  };
});

describe("useLiveOps", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useLiveOps.setState({ byConn: new Map() });
  });
  afterEach(() => {
    useLiveOps.getState().clearConn("c1");
  });

  it("ensureConn loads prefs and seeds idle slice", () => {
    useLiveOps.getState().ensureConn("c1", "local");
    const slice = useLiveOps.getState().byConn.get("c1");
    expect(slice).toBeDefined();
    expect(slice?.activeSubTab).toBe("sessions");
    expect(slice?.sessions.data.status).toBe("idle");
  });

  it("setSessionsMode updates the slice", () => {
    useLiveOps.getState().ensureConn("c1", "local");
    useLiveOps.getState().setSessionsMode("c1", "blocked");
    expect(useLiveOps.getState().byConn.get("c1")?.sessions.mode).toBe("blocked");
  });

  it("setSessionsView updates the slice and persists", () => {
    useLiveOps.getState().ensureConn("c1", "local");
    expect(useLiveOps.getState().byConn.get("c1")?.sessions.view).toBe("dag");
    useLiveOps.getState().setSessionsView("c1", "list");
    expect(useLiveOps.getState().byConn.get("c1")?.sessions.view).toBe("list");
  });

  it("setSortBy updates the slice", () => {
    useLiveOps.getState().ensureConn("c1", "local");
    useLiveOps.getState().setSortBy("c1", "calls");
    expect(useLiveOps.getState().byConn.get("c1")?.slow.sortBy).toBe("calls");
  });

  it("setShowEmpty updates the slice", () => {
    useLiveOps.getState().ensureConn("c1", "local");
    useLiveOps.getState().setShowEmpty("c1", true);
    expect(useLiveOps.getState().byConn.get("c1")?.replication.showEmpty).toBe(true);
  });

  it("refreshNow dispatches the active sub-tab IPC and stores ready data", async () => {
    const { liveOpsSessions } = await import("../../lib/tauri");
    useLiveOps.getState().ensureConn("c1", "local");
    await useLiveOps.getState().refreshNow("c1");
    // Default sessions mode is "all" so the DAG can also surface unrelated
    // active backends (matches the post-S14 sessions redesign).
    expect(liveOpsSessions).toHaveBeenCalledWith("c1", "all");
    expect(useLiveOps.getState().byConn.get("c1")?.sessions.data.status).toBe("ready");
  });

  it("setActiveSubTab + refreshNow targets the new sub-tab", async () => {
    const { liveOpsSlow } = await import("../../lib/tauri");
    useLiveOps.getState().ensureConn("c1", "local");
    useLiveOps.getState().setActiveSubTab("c1", "slow");
    await useLiveOps.getState().refreshNow("c1");
    expect(liveOpsSlow).toHaveBeenCalledWith("c1", "meanExecTime");
  });

  it("openContextMenu + closeContextMenu mutate the menu slot", () => {
    useLiveOps.getState().ensureConn("c1", "local");
    useLiveOps.getState().openContextMenu("c1", 100, 200, {
      pid: 12345,
      query: "SELECT 1",
      state: "active",
      username: "u",
      applicationName: null,
      clientAddr: null,
      queryStart: null,
      durationSeconds: null,
      waitEventType: null,
      waitEvent: null,
      backendType: "client backend",
    });
    expect(useLiveOps.getState().byConn.get("c1")?.contextMenu.open).toBe(true);
    useLiveOps.getState().closeContextMenu("c1");
    expect(useLiveOps.getState().byConn.get("c1")?.contextMenu.open).toBe(false);
  });

  it("clearConn removes the slice and prefs", () => {
    useLiveOps.getState().ensureConn("c1", "local");
    useLiveOps.getState().clearConn("c1");
    expect(useLiveOps.getState().byConn.get("c1")).toBeUndefined();
  });

  it("startPolling subscribes to useHealthActions and refreshes after killPid", async () => {
    const { useHealthActions } = await import("../health/actions/store");
    const { liveOpsSessions } = await import("../../lib/tauri");
    useLiveOps.getState().ensureConn("c1", "local");
    // Start polling with Off interval so no setInterval ticks; only the phase
    // subscription is active.
    useLiveOps.getState().setIntervalMs("c1", null);
    useLiveOps.getState().startPolling("c1");

    // Simulate a S13 killPid run cycle: idle → running(killPid) → idle
    const fakeConn = {} as never;
    useHealthActions.setState({
      phase: {
        kind: "running",
        target: { kind: "killPid", pid: 999, terminate: false },
        conn: fakeConn,
        actionId: null,
        pid: 999,
        progress: null,
      },
    });
    (liveOpsSessions as ReturnType<typeof vi.fn>).mockClear();
    useHealthActions.setState({ phase: { kind: "idle" } });

    // Subscribe is synchronous; refreshNow is async-fired.
    await Promise.resolve();
    expect(liveOpsSessions).toHaveBeenCalled();
    useLiveOps.getState().clearConn("c1");
  });
});
