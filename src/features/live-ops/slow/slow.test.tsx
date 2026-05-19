import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEditor } from "../../editor/store";
import { useLiveOps } from "../store";
import { SlowQueriesPane } from "./SlowQueriesPane";

const snap = {
  rows: [
    {
      query: "SELECT 1",
      meanExecTimeMs: 10.5,
      totalExecTimeMs: 100,
      calls: 10,
      meanRows: 1,
      rolname: "u",
    },
  ],
  sortBy: "meanExecTime" as const,
  fetchedAt: new Date().toISOString(),
};

describe("SlowQueriesPane", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    useLiveOps.setState({ byConn: new Map() });
    window.localStorage.clear();
  });

  it("renders sortable table", () => {
    useLiveOps.getState().ensureConn("c1", "local");
    useLiveOps.getState().setActiveSubTab("c1", "slow");
    useLiveOps.setState((s) => {
      const m = new Map(s.byConn);
      const slice = m.get("c1");
      if (!slice) return s;
      m.set("c1", {
        ...slice,
        slow: {
          ...slice.slow,
          data: { status: "ready", data: snap, fetchedAt: Date.now() },
        },
      });
      return { byConn: m };
    });
    render(<SlowQueriesPane connId="c1" />);
    expect(screen.getAllByTestId("slow-query-row").length).toBe(1);
  });

  it("clicking a column header changes sortBy", () => {
    useLiveOps.getState().ensureConn("c1", "local");
    useLiveOps.getState().setActiveSubTab("c1", "slow");
    useLiveOps.setState((s) => {
      const m = new Map(s.byConn);
      const slice = m.get("c1");
      if (!slice) return s;
      m.set("c1", {
        ...slice,
        slow: {
          ...slice.slow,
          data: { status: "ready", data: snap, fetchedAt: Date.now() },
        },
      });
      return { byConn: m };
    });
    render(<SlowQueriesPane connId="c1" />);
    fireEvent.click(screen.getByTestId("slow-sort-calls"));
    expect(useLiveOps.getState().byConn.get("c1")?.slow.sortBy).toBe("calls");
  });

  it("clicking a row calls openEditorTab with prefillSql", () => {
    useLiveOps.getState().ensureConn("c1", "local");
    useLiveOps.getState().setActiveSubTab("c1", "slow");
    useLiveOps.setState((s) => {
      const m = new Map(s.byConn);
      const slice = m.get("c1");
      if (!slice) return s;
      m.set("c1", {
        ...slice,
        slow: {
          ...slice.slow,
          data: { status: "ready", data: snap, fetchedAt: Date.now() },
        },
      });
      return { byConn: m };
    });
    const spy = vi.spyOn(useEditor.getState(), "openEditorTab").mockReturnValue({} as never);
    render(<SlowQueriesPane connId="c1" />);
    fireEvent.click(screen.getByTestId("slow-query-row"));
    expect(spy).toHaveBeenCalledWith("c1", { prefillSql: "SELECT 1" });
  });
});
