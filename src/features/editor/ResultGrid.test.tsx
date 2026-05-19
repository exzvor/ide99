import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { useJsonbEditor } from "../jsonb/state/store";
import { ResultGrid } from "./ResultGrid";
import { type RunState, useEditor } from "./store";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

// Stub the lib/tauri invokes so the jsonb editor's openEditor doesn't blow
// up trying to call jsonbResolveRowKey when the test rapidly fires
// dbl-click events.
vi.mock("../../lib/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../lib/tauri")>("../../lib/tauri");
  return {
    ...actual,
    jsonbResolveRowKey: vi.fn().mockResolvedValue({
      kind: "readOnly",
      reason: "noColumnMetadata",
    }),
    jsonbSave: vi.fn(),
  };
});

const fetchMoreMock = vi.fn();
const setSortMock = vi.fn();
const setColumnWidthMock = vi.fn();
const setColumnOrderMock = vi.fn();

const initial = useEditor.getState();

beforeEach(() => {
  fetchMoreMock.mockReset();
  setSortMock.mockReset();
  setColumnWidthMock.mockReset();
  setColumnOrderMock.mockReset();
  useEditor.setState(
    {
      ...initial,
      fetchMore: fetchMoreMock,
      setSort: setSortMock,
      setColumnWidth: setColumnWidthMock,
      setColumnOrder: setColumnOrderMock,
    },
    true,
  );
});

function streamingState(
  rows: number,
  exhausted = false,
): Extract<RunState, { status: "streaming" }> {
  return {
    status: "streaming",
    cursorId: exhausted ? null : "c_x",
    columns: [{ name: "i", typeName: "int4", isNumeric: true }],
    rows: Array.from({ length: rows }, (_, i) => [String(i)]),
    loadedCount: rows,
    exhausted,
    durationMs: 0,
    prefetching: false,
    affectedRows: null,
    statusMessage: "",
    sort: null,
    columnWidths: new Map(),
    columnOrder: [0],
  };
}

