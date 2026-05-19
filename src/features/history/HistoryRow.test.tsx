import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import type { Connection, HistoryRow as HistoryRowData } from "../../lib/tauri";

beforeAll(() => {
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
      return Object.entries(opts).reduce<string>(        (acc, [k, v]) => acc.replaceAll(`{{${k}}}`, String(v)),
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

const historySetPinnedMock = vi.fn();
const historyDeleteMock = vi.fn();
const tabsSaveMock = vi.fn();

vi.mock("../../lib/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../lib/tauri")>("../../lib/tauri");
  return {
    ...actual,
    historySetPinned: (id: string, pinned: boolean) => historySetPinnedMock(id, pinned),
    historyDelete: (id: string) => historyDeleteMock(id),
    tabsSave: (...args: unknown[]) => tabsSaveMock(...args),
  };
});

import { ToastProvider } from "../../components/Toast";
import { useConnections } from "../connections/store";
import { useEditor } from "../editor/store";
import { HistoryRow } from "./HistoryRow";
import { useHistory } from "./store";

function makeRow(overrides: Partial<HistoryRowData> = {}): HistoryRowData {
  return {
    id: overrides.id ?? "row-1",
    connectionId: overrides.connectionId ?? "conn-1",
    connectionName: overrides.connectionName ?? "primary",
    sql: overrides.sql ?? "SELECT * FROM users",
    executedAt: overrides.executedAt ?? "2026-04-27T10:00:00.000Z",
    durationMs: overrides.durationMs ?? 12,
    status: overrides.status ?? "ok",
    rowsAffected: overrides.rowsAffected ?? null,
    rowsReturned: overrides.rowsReturned ?? 5,
    truncated: overrides.truncated ?? false,
    errorMessage: overrides.errorMessage ?? null,
    tag: overrides.tag ?? null,
    comment: overrides.comment ?? null,
    pinned: overrides.pinned ?? false,
  };
}

function makeConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: overrides.id ?? "conn-1",
    name: overrides.name ?? "primary",
    host: overrides.host ?? "localhost",
    port: overrides.port ?? 5432,
    database: overrides.database ?? "postgres",
    username: overrides.username ?? "postgres",
    sslMode: overrides.sslMode ?? "prefer",
    hasPassword: overrides.hasPassword ?? false,
    createdAt: overrides.createdAt ?? "2026-04-27T00:00:00Z",
    updatedAt: overrides.updatedAt ?? "2026-04-27T00:00:00Z",
    lastTestedAt: overrides.lastTestedAt ?? null,
    lastTestOk: overrides.lastTestOk ?? null,
    excludeFromHistory: overrides.excludeFromHistory ?? false,
    excludeFromRecentPlans: overrides.excludeFromRecentPlans ?? false,
    environment: overrides.environment ?? "local",
    readOnly: overrides.readOnly ?? false,
    slowQueryWarning: overrides.slowQueryWarning ?? false,
    confirmDestructive: overrides.confirmDestructive ?? false,
  };
}

const initialEditorState = useEditor.getState();
const initialConnState = useConnections.getState();
const initialHistoryState = useHistory.getState();

beforeEach(() => {
  historySetPinnedMock.mockReset();
  historyDeleteMock.mockReset();
  tabsSaveMock.mockReset();
  historySetPinnedMock.mockResolvedValue(undefined);
  historyDeleteMock.mockResolvedValue(undefined);
  tabsSaveMock.mockResolvedValue(undefined);
  useEditor.setState(    {
      ...initialEditorState,
      tabs: [],
      activeTabId: null,
      runStates: new Map(),
      untitledCounter: 0,
      hydrated: true,
    },
    true,
);
  useConnections.setState(    {
      ...initialConnState,
      connections: [],
      selectedId: null,
      formMode: { type: "closed" },
      loading: false,
      error: null,
    },
    true,
);
  useHistory.setState(    {
      ...initialHistoryState,
      filters: { ...initialHistoryState.filters },
      rows: [],
      totalMatched: 0,
      loading: false,
      error: null,
      lastFetchOffset: 0,
    },
    true,
);
});

