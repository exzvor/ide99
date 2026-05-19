import { render, screen, within } from "@testing-library/react";
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
import { ResultPanel } from "./ResultPanel";
import { type RunState, type Tab, useEditor } from "./store";

const initialEditorState = useEditor.getState();
const initialConnectionsState = useConnections.getState();

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

function setRunState(tabId: string, state: RunState): void {
  const map = new Map(useEditor.getState().runStates);
  map.set(tabId, state);
  useEditor.setState({ runStates: map });
}

beforeEach(() => {
  useEditor.setState(
    {
      ...initialEditorState,
      tabs: [makeTab()],
      activeTabId: "tab-1",
      runStates: new Map(),
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
});

describe("ResultPanel", () => {
  describe("idle state", () => {
    test("shows ready + 'no connection' when tab has no connection", () => {
      render(<ResultPanel tabId="tab-1" />);
      expect(screen.getByText("editor.result.ready")).toBeInTheDocument();
      expect(screen.getByText("editor.result.no_connection")).toBeInTheDocument();
    });

    test("shows the connection name when tab is bound", () => {
      const conn = makeConnection({ id: "c-1", name: "primary" });
      useConnections.setState({ connections: [conn] });
      useEditor.setState({ tabs: [makeTab({ connectionId: "c-1" })] });
      render(<ResultPanel tabId="tab-1" />);
      expect(screen.getByText("primary")).toBeInTheDocument();
    });

    test("region role and aria-label are present", () => {
      render(<ResultPanel tabId="tab-1" />);
      expect(screen.getByRole("region", { name: "editor.result.title" })).toBeInTheDocument();
    });
  });

  describe("opening state", () => {
    test("renders a status output with spinner + label", () => {
      setRunState("tab-1", { status: "opening", startedAt: Date.now(), cancelable: true });
      render(<ResultPanel tabId="tab-1" />);
      const status = screen.getByRole("status");
      expect(within(status).getByText("editor.run.spinner")).toBeInTheDocument();
      expect(screen.getByTestId("result-spinner")).toBeInTheDocument();
    });
  });

  describe("streaming state", () => {
    function streamingState(
      overrides: Partial<Extract<RunState, { status: "streaming" }>> = {},
    ): RunState {
      const cols = overrides.columns ?? [
        { name: "id", typeName: "int4", isNumeric: true },
        { name: "name", typeName: "text", isNumeric: false },
      ];
      return {
        status: "streaming",
        cursorId: null,
        columns: cols,
        rows: [
          ["1", "alpha"],
          ["2", null],
        ],
        loadedCount: 2,
        exhausted: true,
        durationMs: 42,
        prefetching: false,
        affectedRows: null,
        statusMessage: "SELECT 2",
        sort: null,
        columnWidths: new Map(),
        columnOrder: cols.map((_, i) => i),
        ...overrides,
      };
    }

    test("renders ResultGrid for streaming + non-empty rows", () => {
      setRunState("tab-1", streamingState());
      render(<ResultPanel tabId="tab-1" />);
      expect(screen.getByTestId("result-grid")).toBeInTheDocument();
    });

    test("renders ResultFooter with row-count chip", () => {
      setRunState("tab-1", streamingState());
      render(<ResultPanel tabId="tab-1" />);
      expect(screen.getByTestId("result-footer")).toBeInTheDocument();
    });

    test("renders headers with column names", () => {
      setRunState("tab-1", streamingState());
      render(<ResultPanel tabId="tab-1" />);
      expect(screen.getByRole("columnheader", { name: /id/ })).toBeInTheDocument();
      expect(screen.getByRole("columnheader", { name: /name/ })).toBeInTheDocument();
    });

    test("affected rows banner appears when no rows + affectedRows non-null", () => {
      setRunState(
        "tab-1",
        streamingState({
          rows: [],
          loadedCount: 0,
          columns: [],
          columnOrder: [],
          affectedRows: 7,
          statusMessage: "UPDATE 7",
        }),
      );
      render(<ResultPanel tabId="tab-1" />);
      expect(screen.getByText("editor.result.affected", { exact: false })).toBeInTheDocument();
    });

    test("empty banner appears when no rows + affectedRows null", () => {
      setRunState(
        "tab-1",
        streamingState({
          rows: [],
          loadedCount: 0,
          columns: [],
          columnOrder: [],
          affectedRows: null,
        }),
      );
      render(<ResultPanel tabId="tab-1" />);
      expect(screen.getByText("editor.result.empty")).toBeInTheDocument();
    });
  });

  describe("cancelled state", () => {
    test("renders neutral title + body (no red error styling)", () => {
      setRunState("tab-1", { status: "cancelled" });
      render(<ResultPanel tabId="tab-1" />);
      expect(screen.getByText("editor.result.cancelled_title")).toBeInTheDocument();
      expect(screen.getByText("editor.result.cancelled_body")).toBeInTheDocument();
    });
  });

  describe("error state", () => {
    test("renders pre-formatted PG error message in the danger panel", () => {
      setRunState("tab-1", {
        status: "error",
        code: "postgres_error",
        detail: "ERROR: relation does not exist",
      });
      render(<ResultPanel tabId="tab-1" />);
      // Quiet redesign collapsed the standalone error.title row into a single
      // `<pre>` body — for postgres_error the detail is the user-facing copy
      // (no synthetic "title" line). Asserting the detail text is the
      // behavioural anchor that matches the new layout.
      expect(screen.getByText(/relation does not exist/)).toBeInTheDocument();
    });

    test("renders position label when line + col are set", () => {
      setRunState("tab-1", {
        status: "error",
        code: "postgres_error",
        detail: "syntax error",
        line: 5,
        col: 9,
      });
      render(<ResultPanel tabId="tab-1" />);
      // Mock t() returns the raw key when no {{placeholders}} are present;
      // it's enough to assert the position label is rendered. The full
      // localized "↳ at line {{line}}, col {{col}}" string is asserted at
      // the i18n-resource level (locale JSON files).
      expect(screen.getByText("editor.result.error.position")).toBeInTheDocument();
    });

    test("does not render position label when line/col are missing", () => {
      setRunState("tab-1", {
        status: "error",
        code: "postgres_error",
        detail: "ERROR: foo",
      });
      render(<ResultPanel tabId="tab-1" />);
      expect(screen.queryByText(/editor.result.error.position/)).not.toBeInTheDocument();
    });
  });
});