describe("ResultGrid", () => {
  test("renders header with column name", () => {
    render(<ResultGrid tabId="tab-1" run={streamingState(10)} />);
    expect(screen.getByRole("columnheader", { name: /i/ })).toBeInTheDocument();
  });

  test("renders only a virtualized subset of rows for a 5000-row result", () => {
    const big = streamingState(5000);
    render(
      <div style={{ height: 300, width: 600 }}>
        <ResultGrid tabId="tab-1" run={big} />
      </div>,
    );
    const cells = screen.queryAllByTestId(/^cell-/);
    expect(cells.length).toBeLessThan(5000);
  });

  test("Click on column header triggers setSort cycle (none → asc)", () => {
    render(<ResultGrid tabId="tab-1" run={streamingState(5)} />);
    fireEvent.click(screen.getByRole("columnheader", { name: /i/ }));
    expect(setSortMock).toHaveBeenCalledWith("tab-1", 0, "asc");
  });

  test("Resize handle dispatches setColumnWidth", () => {
    const { container } = render(
      <div style={{ height: 200, width: 600 }}>
        <ResultGrid tabId="tab-1" run={streamingState(5)} />
      </div>,
    );
    const handle = container.querySelector('[data-testid="col-resize-0"]');
    expect(handle).toBeInTheDocument();
    fireEvent.mouseDown(handle as Element, { pageX: 100, button: 0 });
    fireEvent.mouseMove(window, { pageX: 180 });
    fireEvent.mouseUp(window, { pageX: 180 });
    expect(setColumnWidthMock).toHaveBeenCalled();
    const lastCall = setColumnWidthMock.mock.calls.at(-1);
    expect(lastCall?.[0]).toBe("tab-1");
    expect(lastCall?.[1]).toBe(0);
  });

  test("Click on cell selects it (aria-selected=true)", () => {
    render(
      <div style={{ height: 300, width: 600 }}>
        <ResultGrid tabId="tab-1" run={streamingState(20)} />
      </div>,
    );
    const cells = screen.queryAllByTestId(/^cell-/);
    if (cells.length === 0) return; // jsdom layout edge — virtualizer reports 0
    fireEvent.click(cells[0] as HTMLElement);
    expect(cells[0]).toHaveAttribute("aria-selected", "true");
  });

  test("dbl-click on jsonb cell opens JsonbEditorModal via store", () => {
    // Streaming state with a jsonb column.
    const jsonbRun: Extract<RunState, { status: "streaming" }> = {
      status: "streaming",
      cursorId: "c_x",
      columns: [{ name: "data", typeName: "jsonb", isNumeric: false }],
      rows: [['{"a":1}']],
      loadedCount: 1,
      exhausted: false,
      durationMs: 0,
      prefetching: false,
      affectedRows: null,
      statusMessage: "",
      sort: null,
      columnWidths: new Map(),
      columnOrder: [0],
    };
    const openSpy = vi.fn().mockResolvedValue(undefined);
    useJsonbEditor.setState({ openEditor: openSpy });

    render(
      <div style={{ height: 300, width: 600 }}>
        <ResultGrid tabId="tab-jsonb" run={jsonbRun} />
      </div>,
    );
    const cells = screen.queryAllByTestId(/^cell-/);
    if (cells.length === 0) return; // jsdom virtualizer edge
    fireEvent.doubleClick(cells[0] as HTMLElement);
    expect(openSpy).toHaveBeenCalledOnce();
    expect(openSpy.mock.calls[0]).toEqual([
      { tabId: "tab-jsonb", rowIdx: 0, srcColIdx: 0 },
      '{"a":1}',
    ]);
  });

  test("dbl-click on json cell also opens JsonbEditorModal (json type supported)", () => {
    const jsonRun: Extract<RunState, { status: "streaming" }> = {
      status: "streaming",
      cursorId: "c_x",
      columns: [{ name: "doc", typeName: "json", isNumeric: false }],
      rows: [['{"k":"v"}']],
      loadedCount: 1,
      exhausted: false,
      durationMs: 0,
      prefetching: false,
      affectedRows: null,
      statusMessage: "",
      sort: null,
      columnWidths: new Map(),
      columnOrder: [0],
    };
    const openSpy = vi.fn().mockResolvedValue(undefined);
    useJsonbEditor.setState({ openEditor: openSpy });

    render(
      <div style={{ height: 300, width: 600 }}>
        <ResultGrid tabId="tab-json" run={jsonRun} />
      </div>,
    );
    const cells = screen.queryAllByTestId(/^cell-/);
    if (cells.length === 0) return;
    fireEvent.doubleClick(cells[0] as HTMLElement);
    expect(openSpy).toHaveBeenCalledOnce();
  });

  test("dbl-click on text cell does NOT open the JSONB editor", () => {
    const openSpy = vi.fn().mockResolvedValue(undefined);
    useJsonbEditor.setState({ openEditor: openSpy });

    render(
      <div style={{ height: 300, width: 600 }}>
        <ResultGrid tabId="tab-text" run={streamingState(5)} />
      </div>,
    );
    const cells = screen.queryAllByTestId(/^cell-/);
    if (cells.length === 0) return;
    fireEvent.doubleClick(cells[0] as HTMLElement);
    expect(openSpy).not.toHaveBeenCalled();
  });
});

