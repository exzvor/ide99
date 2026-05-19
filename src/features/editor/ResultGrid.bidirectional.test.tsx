// src/features/editor/ResultGrid.bidirectional.test.tsx
//
// S20 — verifies the header filter dropdown wires through to
// `useEditor.setFilter`. Forward direction (UI → store) is covered here;
// the reverse direction (SQL edit → store → grid icon update) is covered
// by Playwright in `tests/e2e/s20-select-bidirectional.spec.ts`.

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResultGrid } from "./ResultGrid";
import { type RunState, useEditor } from "./store";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? k,
  }),
}));

vi.mock("../connections/store", () => ({
  useConnections: (selector: unknown) =>
    typeof selector === "function"
      ? (selector as (s: { connections: unknown[] }) => unknown)({ connections: [] })
      : { connections: [] },
}));

vi.mock("../jsonb/state/store", () => ({
  useJsonbEditor: (selector: unknown) =>
    typeof selector === "function" ? (selector as (s: Record<string, unknown>) => unknown)({}) : {},
}));

vi.mock("./Cell", () => ({ Cell: () => <span data-testid="cell" /> }));
vi.mock("./ValueModal", () => ({ ValueModal: () => null }));

const TAB = "tab-1";

const streamingRun: Extract<RunState, { status: "streaming" }> = {
  status: "streaming",
  cursorId: null,
  columns: [
    { name: "id", typeName: "integer", isNumeric: true },
    { name: "email", typeName: "text", isNumeric: false },
  ],
  rows: [["1", "a@x"]],
  loadedCount: 1,
  exhausted: true,
  durationMs: 5,
  prefetching: false,
  affectedRows: null,
  statusMessage: "",
  sort: null,
  columnWidths: new Map(),
  columnOrder: [0, 1],
};

beforeEach(() => {
  // The store hosts queryShapes; seed a flat shape that enables filter icons.
  useEditor.setState(() => ({
    queryShapes: new Map([
      [
        TAB,
        {
          baseSelect: { schema: null, table: "users", columns: [] },
          filters: [],
          sort: null,
          limit: null,
          unrepresentableTail: null,
          whereSpan: null,
          orderBySpan: null,
          limitSpan: null,
          fromEnd: 19,
        },
      ],
    ]),
  }));
});

afterEach(() => {
  useEditor.setState(() => ({ queryShapes: new Map(), lastExecutedShape: new Map() }));
});

describe("ResultGrid filter dropdown", () => {
  it("renders filter icon per column when shape is flat", () => {
    render(<ResultGrid tabId={TAB} run={streamingRun} />);
    expect(screen.getByTestId("filter-icon-0")).toBeInTheDocument();
    expect(screen.getByTestId("filter-icon-1")).toBeInTheDocument();
  });

  // — filter icon aria-label is i18n-driven (no hardcoded strings).
  it("uses i18n key for filter icon aria-label", () => {
    render(<ResultGrid tabId={TAB} run={streamingRun} />);
    // The mock returns the key itself (no defaultValue), so we should see the
    // raw key string from the locale namespace.
    const icon = screen.getByTestId("filter-icon-0");
    expect(icon.getAttribute("aria-label")).toBe("filter.column_button_aria");
    expect(icon.getAttribute("title")).toBe("filter.column_button_title");
  });

  it("hides filter icons when queryShape is null", () => {
    useEditor.setState(() => ({ queryShapes: new Map() }));
    render(<ResultGrid tabId={TAB} run={streamingRun} />);
    expect(screen.queryByTestId("filter-icon-0")).toBeNull();
  });

  it("hides filter icons when shape has unrepresentable tail", () => {
    useEditor.setState((s) => {
      const cur = s.queryShapes.get(TAB);
      if (!cur) return {};
      const next = new Map(s.queryShapes);
      next.set(TAB, { ...cur, unrepresentableTail: "non-flat-from" });
      return { queryShapes: next };
    });
    render(<ResultGrid tabId={TAB} run={streamingRun} />);
    expect(screen.queryByTestId("filter-icon-0")).toBeNull();
  });

  it("clicking icon opens the dropdown popover", () => {
    render(<ResultGrid tabId={TAB} run={streamingRun} />);
    fireEvent.click(screen.getByTestId("filter-icon-0"));
    expect(screen.getByTestId("filter-dropdown-host-0")).toBeInTheDocument();
  });

  it("Apply in dropdown calls setFilter with the column name", () => {
    render(<ResultGrid tabId={TAB} run={streamingRun} />);
    fireEvent.click(screen.getByTestId("filter-icon-0"));
    // dropdown is open — change op to gt and value to 5, then Apply
    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "gt" } });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "5" } });
    fireEvent.click(screen.getByText(/^Apply$/i));
    const filters = useEditor.getState().queryShapes.get(TAB)?.filters ?? [];
    expect(filters).toHaveLength(1);
    expect(filters[0].column).toBe("id");
    expect(filters[0].op).toBe("gt");
    expect(filters[0].value).toBe(5);
  });

  it("filter icon shows active class when a filter is set for that column", () => {
    useEditor.setState((s) => {
      const cur = s.queryShapes.get(TAB);
      if (!cur) return {};
      const next = new Map(s.queryShapes);
      next.set(TAB, {
        ...cur,
        filters: [{ column: "id", op: "eq", value: 1 }],
      });
      return { queryShapes: next };
    });
    render(<ResultGrid tabId={TAB} run={streamingRun} />);
    expect(screen.getByTestId("filter-icon-0").className).toContain("active");
    expect(screen.getByTestId("filter-icon-1").className).not.toContain("active");
  });
});
