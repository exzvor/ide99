import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Connection } from "../lib/tauri";

// — Spg99InstantDbButton + Spg99StatusBarWidget +
// Spg99TemplatePickerDialog mount inside Workspace and call
// `invoke("modules_get_state")` on hydrate. Stub @tauri-apps/api/core so the
// auto-hydration call resolves without `window.__TAURI_INTERNALS__`.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue({
    spg99Subscribed: false,
    vibepgSubscribed: false,
    upgradeUrlSpg99: "https://spg99.ru/instant-db",
    upgradeUrlVibepg: "https://vibepg.ai/upgrade",
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { changeLanguage: () => Promise.resolve(), language: "en" },
  }),
}));

vi.mock("../components/LanguageSwitcher", () => ({
  LanguageSwitcher: () => <button type="button">language-switcher</button>,
}));

vi.mock("../components/ThemeSwitcher", () => ({
  ThemeSwitcher: () => <button type="button">theme-switcher</button>,
}));

vi.mock("../features/connections/ConnectionList", () => ({
  ConnectionList: () => (    <div data-testid="connection-list">
      connection-list
      <input data-testid="connection-list-search" aria-label="search" />
    </div>
),
}));

vi.mock("../features/connections/ConnectionDetails", () => ({
  ConnectionDetails: () => <div data-testid="connection-details">connection-details</div>,
}));

vi.mock("../features/schema/SchemaBrowser", () => ({
  SchemaBrowser: () => <div data-testid="schema-browser">schema-browser</div>,
}));

vi.mock("../features/schema/ConnectionBanner", () => ({
  ConnectionBanner: () => null,
}));

vi.mock("../features/editor/EditorPane", () => ({
  EditorPane: () => <div data-testid="editor-pane">editor-pane</div>,
}));

vi.mock("../features/editor/EditorTabs", () => ({
  EditorTabs: () => <div data-testid="editor-tabs">editor-tabs</div>,
}));

vi.mock("../components/quiet/Mesh", () => ({
  Mesh: () => <div data-testid="mesh" />,
}));

vi.mock("../components/quiet/Titlebar", () => ({
  Titlebar: () => <div data-testid="titlebar" />,
}));

vi.mock("../components/quiet/Wordmark", () => ({
  Wordmark: () => (    <span data-testid="wordmark" aria-label="ide99">
      ide99
    </span>
),
}));

const openHistoryTabMock = vi.fn();
const openEditorTabMock = vi.fn();
const runExplainMock = vi.fn().mockResolvedValue(undefined);

interface MockEditorTab {
  id: string;
  kind: "editor";
}

const baseSnapshot = {
  tabs: [] as MockEditorTab[],
  activeTabId: null as string | null,
  runStates: new Map(),
  explainRunStates: new Map(),
  // Post-S14: Workspace mounts the BatchConfirmModal driven by safetyModal.
  safetyModal: { kind: "none" } as { kind: string },
  untitledCounter: 0,
  hydrated: true,
  hydrateFromSqlite: () => Promise.resolve(),
  openEditorTab: (...args: unknown[]) => openEditorTabMock(...args),
  closeTab: () => Promise.resolve(true),
  switchTab: () => undefined,
  openHistoryTab: () => openHistoryTabMock(),
  runExplain: (...args: unknown[]) => runExplainMock(...args),
};

vi.mock("../features/editor/store", () => {
  return {
    useEditor: Object.assign((selector: (s: unknown) => unknown) => selector(baseSnapshot), {
      getState: () => baseSnapshot,
    }),
  };
});

import { useConnections } from "../features/connections/store";
import Workspace from "./Workspace";

const initialState = useConnections.getState();

function makeConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: overrides.id ?? "id-1",
    name: overrides.name ?? "alpha",
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

beforeEach(() => {
  useConnections.setState(    {
      ...initialState,
      connections: [makeConnection({ id: "a", name: "alpha" })],
      selectedId: "a",
      formMode: { type: "closed" },
      loading: false,
      error: null,
    },
    true,
);
});

describe("Workspace", () => {
  test("renders sidebar with connection list and main details", () => {
    render(<Workspace />);

    expect(screen.getByTestId("connection-list")).toBeInTheDocument();
    expect(screen.getByTestId("connection-details")).toBeInTheDocument();
  });

  test("renders the brand wordmark in the sidebar footer", () => {
    render(<Workspace />);
    // Quiet redesign relocated the wordmark from the sidebar header to the
    // sidebar footer alongside theme/language switchers — same visual anchor
    // for the brand, just a different slot.
    expect(screen.getByTestId("wordmark")).toBeInTheDocument();
  });

  test("renders + Add button that opens the create form", async () => {
    const user = userEvent.setup();
    render(<Workspace />);

    const addBtn = screen.getByRole("button", { name: /welcome.no_connections.add/i });
    await user.click(addBtn);

    expect(useConnections.getState().formMode.type).toBe("create");
  });

  test("renders inline connection search input in the sidebar", () => {
    render(<Workspace />);

    const searchInput = screen.getByTestId("connection-list-search");
    expect(searchInput).toBeInTheDocument();
  });

  test("renders theme + language switchers in footer", () => {
    render(<Workspace />);
    expect(screen.getByText("language-switcher")).toBeInTheDocument();
    expect(screen.getByText("theme-switcher")).toBeInTheDocument();
  });

  test("Cmd/Ctrl+H invokes openHistoryTab", () => {
    render(<Workspace />);
    openHistoryTabMock.mockClear();

    const evt = new KeyboardEvent("keydown", { key: "h", metaKey: true });
    window.dispatchEvent(evt);

    expect(openHistoryTabMock).toHaveBeenCalledTimes(1);
  });

  test("Cmd/Ctrl+Shift+H is ignored (does not trigger history tab)", () => {
    render(<Workspace />);
    openHistoryTabMock.mockClear();

    const evt = new KeyboardEvent("keydown", { key: "H", metaKey: true, shiftKey: true });
    window.dispatchEvent(evt);

    expect(openHistoryTabMock).not.toHaveBeenCalled();
  });

  test("Cmd/Ctrl+E triggers runExplain('explain') for the active editor tab", () => {
    // Seed the mocked store snapshot with one editor tab so the hotkey's
    // active-tab guard succeeds. The mock is not a real Zustand store, so
    // we mutate the snapshot in-place rather than calling setState.
    baseSnapshot.tabs = [{ id: "ed-1", kind: "editor" }];
    baseSnapshot.activeTabId = "ed-1";
    runExplainMock.mockClear();

    render(<Workspace />);

    const evt = new KeyboardEvent("keydown", { key: "e", metaKey: true });
    window.dispatchEvent(evt);

    expect(runExplainMock).toHaveBeenCalledWith("ed-1", "explain");
  });

  test("Cmd/Ctrl+Shift+E triggers runExplain('analyze') for the active editor tab", () => {
    baseSnapshot.tabs = [{ id: "ed-1", kind: "editor" }];
    baseSnapshot.activeTabId = "ed-1";
    runExplainMock.mockClear();

    render(<Workspace />);

    const evt = new KeyboardEvent("keydown", { key: "E", metaKey: true, shiftKey: true });
    window.dispatchEvent(evt);

    expect(runExplainMock).toHaveBeenCalledWith("ed-1", "analyze");
  });
});
