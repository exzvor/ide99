import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { useEditor } from "../editor/store";
import { HealthPane } from "./HealthPane";
import { useHealth } from "./store";

vi.mock("../../lib/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../lib/tauri")>("../../lib/tauri");
  function ok<T>(data: T): { ok: true; data: T } {
    return { ok: true, data };
  }
  return {
    ...actual,
    healthDbSize: vi.fn().mockResolvedValue(      ok({
        bytes: 1024,
        pretty: "1 kB",
        growth7dBytes: 0,
        growth7dPct: 0,
        sparklinePoints: [1024],
      }),
),
    healthBloat: vi.fn().mockResolvedValue(ok({ rows: [] })),
    healthSlowQueries: vi.fn().mockResolvedValue(ok({ rows: [] })),
    healthMissingIndexes: vi.fn().mockResolvedValue(ok({ rows: [] })),
    healthUnusedIndexes: vi.fn().mockResolvedValue(ok({ rows: [] })),
    healthCacheHit: vi.fn().mockResolvedValue(ok({ ratioPct: 99 })),
    healthActiveConnections: vi
      .fn()
      .mockResolvedValue(ok({ current: 1, max: 100, byState: { active: 1 } })),
    healthLongRunning: vi.fn().mockResolvedValue(ok({ rows: [] })),
    healthVacuumStatus: vi.fn().mockResolvedValue(ok({ rows: [] })),
    healthReplicationLag: vi.fn().mockResolvedValue(ok({ state: "no_replicas", slots: [] })),
    healthSnapshotsSave: vi.fn().mockResolvedValue(undefined),
  };
});

const REAL_REFRESH_ALL = useHealth.getState().refreshAll;
const REAL_REFRESH_ONE = useHealth.getState().refreshOne;
const REAL_SET_INTERVAL = useHealth.getState().setRefreshInterval;

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  useHealth.setState({
    byConn: new Map(),
    refreshAll: REAL_REFRESH_ALL,
    refreshOne: REAL_REFRESH_ONE,
    setRefreshInterval: REAL_SET_INTERVAL,
  });
  useEditor.setState({ ...useEditor.getState(), activeTabId: "health-c1" });
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("HealthPane", () => {
  it("mounts → shows 10 cards in loading then resolves to mixed states", async () => {
    render(<HealthPane connId="c1" />);
    expect(screen.getByTestId("health-pane")).toBeTruthy();
    // 10 card shells render
    expect(screen.getAllByTestId(/^health-card-/).length).toBeGreaterThanOrEqual(10);

    await vi.waitFor(() => {
      // db_size resolves to ready (has body); replication_lag → empty
      expect(screen.getByTestId("health-card-db_size-body")).toBeTruthy();
      expect(screen.getByTestId("health-card-replication_lag-empty")).toBeTruthy();
    });
  });

  it("renders skeletons before any IPC settles (initial cards map)", () => {
    // Pre-seed slice with explicit loading so we can assert before ticks resolve.
    useHealth.setState({
      byConn: new Map([
        [
          "c1",
          {
            cards: new Map([
              ["db_size", { status: "loading" }],
              ["bloat", { status: "loading" }],
              ["slow_queries", { status: "loading" }],
              ["missing_indexes", { status: "loading" }],
              ["unused_indexes", { status: "loading" }],
              ["cache_hit", { status: "loading" }],
              ["active_connections", { status: "loading" }],
              ["long_running", { status: "loading" }],
              ["vacuum_status", { status: "loading" }],
              ["replication_lag", { status: "loading" }],
            ]),
            lastRefreshAt: null,
            refreshInProgress: true,
            refreshIntervalMs: null,
          },
        ],
      ]),
    });
    render(<HealthPane connId="c1" />);
    expect(screen.getAllByTestId(/-skeleton$/).length).toBeGreaterThanOrEqual(10);
  });

  it("auto-refresh interval calls refreshAll on tick", async () => {
    const refreshAll = vi.fn().mockResolvedValue(undefined);
    useHealth.setState({ ...useHealth.getState(), refreshAll });
    // pre-seed slice with a 5s interval
    useHealth.setState({
      byConn: new Map([
        [
          "c1",
          {
            cards: new Map(),
            lastRefreshAt: null,
            refreshInProgress: false,
            refreshIntervalMs: 5_000,
          },
        ],
      ]),
    });
    render(<HealthPane connId="c1" />);
    // first-mount fires once
    expect(refreshAll).toHaveBeenCalledWith("c1");
    refreshAll.mockClear();
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(refreshAll).toHaveBeenCalledWith("c1");
  });

  it("Cmd+R fires refreshAll only when this tab is active", async () => {
    const refreshAll = vi.fn().mockResolvedValue(undefined);
    useHealth.setState({ ...useHealth.getState(), refreshAll });
    useEditor.setState({ ...useEditor.getState(), activeTabId: "health-c1" });
    render(<HealthPane connId="c1" />);
    refreshAll.mockClear();
    fireEvent.keyDown(window, { key: "r", metaKey: true });
    expect(refreshAll).toHaveBeenCalledWith("c1");
  });

  it("Cmd+R is a no-op when active tab is something else", async () => {
    const refreshAll = vi.fn().mockResolvedValue(undefined);
    useHealth.setState({ ...useHealth.getState(), refreshAll });
    useEditor.setState({ ...useEditor.getState(), activeTabId: "tab-other" });
    render(<HealthPane connId="c1" />);
    refreshAll.mockClear();
    fireEvent.keyDown(window, { key: "r", metaKey: true });
    expect(refreshAll).not.toHaveBeenCalled();
  });

  it("visibilitychange hidden → clears interval; visible → immediate refresh", async () => {
    const refreshAll = vi.fn().mockResolvedValue(undefined);
    useHealth.setState({ ...useHealth.getState(), refreshAll });
    useHealth.setState({
      byConn: new Map([
        [
          "c1",
          {
            cards: new Map(),
            lastRefreshAt: null,
            refreshInProgress: false,
            refreshIntervalMs: 5_000,
          },
        ],
      ]),
    });
    render(<HealthPane connId="c1" />);
    refreshAll.mockClear();

    // Hide the document and dispatch visibilitychange → interval cleared.
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    act(() => {
      vi.advanceTimersByTime(15_000);
    });
    // No tick because we cleared the interval.
    expect(refreshAll).not.toHaveBeenCalled();

    // Now resume → expect immediate refresh + interval re-armed.
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => {
      expect(refreshAll).toHaveBeenCalledWith("c1");
    });
  });
});