function renderRow(row: HistoryRowData) {
  return render(    <ToastProvider>
      <HistoryRow row={row} />
    </ToastProvider>,
);
}

describe("HistoryRow", () => {
  test("renders SQL preview, duration, status and time", () => {
    const row = makeRow({ sql: "SELECT * FROM users", durationMs: 42, status: "ok" });
    renderRow(row);
    expect(screen.getByText("SELECT * FROM users")).toBeInTheDocument();
    expect(screen.getByText("42ms")).toBeInTheDocument();
    expect(screen.getByTestId(`history-row-status-${row.id}`)).toHaveTextContent(      "history.filter.status.ok",
);
  });

  test("pinned row renders a star with currentColor fill", () => {
    const row = makeRow({ pinned: true });
    renderRow(row);
    const pinBtn = screen.getByTestId(`history-row-pin-${row.id}`);
    const svg = pinBtn.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("fill")).toBe("currentColor");
  });

  test("Replay opens a NEW editor tab with prefillSql when connection still exists", async () => {
    useConnections.setState({ connections: [makeConnection({ id: "conn-1" })] });
    const row = makeRow({ connectionId: "conn-1", sql: "SELECT 1" });
    renderRow(row);

    await userEvent.click(screen.getByTestId(`history-row-menu-${row.id}`));
    const menu = await screen.findByRole("menu");
    await userEvent.click(within(menu).getByText("history.row.replay"));

    const tabs = useEditor.getState().tabs;
    expect(tabs).toHaveLength(1);
    if (tabs[0].kind === "editor") {
      expect(tabs[0].connectionId).toBe("conn-1");
      expect(tabs[0].content).toBe("SELECT 1");
    } else {
      throw new Error("expected editor tab");
    }
  });

  test("Replay with deleted connection shows a toast and does not open a tab", async () => {
    useConnections.setState({ connections: [] });
    const row = makeRow({ connectionId: "conn-gone" });
    renderRow(row);

    await userEvent.click(screen.getByTestId(`history-row-menu-${row.id}`));
    const menu = await screen.findByRole("menu");
    await userEvent.click(within(menu).getByText("history.row.replay"));

    expect(useEditor.getState().tabs).toHaveLength(0);
    await waitFor(() => {
      expect(screen.getByTestId("toast-error")).toBeInTheDocument();
    });
    expect(screen.getByText("history.replay.connection_deleted")).toBeInTheDocument();
  });

  test("Toggle pin via star button calls setPinned with negated value", async () => {
    const row = makeRow({ pinned: false });
    renderRow(row);
    await userEvent.click(screen.getByTestId(`history-row-pin-${row.id}`));
    await waitFor(() => {
      expect(historySetPinnedMock).toHaveBeenCalledWith(row.id, true);
    });
  });

  test("Copy SQL writes to clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const row = makeRow({ sql: "DELETE FROM logs" });
    renderRow(row);

    await userEvent.click(screen.getByTestId(`history-row-menu-${row.id}`));
    const menu = await screen.findByRole("menu");
    await userEvent.click(within(menu).getByText("history.row.copy_sql"));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("DELETE FROM logs");
    });
  });

  test("Delete opens confirmation; confirming calls historyDelete", async () => {
    const row = makeRow();
    useHistory.setState({ rows: [row], totalMatched: 1 });
    renderRow(row);

    await userEvent.click(screen.getByTestId(`history-row-menu-${row.id}`));
    const menu = await screen.findByRole("menu");
    await userEvent.click(within(menu).getByText("history.row.delete"));

    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByTestId(`history-row-delete-confirm-${row.id}`));

    await waitFor(() => {
      expect(historyDeleteMock).toHaveBeenCalledWith(row.id);
    });
  });
});