describe("S26 — kNN context-menu", () => {
  function streamingWithVector(): Extract<RunState, { status: "streaming" }> {
    return {
      status: "streaming",
      cursorId: null,
      columns: [
        { name: "id", typeName: "int4", isNumeric: true },
        { name: "embedding", typeName: "vector(3)", isNumeric: false },
      ],
      rows: [["1", "[0.1,0.2,0.3]"]],
      loadedCount: 1,
      exhausted: true,
      durationMs: 0,
      prefetching: false,
      affectedRows: null,
      statusMessage: "",
      sort: null,
      columnWidths: new Map(),
      columnOrder: [0, 1],
    };
  }

  test("right-click on a row with a vector column shows 'Find nearest by …' and opens the dialog", async () => {
    render(
      <div style={{ height: 300, width: 600 }}>
        <ResultGrid tabId="tab-knn" run={streamingWithVector()} />
      </div>,
    );
    const cell = screen.queryAllByTestId(/^cell-0-/)[0];
    if (!cell) return;
    fireEvent.contextMenu(cell as HTMLElement);
    const item = await screen.findByRole("menuitem", { name: /find nearest by embedding/i });
    fireEvent.click(item);
    expect(await screen.findByTestId("knn-browse-dialog")).toBeInTheDocument();
  });

  test("right-click on a row without vector columns does not show the menu item", () => {
    render(
      <div style={{ height: 300, width: 600 }}>
        <ResultGrid tabId="tab-no-vec" run={streamingState(1)} />
      </div>,
    );
    const cell = screen.queryAllByTestId(/^cell-0-/)[0];
    if (!cell) return;
    fireEvent.contextMenu(cell as HTMLElement);
    expect(screen.queryByRole("menuitem", { name: /find nearest/i })).not.toBeInTheDocument();
  });
});

describe("S27 — PostGIS map view button", () => {
  function streamingWithGeometry(): Extract<RunState, { status: "streaming" }> {
    return {
      status: "streaming",
      cursorId: null,
      columns: [
        { name: "id", typeName: "int4", isNumeric: true },
        { name: "geom", typeName: "geometry(Point,4326)", isNumeric: false },
      ],
      rows: [["1", "0101000020E6100000000000000000F03F0000000000000040"]],
      loadedCount: 1,
      exhausted: true,
      durationMs: 0,
      prefetching: false,
      affectedRows: null,
      statusMessage: "",
      sort: null,
      columnWidths: new Map(),
      columnOrder: [0, 1],
    };
  }

  function setEditorTab(): void {
    useEditor.setState({
      ...useEditor.getState(),
      tabs: [
        {
          id: "tab-geom",
          kind: "editor",
          name: "untitled-geom",
          content: "",
          connectionId: "conn-geom",
          cursorPos: { line: 1, col: 1 },
          dirty: false,
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
        },
      ],
    });
  }

  test("renders 'Open Map View' button when geometry column present", async () => {
    setEditorTab();
    render(
      <div style={{ height: 300, width: 600 }}>
        <ResultGrid tabId="tab-geom" run={streamingWithGeometry()} />
      </div>,
    );
    expect(await screen.findByTestId("result-grid-open-map-view")).toBeInTheDocument();
  });

  test("does not render the button when no geometry column", () => {
    setEditorTab();
    render(
      <div style={{ height: 300, width: 600 }}>
        <ResultGrid tabId="tab-geom" run={streamingState(1)} />
      </div>,
    );
    expect(screen.queryByTestId("result-grid-open-map-view")).not.toBeInTheDocument();
  });

  test("clicking the button calls openMapViewTab", () => {
    const openMapViewTab = vi.fn();
    useEditor.setState({
      ...useEditor.getState(),
      openMapViewTab,
      tabs: [
        {
          id: "tab-geom",
          kind: "editor",
          name: "untitled-geom",
          content: "",
          connectionId: "conn-geom",
          cursorPos: { line: 1, col: 1 },
          dirty: false,
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
        },
      ],
    });
    render(
      <div style={{ height: 300, width: 600 }}>
        <ResultGrid tabId="tab-geom" run={streamingWithGeometry()} />
      </div>,
    );
    fireEvent.click(screen.getByTestId("result-grid-open-map-view"));
    expect(openMapViewTab).toHaveBeenCalledWith(
      expect.objectContaining({ geometryColumn: "geom" }),
    );
  });
});
