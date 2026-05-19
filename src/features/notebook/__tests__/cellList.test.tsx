/**
 * — CellList integration tests.
 *
 * The SQL cell mounts Monaco; in jsdom we mock @monaco-editor/react with
 * a plain textarea so the rest of the UI (drag-handle, toolbar, run
 * button, Markdown preview) renders. Drag-and-drop is exercised through
 * direct event dispatch; the goal is to assert the state transitions,
 * not to validate browser DnD semantics.
 */
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@monaco-editor/react", () => ({
  Editor: ({
    value,
    onChange,
  }: {
    value: string;
    onChange?: (next: string | undefined) => void;
  }) => (    <textarea
      data-testid="monaco-stub"
      value={value ?? ""}
      onChange={(e) => onChange?.(e.target.value)}
    />
),
}));

vi.mock("monaco-sql-languages", () => ({
  LanguageIdEnum: { PG: "pgsql" },
  setupLanguageFeatures: vi.fn(),
}));

vi.mock("../../editor/monacoQuietTheme", () => ({
  readResolvedQuietTheme: () => "quiet-light",
  registerQuietThemes: vi.fn(),
}));

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: vi.fn(),
}));

const FAKE_DICT: Record<string, string> = {
  "notebook.action.add_sql": "+ SQL cell",
  "notebook.action.add_markdown": "+ Markdown",
  "notebook.action.delete": "Delete",
  "notebook.action.duplicate": "Duplicate",
  "notebook.action.move_up": "Move up",
  "notebook.action.move_down": "Move down",
  "notebook.action.run_all": "Run all",
  "notebook.action.run_from": "Run from here",
  "notebook.action.drag": "Drag to reorder",
  "notebook.action.run_cell": "Run cell",
  "notebook.action.run_cell_icon": "Run",
  "notebook.empty": "Notebook is empty.",
  "notebook.cell_count": "{{count}} cells",
  "notebook.no_connection_hint": "Pick a connection.",
  "notebook.cell_kind.sql": "SQL",
  "notebook.cell_kind.markdown": "Markdown",
  "notebook.cell_kind.result": "Result",
  "notebook.cte.share_label": "Share as CTE",
  "notebook.cte.name_label": "CTE name",
  "notebook.cte.help": "Share help",
  "notebook.markdown.edit": "Edit",
  "notebook.markdown.preview": "Preview",
  "notebook.markdown.empty_hint": "Empty",
  "notebook.status.idle": "Idle",
  "notebook.status.running": "Running",
  "notebook.status.ok": "OK",
  "notebook.status.error": "Error",
};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const base = FAKE_DICT[key] ?? key;
      if (opts && typeof opts === "object") {
        return Object.entries(opts).reduce<string>(          (acc, [k, v]) => acc.replace(`{{${k}}}`, String(v)),
          base,
);
      }
      return base;
    },
  }),
}));

import { CellList } from "../CellList";
import { useNotebooks } from "../store";
import type { Notebook } from "../types";

function nb(partial: Partial<Notebook> = {}): Notebook {
  return {
    id: "nb-1",
    name: "Test",
    cells: [],
    connectionId: null,
    filePath: null,
    createdAt: "2026-05-06T00:00:00Z",
    updatedAt: "2026-05-06T00:00:00Z",
    ...partial,
  };
}

