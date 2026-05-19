import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Connection } from "../../lib/tauri";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts && typeof opts === "object") {
        return Object.entries(opts).reduce<string>(
          (acc, [k, v]) => acc.replaceAll(`{{${k}}}`, String(v)),
          key,
        );
      }
      return key;
    },
    i18n: { changeLanguage: () => Promise.resolve(), language: "en" },
  }),
}));

vi.mock("../../lib/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../lib/tauri")>("../../lib/tauri");
  return { ...actual };
});

import { useConnections } from "../connections/store";
import { useSchema } from "../schema/store";
import { RunToolbar } from "./RunToolbar";
import { type Tab, useEditor } from "./store";

const initialEditorState = useEditor.getState();
const initialConnectionsState = useConnections.getState();
const initialSchemaState = useSchema.getState();

function setSchemaConnected(connId: string) {
  useSchema.setState(
    {
      ...initialSchemaState,
      connection: { status: "connected", connId, serverVersion: "16.0", database: "test" },
    },
    true,
  );
}

function makeTab(overrides: Partial<Tab> = {}): Tab {
  return {
    id: "tab-1",
    kind: "editor",
    name: "untitled-1",
    content: "SELECT 1",
    connectionId: null,
    cursorPos: { line: 1, col: 1 },
    dirty: false,
    createdAt: "2026-04-27T00:00:00Z",
    updatedAt: "2026-04-27T00:00:00Z",
    ...(overrides as Record<string, unknown>),
  } as Tab;
}

function makeConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: overrides.id ?? "c-1",
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

const runQueryMock = vi.fn();
const setTabConnectionMock = vi.fn();
const cancelRunMock = vi.fn();

beforeEach(() => {
  runQueryMock.mockReset();
  setTabConnectionMock.mockReset();
  cancelRunMock.mockReset();
  useEditor.setState(
    {
      ...initialEditorState,
      tabs: [makeTab()],
      activeTabId: "tab-1",
      runStates: new Map(),
      runQuery: runQueryMock,
      setTabConnection: setTabConnectionMock,
      cancelRun: cancelRunMock,
    },
    true,
  );
  useConnections.setState(
    {
      ...initialConnectionsState,
      connections: [],
      selectedId: null,
    },
    true,
  );
  useSchema.setState({ ...initialSchemaState, connection: { status: "idle" } }, true);
});

