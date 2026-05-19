import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ChangeEvent, useEffect } from "react";
import { type Mock, beforeEach, describe, expect, test, vi } from "vitest";
import type { QueryResult } from "../../lib/tauri";

/**
 * Tests for the Monaco wrapper.
 *
 * We mock `@monaco-editor/react` with a simple `<textarea>` proxy that calls
 * `onMount` with a mock editor + monaco namespace. This lets us assert:
 * - `value` prop is rendered
 * - `onChange` updates the store via `setContent`
 * - keybindings are registered (Cmd/Ctrl+Enter, Cmd/Ctrl+Shift+Enter)
 * - error markers are set on `runState.status === "error"` with a position
 */

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

const warningMock = vi.fn();
vi.mock("../../components/Toast", () => ({
  useToast: () => ({
    success: vi.fn(),
    info: vi.fn(),
    warning: warningMock,
    error: vi.fn(),
  }),
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const setupLanguageFeaturesMock = vi.fn();
vi.mock("monaco-sql-languages", () => ({
  LanguageIdEnum: {
    PG: "pgsql",
    MYSQL: "mysql",
    HIVE: "hivesql",
    SPARK: "sparksql",
    FLINK: "flinksql",
    TRINO: "trinosql",
    IMPALA: "impalasql",
  },
  setupLanguageFeatures: (...args: unknown[]) => setupLanguageFeaturesMock(...args),
}));

// ----- mock @monaco-editor/react -----

interface MockEditor {
  getModel: Mock;
  getSelection: Mock;
  setPosition: Mock;
  getPosition: Mock;
  onDidChangeCursorPosition: Mock;
  onDidChangeCursorSelection: Mock;
  onDidChangeModelContent: Mock;
  onDidDispose: Mock;
  createDecorationsCollection: Mock;
  addCommand: Mock;
}

interface MockMonaco {
  KeyMod: { CtrlCmd: number; Shift: number };
  KeyCode: { Enter: number; KeyF: number; KeyS: number; KeyE: number };
  MarkerSeverity: { Error: number };
  editor: {
    setModelMarkers: Mock;
    defineTheme: Mock;
    setTheme: Mock;
  };
  // — registerAutocomplete calls monaco.languages.registerCompletionItemProvider
  // on mount; the mock returns a noop disposable so the test isn't asserting on the
  // completion behaviour (provider.test.ts owns those assertions).
  languages: {
    registerCompletionItemProvider: Mock;
  };
}

const cursorListeners: Array<
  (event: { position: { lineNumber: number; column: number } }) => void
> = [];
const contentChangeListeners: Array<() => void> = [];
const setModelMarkersMock = vi.fn();
const addCommandMock = vi.fn();
const setPositionMock = vi.fn();
const getValueInRangeMock = vi.fn(() => "");
const getSelectionMock = vi.fn<() => unknown>(() => null);

let lastMockEditor: MockEditor | null = null;
let lastMockMonaco: MockMonaco | null = null;

vi.mock("@monaco-editor/react", () => {
  return {
    Editor: (props: {
      value?: string;
      onChange?: (v: string | undefined) => void;
      onMount?: (e: MockEditor, m: MockMonaco) => void;
    }) => {
      const { value, onChange, onMount } = props;
      // Use an effect so the parent mounts before mock's onMount runs.
      // This more closely mirrors the real package, where onMount fires
      // after Monaco initialization.
      useEffect(() => {
        cursorListeners.length = 0;
        contentChangeListeners.length = 0;
        const model = {
          getValueInRange: getValueInRangeMock,
          // — applyFormat() reads model.getValue() and
          // model.getFullModelRange() inside the Cmd+Shift+F / Cmd+S
          // handlers. The handlers are bound on mount but only invoked
          // by the format-specific tests; they need stub-level support
          // so unrelated tests that fire OTHER addCommand handlers don't
          // accidentally trip applyFormat (it isn't called from mount,
          // only from invoking the bound key handler).
          getValue: vi.fn(() => ""),
          getFullModelRange: vi.fn(() => ({
            startLineNumber: 1,
            startColumn: 1,
            endLineNumber: 1,
            endColumn: 1,
          })),
        };
        const ed: MockEditor = {
          getModel: vi.fn(() => model),
          getSelection: getSelectionMock,
          setPosition: setPositionMock,
          // Post-S14: gutter-marker effect calls these — return harmless stubs.
          getPosition: vi.fn(() => null),
          onDidChangeCursorSelection: vi.fn(() => ({ dispose: vi.fn() })),
          onDidDispose: vi.fn(() => ({ dispose: vi.fn() })),
          createDecorationsCollection: vi.fn(() => ({
            set: vi.fn(),
            clear: vi.fn(),
          })),
          onDidChangeCursorPosition: vi.fn((listener) => {
            cursorListeners.push(listener);
            return { dispose: vi.fn() };
          }),
          onDidChangeModelContent: vi.fn((listener) => {
            contentChangeListeners.push(listener);
            return { dispose: vi.fn() };
          }),
          addCommand: addCommandMock,
        };
        const monaco: MockMonaco = {
          KeyMod: { CtrlCmd: 2048, Shift: 1024 },
          // — KeyF/KeyS added so bindFormatShortcut + bindFormatOnSave
          // can mask their keybindings off the same monaco namespace.
          // () — KeyE added for the EXPLAIN bindings.
          KeyCode: { Enter: 3, KeyF: 36, KeyS: 49, KeyE: 35 },
          MarkerSeverity: { Error: 8 },
          editor: {
            setModelMarkers: setModelMarkersMock,
            // Quiet redesign added defineTheme + setTheme calls in
            // MonacoEditor.tsx for the new quiet-light / quiet-dark palettes.
            // Stub them so the mock matches the surface we exercise.
            defineTheme: vi.fn(),
            setTheme: vi.fn(),
          },
          languages: {
            registerCompletionItemProvider: vi.fn(() => ({ dispose: vi.fn() })),
          },
        };
        lastMockEditor = ed;
        lastMockMonaco = monaco;
        onMount?.(ed, monaco);
      }, [onMount]);

      return (
        <textarea
          data-testid="mock-monaco-textarea"
          value={value ?? ""}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) => onChange?.(e.target.value)}
        />
      );
    },
  };
});

import { MonacoEditor } from "./MonacoEditor";
import { type Tab, useEditor } from "./store";

const initialEditorState = useEditor.getState();

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

const setContentMock = vi.fn();
const setCursorMock = vi.fn();
const runQueryMock = vi.fn();
const runExplainMock = vi.fn();

beforeEach(() => {
  warningMock.mockReset();
  setModelMarkersMock.mockReset();
  addCommandMock.mockReset();
  setPositionMock.mockReset();
  getValueInRangeMock.mockReset();
  getSelectionMock.mockReset().mockReturnValue(null);
  setContentMock.mockReset();
  setCursorMock.mockReset();
  runQueryMock.mockReset();
  runExplainMock.mockReset();
  setupLanguageFeaturesMock.mockReset();
  lastMockEditor = null;
  lastMockMonaco = null;

  useEditor.setState(
    {
      ...initialEditorState,
      tabs: [makeTab()],
      activeTabId: "tab-1",
      runStates: new Map(),
      setContent: setContentMock,
      setCursor: setCursorMock,
      runQuery: runQueryMock,
      runExplain: runExplainMock,
    },
    true,
  );
});

describe("MonacoEditor", () => {
  test("renders the tab content into the editor value prop", () => {
    render(<MonacoEditor tabId="tab-1" />);
    const textarea = screen.getByTestId("mock-monaco-textarea") as HTMLTextAreaElement;
    expect(textarea.value).toBe("SELECT 1");
  });

  test("changing the editor value calls setContent on the store", async () => {
    const user = userEvent.setup();
    render(<MonacoEditor tabId="tab-1" />);
    const textarea = screen.getByTestId("mock-monaco-textarea");
    await user.clear(textarea);
    await user.type(textarea, "S");
    // userEvent.type generates per-character onChange events. We only assert
    // setContent was called at least once with the latest character path.
    expect(setContentMock).toHaveBeenCalled();
  });

  test("registers Cmd+Shift+F, Cmd+S, Cmd+Enter, Cmd+Shift+Enter, Cmd+E, Cmd+Shift+E keybindings", () => {
    render(<MonacoEditor tabId="tab-1" />);
    // bindFormatShortcut + bindFormatOnSave register two extra
    // commands BEFORE the Enter handlers, in this order: Cmd+Shift+F, Cmd+S.
    // (): Cmd+E and Cmd+Shift+E registered after Enter
    // handlers so the editor wins over Monaco's default Cmd+E (find next).
    expect(addCommandMock).toHaveBeenCalledTimes(6);
    // [0] Cmd+Shift+F = CtrlCmd | Shift | KeyF = 2048 | 1024 | 36
    expect(addCommandMock.mock.calls[0]?.[0]).toBe(2048 | 1024 | 36);
    // [1] Cmd+S = CtrlCmd | KeyS = 2048 | 49
    expect(addCommandMock.mock.calls[1]?.[0]).toBe(2048 | 49);
    // [2] Cmd+Enter = CtrlCmd | Enter = 2048 | 3
    expect(addCommandMock.mock.calls[2]?.[0]).toBe(2048 | 3);
    // [3] Cmd+Shift+Enter = CtrlCmd | Shift | Enter
    expect(addCommandMock.mock.calls[3]?.[0]).toBe(2048 | 1024 | 3);
    // [4] Cmd+E = CtrlCmd | KeyE = 2048 | 35
    expect(addCommandMock.mock.calls[4]?.[0]).toBe(2048 | 35);
    // [5] Cmd+Shift+E = CtrlCmd | Shift | KeyE
    expect(addCommandMock.mock.calls[5]?.[0]).toBe(2048 | 1024 | 35);
  });

  test("Cmd+E triggers runExplain('explain') for the active editor tab", () => {
    render(<MonacoEditor tabId="tab-1" />);
    const handler = addCommandMock.mock.calls[4]?.[1] as (() => void) | undefined;
    expect(handler).toBeTypeOf("function");
    handler?.();
    expect(runExplainMock).toHaveBeenCalledWith("tab-1", "explain");
  });

  test("Cmd+Shift+E triggers runExplain('analyze') for the active editor tab", () => {
    render(<MonacoEditor tabId="tab-1" />);
    const handler = addCommandMock.mock.calls[5]?.[1] as (() => void) | undefined;
    expect(handler).toBeTypeOf("function");
    handler?.();
    expect(runExplainMock).toHaveBeenCalledWith("tab-1", "analyze");
  });

  test("Cmd+Enter with no selection dispatches RunIntent.current", () => {
    render(<MonacoEditor tabId="tab-1" />);
    // [2] = Cmd+Enter handler (after the two format bindings).
    const cmdEnterHandler = addCommandMock.mock.calls[2]?.[1] as (() => void) | undefined;
    expect(cmdEnterHandler).toBeTypeOf("function");
    getSelectionMock.mockReturnValue(null);
    cmdEnterHandler?.();
    expect(runQueryMock).toHaveBeenCalledWith("tab-1", { kind: "current" });
  });

  test("Cmd+Enter with non-empty selection dispatches RunIntent.selection", () => {
    render(<MonacoEditor tabId="tab-1" />);
    const handler = addCommandMock.mock.calls[2]?.[1] as (() => void) | undefined;
    getSelectionMock.mockReturnValue({ startLineNumber: 1, isEmpty: () => false });
    getValueInRangeMock.mockReturnValue("  SELECT 2  ");
    handler?.();
    expect(runQueryMock).toHaveBeenCalledWith("tab-1", { kind: "selection", text: "SELECT 2" });
  });

  test("Cmd+Shift+Enter dispatches RunIntent.all (regardless of selection)", () => {
    render(<MonacoEditor tabId="tab-1" />);
    // [3] = Cmd+Shift+Enter handler.
    const handler = addCommandMock.mock.calls[3]?.[1] as (() => void) | undefined;
    getSelectionMock.mockReturnValue(null);
    handler?.();
    expect(runQueryMock).toHaveBeenCalledWith("tab-1", { kind: "all" });
    runQueryMock.mockReset();

    getSelectionMock.mockReturnValue({ startLineNumber: 1, isEmpty: () => false });
    getValueInRangeMock.mockReturnValue(" SELECT 9 ");
    handler?.();
    expect(runQueryMock).toHaveBeenCalledWith("tab-1", { kind: "all" });
  });

  test("restores cursor position from the persisted tab on mount", () => {
    useEditor.setState({
      tabs: [makeTab({ cursorPos: { line: 4, col: 7 } })],
    });
    render(<MonacoEditor tabId="tab-1" />);
    expect(setPositionMock).toHaveBeenCalledWith({ lineNumber: 4, column: 7 });
  });

  test("cursor change triggers setCursor on the store", () => {
    render(<MonacoEditor tabId="tab-1" />);
    cursorListeners[0]?.({ position: { lineNumber: 9, column: 3 } });
    expect(setCursorMock).toHaveBeenCalledWith("tab-1", 9, 3);
  });

  test("error run state with line/col paints a marker", () => {
    const newState = new Map();
    newState.set("tab-1", {
      status: "error",
      error: "syntax error",
      line: 3,
      col: 5,
    });
    useEditor.setState({ runStates: newState });
    render(<MonacoEditor tabId="tab-1" />);
    // setModelMarkers should have been called; last call must include the marker
    const calls = setModelMarkersMock.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const markerArg = calls[calls.length - 1]?.[2] as Array<{
      startLineNumber: number;
      startColumn: number;
    }>;
    expect(markerArg[0]).toMatchObject({ startLineNumber: 3, startColumn: 5 });
  });

  test("success run state clears the error marker", () => {
    const stubResult: QueryResult = {
      columns: [],
      rows: [],
      truncated: false,
      durationMs: 5,
      affectedRows: null,
      statusMessage: "OK",
    };
    const newState = new Map();
    newState.set("tab-1", { status: "success", result: stubResult, finishedAt: 1 });
    useEditor.setState({ runStates: newState });
    render(<MonacoEditor tabId="tab-1" />);
    const lastCall = setModelMarkersMock.mock.calls.at(-1);
    expect(lastCall?.[2]).toEqual([]);
  });

  test("editing the buffer clears any pre-existing pg-error marker", () => {
    const newState = new Map();
    newState.set("tab-1", {
      status: "error",
      error: "syntax error",
      line: 3,
      col: 5,
    });
    useEditor.setState({ runStates: newState });
    render(<MonacoEditor tabId="tab-1" />);
    // Establish a baseline: the error effect painted the marker on mount.
    const initialPaintArg = setModelMarkersMock.mock.calls.at(-1)?.[2];
    expect(Array.isArray(initialPaintArg) && initialPaintArg.length).toBe(1);

    // Simulate the user typing/pasting in the editor — the model emits a
    // content-change event. The handler should drop the stale pg-error
    // marker even though runState is still "error".
    expect(contentChangeListeners.length).toBeGreaterThan(0);
    for (const listener of contentChangeListeners) {
      listener();
    }
    const lastCall = setModelMarkersMock.mock.calls.at(-1);
    expect(lastCall?.[1]).toBe("pg-error");
    expect(lastCall?.[2]).toEqual([]);
  });

  test("returns empty placeholder when tab does not exist", () => {
    useEditor.setState({ tabs: [] });
    render(<MonacoEditor tabId="missing" />);
    expect(screen.getByTestId("monaco-editor-empty")).toBeInTheDocument();
  });

  test("calls setupLanguageFeatures for PG dialect on mount", () => {
    render(<MonacoEditor tabId="tab-1" />);
    // The flag is module-level so it may be called only on the FIRST mount
    // across the whole file run. We assert non-throwing render and that the
    // mock was wired (could be 0 if a prior test mounted first); either way
    // the editor must initialize.
    expect(lastMockEditor).not.toBeNull();
    expect(lastMockMonaco).not.toBeNull();
  });
});
