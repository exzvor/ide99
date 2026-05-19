import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { HistoryRow, HistorySearchResult } from "../../lib/tauri";

const historySearchMock = vi.fn();
const historySetPinnedMock = vi.fn();
const historyDeleteMock = vi.fn();
const historyClearForConnectionMock = vi.fn();
const historyExportMock = vi.fn();
const saveDialogMock = vi.fn();

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: (...args: unknown[]) => saveDialogMock(...args),
}));

vi.mock("../../lib/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../lib/tauri")>("../../lib/tauri");
  return {
    ...actual,
    historySearch: (filter: unknown) => historySearchMock(filter),
    historySetPinned: (id: string, pinned: boolean) => historySetPinnedMock(id, pinned),
    historyDelete: (id: string) => historyDeleteMock(id),
    historyClearForConnection: (id: string) => historyClearForConnectionMock(id),
    historyExport: (filter: unknown, path: string) => historyExportMock(filter, path),
  };
});

import { DEFAULT_FILTERS, sanitizeFtsQuery, useHistory } from "./store";

function makeRow(overrides: Partial<HistoryRow> = {}): HistoryRow {
  return {
    id: overrides.id ?? "row-1",
    connectionId: overrides.connectionId ?? "conn-1",
    connectionName: overrides.connectionName ?? "primary",
    sql: overrides.sql ?? "SELECT 1",
    executedAt: overrides.executedAt ?? "2026-04-27T10:00:00.000Z",
    durationMs: overrides.durationMs ?? 5,
    status: overrides.status ?? "ok",
    rowsAffected: overrides.rowsAffected ?? null,
    rowsReturned: overrides.rowsReturned ?? 1,
    truncated: overrides.truncated ?? false,
    errorMessage: overrides.errorMessage ?? null,
    tag: overrides.tag ?? null,
    comment: overrides.comment ?? null,
    pinned: overrides.pinned ?? false,
  };
}

const initialState = useHistory.getState();

