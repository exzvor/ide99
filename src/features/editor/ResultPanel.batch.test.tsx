import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StatementResult } from "../../lib/tauri";
import { ResultPanel } from "./ResultPanel";
import { type BatchRunState, type Tab, useEditor } from "./store";

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

const initialState = useEditor.getState();

function makeTab(): Tab {
  return {
    id: "t1",
    kind: "editor",
    name: "untitled-1",
    content: "",
    connectionId: "c-1",
    cursorPos: { line: 1, col: 1 },
    dirty: false,
    createdAt: "2026-04-30T00:00:00Z",
    updatedAt: "2026-04-30T00:00:00Z",
  };
}

function rowset(idx: number, rows = [["1"]], truncated = false): StatementResult {
  return {
    kind: "rowset",
    index: idx,
    sql: `SELECT ${idx + 1}`,
    columns: [],
    rows,
    truncated,
    cursorId: null,
    exhausted: true,
    durationMs: 5,
    statusMessage: "SELECT",
  };
}

function dml(idx: number, affected: number): StatementResult {
  return {
    kind: "dml",
    index: idx,
    sql: "INSERT INTO foo VALUES(1)",
    affectedRows: affected,
    durationMs: 4,
    statusMessage: "INSERT",
  };
}

function errResult(idx: number): StatementResult {
  return {
    kind: "error",
    index: idx,
    sql: "BROKEN",
    error: { kind: "postgresError", message: "syntax error", position: null },
  };
}

function setBatch(statements: StatementResult[], activeIdx = 0, failedAt: number | null = null) {
  const ready: BatchRunState = {
    status: "ready",
    statements,
    activeIdx,
    totalDurationMs: 10,
    failedAt,
  };
  useEditor.setState({
    ...initialState,
    tabs: [makeTab()],
    activeTabId: "t1",
    runStates: new Map(),
    batchRunStates: new Map([["t1", ready]]),
  });
}

afterEach(() => {
  useEditor.setState(initialState, true);
});

describe("ResultPanel batch view", () => {
  it("renders one tab per statement with status row", () => {
    setBatch([rowset(0, [["1"]]), dml(1, 3), rowset(2, [["2"]])], 2);
    render(<ResultPanel tabId="t1" />);
    expect(screen.getByTestId("batch-tab-0")).toBeInTheDocument();
    expect(screen.getByTestId("batch-tab-1")).toBeInTheDocument();
    expect(screen.getByTestId("batch-tab-2")).toBeInTheDocument();
    // The summary uses i18n key `editor.batch.summary_ok` — under the
    // identity-mock, this key shows up verbatim in the strip text content.
    const strip = screen.getByTestId("result-panel-tabstrip");
    expect(strip.textContent).toContain("editor.batch.summary_ok");
  });

  it("clicking a tab calls setActiveBatchTab", () => {
    setBatch([rowset(0), rowset(1)], 1);
    render(<ResultPanel tabId="t1" />);
    fireEvent.click(screen.getByTestId("batch-tab-0"));
    const next = useEditor.getState().batchRunStates.get("t1");
    expect(next?.status).toBe("ready");
    if (next?.status === "ready") {
      expect(next.activeIdx).toBe(0);
    }
  });

  it("renders the failure summary when failedAt is set", () => {
    setBatch([rowset(0), errResult(1)], 1, 1);
    render(<ResultPanel tabId="t1" />);
    const strip = screen.getByTestId("result-panel-tabstrip");
    expect(strip.textContent).toContain("editor.batch.summary_failed");
    // Error tab carries the tone-error class.
    expect(screen.getByTestId("batch-tab-1").className).toContain("tone-error");
  });

  it("renders the truncation hint only when active rowset is truncated", () => {
    setBatch([rowset(0, [["1"]], true)], 0);
    render(<ResultPanel tabId="t1" />);
    expect(screen.getByTestId("result-panel-truncated-hint")).toBeInTheDocument();
  });

  it("does NOT render truncation hint for non-truncated active rowset", () => {
    setBatch([rowset(0, [["1"]], false)], 0);
    render(<ResultPanel tabId="t1" />);
    expect(screen.queryByTestId("result-panel-truncated-hint")).not.toBeInTheDocument();
  });

  it("does NOT render the strip when batchRunStates is absent", () => {
    useEditor.setState({
      ...initialState,
      tabs: [makeTab()],
      activeTabId: "t1",
      runStates: new Map(),
      batchRunStates: new Map(),
    });
    render(<ResultPanel tabId="t1" />);
    expect(screen.queryByTestId("result-panel-tabstrip")).not.toBeInTheDocument();
  });
});
