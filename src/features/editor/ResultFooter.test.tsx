import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { ResultFooter } from "./ResultFooter";
import type { RunState } from "./store";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${JSON.stringify(opts)}` : key,
    i18n: { language: "en" },
  }),
}));

type Streaming = Extract<RunState, { status: "streaming" }>;

const baseStreaming: Omit<Streaming, "status"> = {
  cursorId: null,
  columns: [],
  rows: [],
  loadedCount: 0,
  exhausted: false,
  durationMs: 0,
  prefetching: false,
  affectedRows: null,
  statusMessage: "",
  sort: null,
  columnWidths: new Map<number, number>(),
  columnOrder: [],
};

describe("ResultFooter", () => {
  test("loading: shows N + loading template", () => {
    render(<ResultFooter run={{ ...baseStreaming, status: "streaming", loadedCount: 5000 }} />);
    expect(screen.getByText(/editor\.result\.rows_loading.*5000/)).toBeInTheDocument();
  });

  test("prefetching: uses prefetching template", () => {
    render(
      <ResultFooter
        run={{ ...baseStreaming, status: "streaming", loadedCount: 5000, prefetching: true }}
      />,
    );
    expect(screen.getByText(/editor\.result\.rows_prefetching.*5000/)).toBeInTheDocument();
  });

  test("exhausted: uses done template", () => {
    render(
      <ResultFooter
        run={{ ...baseStreaming, status: "streaming", loadedCount: 12438, exhausted: true }}
      />,
    );
    expect(screen.getByText(/editor\.result\.rows_done.*12438/)).toBeInTheDocument();
  });

  test("affected: DML uses affected template", () => {
    render(
      <ResultFooter
        run={{
          ...baseStreaming,
          status: "streaming",
          loadedCount: 0,
          exhausted: true,
          affectedRows: 5,
        }}
      />,
    );
    expect(screen.getByText(/editor\.result\.rows_affected.*5/)).toBeInTheDocument();
  });

  test("sort indicator: shows column name + dir when sort is set", () => {
    render(
      <ResultFooter
        run={{
          ...baseStreaming,
          status: "streaming",
          loadedCount: 100,
          columns: [{ name: "created_at", typeName: "timestamp", isNumeric: false }],
          columnOrder: [0],
          sort: { columnIdx: 0, dir: "desc" },
        }}
      />,
    );
    const sortChip = screen.getByTestId("result-footer-sort");
    expect(sortChip.textContent).toMatch(/created_at/);
    expect(sortChip.textContent).toMatch(/desc/);
  });
});