describe("RunToolbar", () => {
  test("renders Run button with the localized label", () => {
    render(<RunToolbar tabId="tab-1" />);
    expect(screen.getByRole("button", { name: "editor.run.button" })).toBeInTheDocument();
  });

  test("Run button is disabled when the tab has no connection", () => {
    render(<RunToolbar tabId="tab-1" />);
    expect(screen.getByRole("button", { name: "editor.run.button" })).toBeDisabled();
  });

  test("Run button dispatches RunIntent.current when cursor sits on a statement", async () => {
    useEditor.setState({
      tabs: [makeTab({ connectionId: "c-1" })],
      currentStatementByTab: new Map([
        ["tab-1", { text: "SELECT 1", startOffset: 0, endOffset: 8, startLine: 1, endLine: 1 }],
      ]),
      selectionByTab: new Map(),
    });
    useConnections.setState({ connections: [makeConnection({ id: "c-1", name: "primary" })] });
    setSchemaConnected("c-1");

    const user = userEvent.setup();
    render(<RunToolbar tabId="tab-1" />);

    const runBtn = screen.getByRole("button", { name: "editor.run.button" });
    expect(runBtn).toBeEnabled();
    await user.click(runBtn);

    expect(runQueryMock).toHaveBeenCalledWith("tab-1", { kind: "current" });
  });

  test("Run button dispatches RunIntent.selection when selection is non-empty", async () => {
    useEditor.setState({
      tabs: [makeTab({ connectionId: "c-1" })],
      currentStatementByTab: new Map(),
      selectionByTab: new Map([["tab-1", "  SELECT 1; SELECT 2  "]]),
    });
    useConnections.setState({ connections: [makeConnection({ id: "c-1", name: "primary" })] });
    setSchemaConnected("c-1");

    const user = userEvent.setup();
    render(<RunToolbar tabId="tab-1" />);

    await user.click(screen.getByRole("button", { name: "editor.run.button" }));
    expect(runQueryMock).toHaveBeenCalledWith("tab-1", {
      kind: "selection",
      text: "  SELECT 1; SELECT 2  ",
    });
  });

  test("Run button is disabled when there is no current statement and no selection", () => {
    useEditor.setState({
      tabs: [makeTab({ connectionId: "c-1" })],
      currentStatementByTab: new Map(),
      selectionByTab: new Map(),
    });
    useConnections.setState({ connections: [makeConnection({ id: "c-1", name: "primary" })] });
    setSchemaConnected("c-1");
    render(<RunToolbar tabId="tab-1" />);
    expect(screen.getByRole("button", { name: "editor.run.button" })).toBeDisabled();
  });

  test("Run button is disabled when bound connection is NOT the active one (1-pool model)", () => {
    useEditor.setState({ tabs: [makeTab({ connectionId: "c-other" })] });
    useConnections.setState({
      connections: [
        makeConnection({ id: "c-1", name: "primary" }),
        makeConnection({ id: "c-other", name: "alt" }),
      ],
    });
    setSchemaConnected("c-1");

    render(<RunToolbar tabId="tab-1" />);
    expect(screen.getByRole("button", { name: "editor.run.button" })).toBeDisabled();
  });

  test("Run button shows a spinner + 'Running…' label when query is running", () => {
    useEditor.setState({
      tabs: [makeTab({ connectionId: "c-1" })],
      runStates: new Map([
        ["tab-1", { status: "opening", startedAt: Date.now(), cancelable: true }],
      ]),
    });
    useConnections.setState({ connections: [makeConnection({ id: "c-1", name: "primary" })] });
    setSchemaConnected("c-1");

    render(<RunToolbar tabId="tab-1" />);
    expect(screen.getByTestId("run-toolbar-spinner")).toBeInTheDocument();
    expect(screen.getByText("editor.run.spinner")).toBeInTheDocument();
  });

  test("Run button is disabled while a query is running", () => {
    useEditor.setState({
      tabs: [makeTab({ connectionId: "c-1" })],
      runStates: new Map([
        ["tab-1", { status: "opening", startedAt: Date.now(), cancelable: true }],
      ]),
    });
    useConnections.setState({ connections: [makeConnection({ id: "c-1", name: "primary" })] });
    setSchemaConnected("c-1");

    render(<RunToolbar tabId="tab-1" />);
    // The Run button now shows the spinner label; disabled state is the
    // important property to verify.
    const btn = screen.getByLabelText("editor.run.button");
    expect(btn).toBeDisabled();
  });

  test("Connection dropdown trigger shows 'No connection' when unbound", () => {
    render(<RunToolbar tabId="tab-1" />);
    expect(screen.getByText("editor.run.no_connection")).toBeInTheDocument();
  });

  test("Connection dropdown trigger shows the connection name when bound", () => {
    useEditor.setState({ tabs: [makeTab({ connectionId: "c-1" })] });
    useConnections.setState({ connections: [makeConnection({ id: "c-1", name: "primary" })] });
    render(<RunToolbar tabId="tab-1" />);
    expect(screen.getByText("primary")).toBeInTheDocument();
  });

  test("dropdown lists only the active connection plus an 'unbind' option", async () => {
    // 1-pool-at-a-time model: only the currently-connected schema pool is
    // selectable; other saved connections are intentionally hidden so the
    // user can't bind a tab to a pool that doesn't exist.
    useConnections.setState({
      connections: [
        makeConnection({ id: "c-1", name: "primary" }),
        makeConnection({ id: "c-2", name: "staging" }),
      ],
    });
    setSchemaConnected("c-1");

    const user = userEvent.setup();
    render(<RunToolbar tabId="tab-1" />);

    await user.click(screen.getByLabelText("editor.run.connection_dropdown_label"));

    const items = await screen.findAllByRole("menuitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("primary");
    expect(items[1]).toHaveTextContent("editor.run.no_connection");

    await user.click(items[0] as HTMLElement);
    expect(setTabConnectionMock).toHaveBeenCalledWith("tab-1", "c-1");
  });

  test("returns empty placeholder when tab does not exist", () => {
    useEditor.setState({ tabs: [] });
    render(<RunToolbar tabId="missing" />);
    expect(screen.getByTestId("run-toolbar-empty")).toBeInTheDocument();
  });

  describe("Cancel button", () => {
    test("hidden in idle state", () => {
      useEditor.setState({
        tabs: [makeTab({ connectionId: "c-1" })],
        runStates: new Map(),
      });
      render(<RunToolbar tabId="tab-1" />);
      expect(screen.queryByTestId("run-toolbar-cancel")).toBeNull();
    });

    test("visible in opening state and triggers cancelRun", async () => {
      useEditor.setState({
        tabs: [makeTab({ connectionId: "c-1" })],
        runStates: new Map([
          ["tab-1", { status: "opening", startedAt: Date.now(), cancelable: true }],
        ]),
      });
      setSchemaConnected("c-1");
      const user = userEvent.setup();
      render(<RunToolbar tabId="tab-1" />);
      const btn = screen.getByTestId("run-toolbar-cancel");
      expect(btn).toBeEnabled();
      await user.click(btn);
      expect(cancelRunMock).toHaveBeenCalledWith("tab-1");
    });

    test("visible in streaming only while a fetch is in flight (prefetching)", () => {
      // fix: Cancel must NOT show when the cursor is open but idle —
      // there is no in-flight query to cancel, and pressing it previously
      // wiped the partial rows already on screen. The button is reserved for
      // `opening` and `streaming + prefetching` states.
      useEditor.setState({
        tabs: [makeTab({ connectionId: "c-1" })],
        runStates: new Map([
          [
            "tab-1",
            {
              status: "streaming",
              cursorId: "c_x",
              columns: [],
              rows: [],
              loadedCount: 0,
              exhausted: false,
              durationMs: 0,
              prefetching: false,
              affectedRows: null,
              statusMessage: "",
              sort: null,
              columnWidths: new Map(),
              columnOrder: [],
            },
          ],
        ]),
      });
      setSchemaConnected("c-1");
      const { rerender } = render(<RunToolbar tabId="tab-1" />);
      expect(screen.queryByTestId("run-toolbar-cancel")).not.toBeInTheDocument();

      // Flip prefetching=true → background FETCH is in flight → Cancel reappears.
      useEditor.setState({
        tabs: [makeTab({ connectionId: "c-1" })],
        runStates: new Map([
          [
            "tab-1",
            {
              status: "streaming",
              cursorId: "c_x",
              columns: [],
              rows: [],
              loadedCount: 0,
              exhausted: false,
              durationMs: 0,
              prefetching: true,
              affectedRows: null,
              statusMessage: "",
              sort: null,
              columnWidths: new Map(),
              columnOrder: [],
            },
          ],
        ]),
      });
      rerender(<RunToolbar tabId="tab-1" />);
      expect(screen.getByTestId("run-toolbar-cancel")).toBeInTheDocument();
    });

    test("hidden when streaming + exhausted", () => {
      useEditor.setState({
        tabs: [makeTab({ connectionId: "c-1" })],
        runStates: new Map([
          [
            "tab-1",
            {
              status: "streaming",
              cursorId: null,
              columns: [],
              rows: [],
              loadedCount: 0,
              exhausted: true,
              durationMs: 0,
              prefetching: false,
              affectedRows: null,
              statusMessage: "",
              sort: null,
              columnWidths: new Map(),
              columnOrder: [],
            },
          ],
        ]),
      });
      setSchemaConnected("c-1");
      render(<RunToolbar tabId="tab-1" />);
      expect(screen.queryByTestId("run-toolbar-cancel")).toBeNull();
    });
  });
});