beforeEach(() => {
  historySearchMock.mockReset();
  historySetPinnedMock.mockReset();
  historyDeleteMock.mockReset();
  historyClearForConnectionMock.mockReset();
  historyExportMock.mockReset();
  saveDialogMock.mockReset();
  historySetPinnedMock.mockResolvedValue(undefined);
  historyDeleteMock.mockResolvedValue(undefined);
  historyClearForConnectionMock.mockResolvedValue(0);
  useHistory.setState(    {
      ...initialState,
      filters: { ...DEFAULT_FILTERS },
      rows: [],
      totalMatched: 0,
      loading: false,
      error: null,
      lastFetchOffset: 0,
    },
    true,
);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("sanitizeFtsQuery", () => {
  test("empty string → null", () => {
    expect(sanitizeFtsQuery("")).toBeNull();
  });

  test("whitespace only → null", () => {
    expect(sanitizeFtsQuery("   ")).toBeNull();
  });

  test("non-letter punctuation only → null", () => {
    expect(sanitizeFtsQuery("*")).toBeNull();
    expect(sanitizeFtsQuery("**")).toBeNull();
  });

  test("'select users' → quoted token AND", () => {
    expect(sanitizeFtsQuery("select users")).toBe('"select" "users"');
  });

  test("strips embedded quotes from tokens", () => {
    // "abc"def → abcdef wrapped in fresh quotes.
    expect(sanitizeFtsQuery('"abc"def')).toBe('"abcdef"');
  });
});

describe("useHistory store", () => {
  test("setFilter mutates only the named field", () => {
    useHistory.getState().setFilter("query", "select");
    const filters = useHistory.getState().filters;
    expect(filters.query).toBe("select");
    expect(filters.connectionId).toBeNull();
    expect(filters.pinnedOnly).toBe(false);
  });

  test("resetFilters returns to DEFAULT_FILTERS", () => {
    useHistory.getState().setFilter("query", "x");
    useHistory.getState().setFilter("pinnedOnly", true);
    useHistory.getState().resetFilters();
    expect(useHistory.getState().filters).toEqual(DEFAULT_FILTERS);
  });

  test("refresh success populates rows + totalMatched + clears loading", async () => {
    const result: HistorySearchResult = {
      rows: [makeRow({ id: "a" }), makeRow({ id: "b" })],
      totalMatched: 2,
    };
    historySearchMock.mockResolvedValueOnce(result);

    await useHistory.getState().refresh();

    const state = useHistory.getState();
    expect(state.rows).toEqual(result.rows);
    expect(state.totalMatched).toBe(2);
    expect(state.lastFetchOffset).toBe(0);
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
    expect(historySearchMock).toHaveBeenCalledTimes(1);
  });

  test("refresh failure sets error + clears loading", async () => {
    historySearchMock.mockRejectedValueOnce(new Error("db unavailable"));

    await useHistory.getState().refresh();

    const state = useHistory.getState();
    expect(state.loading).toBe(false);
    expect(state.error).toContain("db unavailable");
    expect(state.rows).toEqual([]);
  });

  test("loadMore concatenates pages and tracks lastFetchOffset", async () => {
    historySearchMock.mockResolvedValueOnce({
      rows: [makeRow({ id: "a" })],
      totalMatched: 3,
    });
    await useHistory.getState().refresh();

    historySearchMock.mockResolvedValueOnce({
      rows: [makeRow({ id: "b" }), makeRow({ id: "c" })],
      totalMatched: 3,
    });
    await useHistory.getState().loadMore();

    const state = useHistory.getState();
    expect(state.rows.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(state.lastFetchOffset).toBe(1);
    // The second call should have used offset=1.
    expect(historySearchMock).toHaveBeenCalledTimes(2);
    const secondArgs = historySearchMock.mock.calls[1][0];
    expect(secondArgs.offset).toBe(1);
  });

  test("loadMore short-circuits when rows.length >= totalMatched", async () => {
    historySearchMock.mockResolvedValueOnce({
      rows: [makeRow({ id: "a" })],
      totalMatched: 1,
    });
    await useHistory.getState().refresh();
    historySearchMock.mockClear();

    await useHistory.getState().loadMore();
    expect(historySearchMock).not.toHaveBeenCalled();
  });

  test("setPinned mutates the right row", async () => {
    historySearchMock.mockResolvedValueOnce({
      rows: [makeRow({ id: "a", pinned: false }), makeRow({ id: "b", pinned: false })],
      totalMatched: 2,
    });
    await useHistory.getState().refresh();

    await useHistory.getState().setPinned("b", true);

    const rows = useHistory.getState().rows;
    expect(rows.find((r) => r.id === "a")?.pinned).toBe(false);
    expect(rows.find((r) => r.id === "b")?.pinned).toBe(true);
    expect(historySetPinnedMock).toHaveBeenCalledWith("b", true);
  });

  test("remove drops the row and decrements totalMatched", async () => {
    historySearchMock.mockResolvedValueOnce({
      rows: [makeRow({ id: "a" }), makeRow({ id: "b" })],
      totalMatched: 5, // > rows.length, so simulate paged result
    });
    await useHistory.getState().refresh();

    await useHistory.getState().remove("a");

    const state = useHistory.getState();
    expect(state.rows.map((r) => r.id)).toEqual(["b"]);
    expect(state.totalMatched).toBe(4);
    expect(historyDeleteMock).toHaveBeenCalledWith("a");
  });

  test("clearForConnection triggers refresh when filter matches or is null", async () => {
    historyClearForConnectionMock.mockResolvedValueOnce(7);
    historySearchMock.mockResolvedValueOnce({ rows: [], totalMatched: 0 });

    // Filter is null by default → should refresh.
    await useHistory.getState().clearForConnection("conn-1");

    expect(historyClearForConnectionMock).toHaveBeenCalledWith("conn-1");
    expect(historySearchMock).toHaveBeenCalledTimes(1);
  });

  test("clearForConnection does NOT refresh when filter targets a different connection", async () => {
    useHistory.getState().setFilter("connectionId", "conn-other");
    historyClearForConnectionMock.mockResolvedValueOnce(0);

    await useHistory.getState().clearForConnection("conn-1");

    expect(historyClearForConnectionMock).toHaveBeenCalledWith("conn-1");
    expect(historySearchMock).not.toHaveBeenCalled();
  });

  test("exportToFile cancellation does not invoke historyExport", async () => {
    saveDialogMock.mockResolvedValueOnce(null);

    const result = await useHistory.getState().exportToFile();

    expect(historyExportMock).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false, cancelled: true });
  });

  test("exportToFile success path passes the current filters and chosen path", async () => {
    saveDialogMock.mockResolvedValueOnce("/tmp/history.ide99");
    historyExportMock.mockResolvedValueOnce({
      path: "/tmp/history.ide99",
      count: 12,
      bytes: 4096,
    });
    useHistory.getState().setFilter("query", "select");
    useHistory.getState().setFilter("status", "ok");

    const outcome = await useHistory.getState().exportToFile();

    expect(historyExportMock).toHaveBeenCalledTimes(1);
    const [filter, path] = historyExportMock.mock.calls[0];
    expect(path).toBe("/tmp/history.ide99");
    expect(filter.query).toBe('"select"');
    expect(filter.status).toBe("ok");
    expect(outcome).toEqual({ ok: true, path: "/tmp/history.ide99", count: 12 });
  });
});
