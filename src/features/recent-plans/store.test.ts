import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type RecentPlanRow,
  recentPlansDelete,
  recentPlansSearch,
  recentPlansSetPinned,
} from "../../lib/tauri";
import { useRecentPlans } from "./store";

vi.mock("../../lib/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../lib/tauri")>("../../lib/tauri");
  return {
    ...actual,
    recentPlansSearch: vi.fn(),
    recentPlansSetPinned: vi.fn().mockResolvedValue(undefined),
    recentPlansDelete: vi.fn().mockResolvedValue(undefined),
  };
});

const fakeRow = (id: string, over: Partial<RecentPlanRow> = {}): RecentPlanRow => ({
  id,
  connectionId: "c1",
  connectionName: "t",
  sql: `SELECT ${id}`,
  planJson: "[{}]",
  executedAt: "2026-04-28T19:00:00Z",
  durationMs: 1,
  totalCost: null,
  mode: "explain",
  optionsJson: "{}",
  involvedTables: [],
  pinned: false,
  ...over,
});

beforeEach(() => useRecentPlans.getState().reset());
afterEach(() => vi.clearAllMocks());

describe("useRecentPlans", () => {
  it("refresh fetches with current filter", async () => {
    vi.mocked(recentPlansSearch).mockResolvedValueOnce({
      rows: [fakeRow("a")],
      total: 1,
    });
    await useRecentPlans.getState().refresh();
    expect(useRecentPlans.getState().rows).toHaveLength(1);
    expect(useRecentPlans.getState().total).toBe(1);
    expect(useRecentPlans.getState().loading).toBe(false);
  });

  it("loadMore appends with offset += limit", async () => {
    vi.mocked(recentPlansSearch)
      .mockResolvedValueOnce({ rows: [fakeRow("a"), fakeRow("b")], total: 4 })
      .mockResolvedValueOnce({ rows: [fakeRow("c"), fakeRow("d")], total: 4 });
    useRecentPlans.getState().setFilter({ limit: 2 });
    await useRecentPlans.getState().refresh();
    await useRecentPlans.getState().loadMore();
    expect(useRecentPlans.getState().rows.map((r) => r.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("setFilter does NOT auto-refresh", () => {
    useRecentPlans.getState().setFilter({ query: "users" });
    expect(useRecentPlans.getState().filter.query).toBe("users");
    expect(vi.mocked(recentPlansSearch)).not.toHaveBeenCalled();
  });

  it("togglePinned calls IPC + refresh", async () => {
    vi.mocked(recentPlansSearch).mockResolvedValueOnce({
      rows: [fakeRow("a")],
      total: 1,
    });
    useRecentPlans.setState({ rows: [fakeRow("a", { pinned: false })], total: 1 });
    await useRecentPlans.getState().togglePinned("a");
    expect(vi.mocked(recentPlansSetPinned)).toHaveBeenCalledWith("a", true);
  });

  it("deleteRow calls IPC + refresh", async () => {
    vi.mocked(recentPlansSearch).mockResolvedValueOnce({ rows: [], total: 0 });
    useRecentPlans.setState({ rows: [fakeRow("a")], total: 1 });
    await useRecentPlans.getState().deleteRow("a");
    expect(vi.mocked(recentPlansDelete)).toHaveBeenCalledWith("a");
  });

  it("selectRow sets selectedId", () => {
    useRecentPlans.getState().selectRow("a");
    expect(useRecentPlans.getState().selectedId).toBe("a");
    useRecentPlans.getState().selectRow(null);
    expect(useRecentPlans.getState().selectedId).toBeNull();
  });

  describe("compare mode ", () => {
    it("toggleCompareMode flips and clears compareSelected on exit", () => {
      useRecentPlans.setState({ compareMode: true, compareSelected: ["a", "b"] });
      useRecentPlans.getState().toggleCompareMode();
      expect(useRecentPlans.getState().compareMode).toBe(false);
      expect(useRecentPlans.getState().compareSelected).toEqual([]);
    });

    it("toggleCompareSelected FIFO eviction at the 3rd selection", () => {
      const state = useRecentPlans.getState();
      state.toggleCompareSelected("a");
      state.toggleCompareSelected("b");
      state.toggleCompareSelected("c");
      expect(useRecentPlans.getState().compareSelected).toEqual(["b", "c"]);
    });

    it("toggleCompareSelected on existing id removes it", () => {
      useRecentPlans.setState({ compareSelected: ["a", "b"] });
      useRecentPlans.getState().toggleCompareSelected("a");
      expect(useRecentPlans.getState().compareSelected).toEqual(["b"]);
    });

    it("clearCompareSelected drops everything without leaving mode", () => {
      useRecentPlans.setState({ compareMode: true, compareSelected: ["a", "b"] });
      useRecentPlans.getState().clearCompareSelected();
      expect(useRecentPlans.getState().compareSelected).toEqual([]);
      expect(useRecentPlans.getState().compareMode).toBe(true);
    });

    it("refresh filters out compareSelected ids no longer in result rows", async () => {
      vi.mocked(recentPlansSearch).mockResolvedValueOnce({
        rows: [fakeRow("a"), fakeRow("c")],
        total: 2,
      });
      useRecentPlans.setState({ compareSelected: ["a", "b"] });
      await useRecentPlans.getState().refresh();
      // "b" is no longer in result rows → dropped from compareSelected
      expect(useRecentPlans.getState().compareSelected).toEqual(["a"]);
    });

    it("startCompare with count=2 calls editor.openPlanDiff with both ids", async () => {
      const { useEditor } = await import("../editor/store");
      const spy = vi
        .spyOn(useEditor.getState(), "openPlanDiff")
        // biome-ignore lint/suspicious/noExplicitAny: test stub return
        .mockImplementation(() => ({}) as any);
      useRecentPlans.setState({ compareMode: true, compareSelected: ["a", "b"] });
      useRecentPlans.getState().startCompare();
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0]).toEqual({ kind: "recent", recentPlanId: "a" });
      expect(spy.mock.calls[0][1]).toEqual({ kind: "recent", recentPlanId: "b" });
      // Compare mode is exited.
      expect(useRecentPlans.getState().compareMode).toBe(false);
    });

    it("startCompare with count!=2 is a no-op", async () => {
      const { useEditor } = await import("../editor/store");
      const spy = vi
        .spyOn(useEditor.getState(), "openPlanDiff")
        // biome-ignore lint/suspicious/noExplicitAny: test stub return
        .mockImplementation(() => ({}) as any);
      useRecentPlans.setState({ compareMode: true, compareSelected: ["a"] });
      useRecentPlans.getState().startCompare();
      expect(spy).not.toHaveBeenCalled();
    });
  });
});
