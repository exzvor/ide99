import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import type { HistoryRow } from "../../lib/tauri";

beforeAll(() => {
  // Radix Select / Dialog internals — jsdom polyfills.
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {};
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {};
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

const { translation } = vi.hoisted(() => {
  const t = (key: string, opts?: Record<string, unknown>) => {
    if (opts && typeof opts === "object") {
      return Object.entries(opts).reduce<string>(
        (acc, [k, v]) => acc.replaceAll(`{{${k}}}`, String(v)),
        key,
      );
    }
    return key;
  };
  return {
    translation: {
      t,
      i18n: { changeLanguage: () => Promise.resolve(), language: "en" },
    },
  };
});
vi.mock("react-i18next", () => ({
  useTranslation: () => translation,
}));

const historySearchMock = vi.fn();
const historySetPinnedMock = vi.fn();
const historyDeleteMock = vi.fn();
const historyClearForConnectionMock = vi.fn();
const historyExportMock = vi.fn();

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: vi.fn().mockResolvedValue(null),
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

import { ToastProvider } from "../../components/Toast";
import { useConnections } from "../connections/store";
import { HistoryTab } from "./HistoryTab";
import { DEFAULT_FILTERS, useHistory } from "./store";

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

const initialHistoryState = useHistory.getState();
const initialConnectionsState = useConnections.getState();

beforeEach(() => {
  historySearchMock.mockReset();
  historySetPinnedMock.mockReset();
  historyDeleteMock.mockReset();
  historyClearForConnectionMock.mockReset();
  historyExportMock.mockReset();
  historySetPinnedMock.mockResolvedValue(undefined);
  historyDeleteMock.mockResolvedValue(undefined);
  historyClearForConnectionMock.mockResolvedValue(0);
  historySearchMock.mockResolvedValue({ rows: [], totalMatched: 0 });
  useHistory.setState(
    {
      ...initialHistoryState,
      filters: { ...DEFAULT_FILTERS },
      rows: [],
      totalMatched: 0,
      loading: false,
      error: null,
      lastFetchOffset: 0,
    },
    true,
  );
  useConnections.setState(
    {
      ...initialConnectionsState,
      connections: [],
      selectedId: null,
      formMode: { type: "closed" },
      loading: false,
      error: null,
    },
    true,
  );
});

function renderTab() {
  return render(
    <ToastProvider>
      <HistoryTab />
    </ToastProvider>,
  );
}

describe("HistoryTab", () => {
  test("renders search, filters, and pagination footer", () => {
    renderTab();
    expect(screen.getByTestId("history-search-input")).toBeInTheDocument();
    expect(screen.getByTestId("history-filter-connection")).toBeInTheDocument();
    expect(screen.getByTestId("history-filter-status")).toBeInTheDocument();
    expect(screen.getByTestId("history-filter-pinned")).toBeInTheDocument();
    expect(screen.getByTestId("history-pagination-summary")).toBeInTheDocument();
  });

  test("calls store.refresh on mount", async () => {
    renderTab();
    await waitFor(() => {
      expect(historySearchMock).toHaveBeenCalled();
    });
  });

  test("typing in search debounces — only one refresh call after the window", async () => {
    vi.useFakeTimers();
    try {
      renderTab();
      // Drain the on-mount refresh.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      historySearchMock.mockClear();

      const input = screen.getByTestId("history-search-input") as HTMLInputElement;
      // Three fast keystrokes — without debouncing they would trigger 3 refreshes.
      await act(async () => {
        input.dispatchEvent(new Event("input", { bubbles: true }));
        useHistory.getState().setFilter("query", "s");
        useHistory.getState().setFilter("query", "se");
        useHistory.getState().setFilter("query", "sel");
      });
      // Pre-debounce: zero refresh calls.
      expect(historySearchMock).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      // Only one refresh once the debounce window closed.
      expect(historySearchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  test("empty state shown when no rows and no error", async () => {
    renderTab();
    await waitFor(() => {
      expect(screen.getByTestId("history-empty")).toBeInTheDocument();
    });
  });

  test("error banner shown when refresh fails", async () => {
    historySearchMock.mockReset();
    historySearchMock.mockRejectedValue(new Error("boom"));
    renderTab();
    await waitFor(() => {
      expect(screen.getByTestId("history-error")).toBeInTheDocument();
    });
    expect(screen.getByText("boom")).toBeInTheDocument();
  });

  test("Load more button only renders when rows.length < totalMatched", () => {
    useHistory.setState({ rows: [makeRow()], totalMatched: 5 });
    renderTab();
    expect(screen.getByTestId("history-load-more")).toBeInTheDocument();
  });

  test("Load more click invokes loadMore + IPC", async () => {
    useHistory.setState({ rows: [makeRow({ id: "a" })], totalMatched: 5 });
    historySearchMock.mockResolvedValueOnce({
      rows: [makeRow({ id: "b" })],
      totalMatched: 5,
    });
    renderTab();
    historySearchMock.mockClear();
    historySearchMock.mockResolvedValueOnce({
      rows: [makeRow({ id: "b" })],
      totalMatched: 5,
    });

    await userEvent.click(screen.getByTestId("history-load-more"));

    await waitFor(() => {
      expect(historySearchMock).toHaveBeenCalled();
    });
    const args = historySearchMock.mock.calls.at(-1)?.[0];
    expect(args.offset).toBe(1);
  });

  test("⋯ menu has refresh / clear-for-connection / export items", async () => {
    renderTab();
    const trigger = screen.getByTestId("history-menu-trigger");
    await userEvent.click(trigger);
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByText("history.menu.refresh")).toBeInTheDocument();
    expect(within(menu).getByText("history.menu.clear_for_connection")).toBeInTheDocument();
    expect(within(menu).getByText("history.menu.export")).toBeInTheDocument();
  });
});