beforeEach(() => {
  invokeMock.mockReset();
  useNotebooks.setState({
    byId: {},
    loaded: false,
    runStateByCellId: {},
    runningByNotebookId: {},
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CellList", () => {
  it("renders the empty placeholder when there are no cells", () => {
    const onChange = vi.fn();
    render(<CellList notebook={nb()} onChange={onChange} connectionId={null} />);
    expect(screen.getByTestId("notebook-empty")).toBeInTheDocument();
    expect(screen.getByText(/no_connection_hint|Pick a connection/i)).toBeInTheDocument();
  });

  it("clicking + SQL cell adds a new sql cell via onChange", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<CellList notebook={nb()} onChange={onChange} connectionId="c1" />);
    await user.click(screen.getByTestId("notebook-add-sql"));
    expect(onChange).toHaveBeenCalled();
    const next = onChange.mock.calls[0]?.[0] as Notebook;
    expect(next.cells).toHaveLength(1);
    expect(next.cells[0]?.kind).toBe("sql");
  });

  it("clicking + Markdown adds a markdown cell", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<CellList notebook={nb()} onChange={onChange} connectionId="c1" />);
    await user.click(screen.getByTestId("notebook-add-markdown"));
    const next = onChange.mock.calls[0]?.[0] as Notebook;
    expect(next.cells[0]?.kind).toBe("markdown");
  });

  it("delete button removes the targeted cell", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const start = nb({
      cells: [
        { kind: "sql", id: "a", source: "SELECT 1", shareAsCte: false },
        { kind: "sql", id: "b", source: "SELECT 2", shareAsCte: false },
      ],
    });
    render(<CellList notebook={start} onChange={onChange} connectionId="c1" />);
    await user.click(screen.getByTestId("cell-a-delete"));
    const next = onChange.mock.calls[0]?.[0] as Notebook;
    expect(next.cells.map((c) => c.id)).toEqual(["b"]);
  });

  it("duplicate button inserts a copy without the result snapshot", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const start = nb({
      cells: [
        {
          kind: "sql",
          id: "src",
          source: "SELECT 1",
          shareAsCte: false,
          result: {
            columns: ["n"],
            rows: [["1"]],
            truncated: false,
            durationMs: 1,
            executedAt: "2026-05-06T00:00:00Z",
          },
        },
      ],
    });
    render(<CellList notebook={start} onChange={onChange} connectionId="c1" />);
    await user.click(screen.getByTestId("cell-src-duplicate"));
    const next = onChange.mock.calls[0]?.[0] as Notebook;
    expect(next.cells).toHaveLength(2);
    const dup = next.cells[1];
    if (!dup || dup.kind !== "sql") throw new Error("expected duplicated sql cell");
    expect(dup.id).not.toBe("src");
    expect(dup.source).toBe("SELECT 1");
    expect(dup.result).toBeUndefined();
  });

  it("move up / move down reorder cells", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const start = nb({
      cells: [
        { kind: "markdown", id: "a", source: "# A" },
        { kind: "markdown", id: "b", source: "# B" },
      ],
    });
    render(<CellList notebook={start} onChange={onChange} connectionId="c1" />);
    await user.click(screen.getByTestId("cell-b-up"));
    const moved = onChange.mock.calls[0]?.[0] as Notebook;
    expect(moved.cells.map((c) => c.id)).toEqual(["b", "a"]);
  });

  it("disables Run all when there is no connection", () => {
    const onChange = vi.fn();
    const start = nb({
      cells: [{ kind: "sql", id: "a", source: "SELECT 1", shareAsCte: false }],
    });
    render(<CellList notebook={start} onChange={onChange} connectionId={null} />);
    expect(screen.getByTestId("notebook-run-all")).toBeDisabled();
  });

  it("disables Run all when there are no SQL cells", () => {
    const onChange = vi.fn();
    const start = nb({
      cells: [{ kind: "markdown", id: "a", source: "hi" }],
    });
    render(<CellList notebook={start} onChange={onChange} connectionId="c1" />);
    expect(screen.getByTestId("notebook-run-all")).toBeDisabled();
  });

  it("toggling Share-as-CTE flips the cell flag", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const start = nb({
      cells: [{ kind: "sql", id: "a", source: "SELECT 1", shareAsCte: false }],
    });
    render(<CellList notebook={start} onChange={onChange} connectionId="c1" />);
    await user.click(screen.getByTestId("sql-cell-a-cte-toggle"));
    const flipped = onChange.mock.calls[0]?.[0] as Notebook;
    const cell = flipped.cells[0];
    if (!cell || cell.kind !== "sql") throw new Error("expected sql cell");
    expect(cell.shareAsCte).toBe(true);
  });

  it("HTML5 drop reorders cells from source onto target", () => {
    const onChange = vi.fn();
    const start = nb({
      cells: [
        { kind: "markdown", id: "a", source: "A" },
        { kind: "markdown", id: "b", source: "B" },
        { kind: "markdown", id: "c", source: "C" },
      ],
    });
    render(<CellList notebook={start} onChange={onChange} connectionId="c1" />);
    const cellA = screen.getByTestId("cell-a");
    const cellC = screen.getByTestId("cell-c");
    const data = new Map<string, string>();
    const dt = {
      data,
      setData: (key: string, value: string) => data.set(key, value),
      getData: (key: string) => data.get(key) ?? "",
      effectAllowed: "move",
      dropEffect: "move",
    } as unknown as DataTransfer;
    fireEvent.dragStart(cellA, { dataTransfer: dt });
    fireEvent.dragOver(cellC, { dataTransfer: dt });
    fireEvent.drop(cellC, { dataTransfer: dt });
    const moved = onChange.mock.calls.at(-1)?.[0] as Notebook;
    expect(moved.cells.map((c) => c.id)).toEqual(["b", "c", "a"]);
  });

  it("renders a markdown preview by default for non-empty markdown cells", () => {
    const onChange = vi.fn();
    const start = nb({
      cells: [{ kind: "markdown", id: "m1", source: "# Hello" }],
    });
    render(<CellList notebook={start} onChange={onChange} connectionId={null} />);
    const preview = screen.getByTestId("md-cell-m1-preview");
    expect(within(preview).getByText("Hello")).toBeInTheDocument();
  });

  it("renders the result table for SQL cells with snapshots", () => {
    const onChange = vi.fn();
    const start = nb({
      cells: [
        {
          kind: "sql",
          id: "a",
          source: "SELECT 1 AS n",
          shareAsCte: false,
          result: {
            columns: ["n"],
            rows: [["1"]],
            truncated: false,
            durationMs: 4,
            executedAt: "2026-05-06T00:00:00Z",
          },
        },
      ],
    });
    render(<CellList notebook={start} onChange={onChange} connectionId="c1" />);
    expect(screen.getByTestId("result-cell-a-table")).toBeInTheDocument();
    expect(screen.getByText("n")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });
});
