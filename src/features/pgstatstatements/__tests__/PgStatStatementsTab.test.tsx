// — owner: .
//
// Smoke tests for the pg_stat_statements tab body. We mock `queryExecute`
// (lib/tauri) so the component drives its happy/error paths without
// touching real IPC, and we override `URL.createObjectURL` /
// `URL.revokeObjectURL` for the CSV download flow.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queryExecuteMock = vi.fn();

vi.mock("../../../lib/tauri", () => ({
  queryExecute: (connId: string, sql: string) => queryExecuteMock(connId, sql),
}));

import { PgStatStatementsTab } from "../PgStatStatementsTab";

const tabModel = {
  id: "pgss-conn-1",
  kind: "pg-stat-statements" as const,
  connectionId: "conn-1",
  createdAt: "2026-05-04T00:00:00.000Z",
};

const successResult = {
  columns: [
    { name: "query", typeName: "text", isNumeric: false },
    { name: "calls", typeName: "int8", isNumeric: true },
    { name: "total_exec_time", typeName: "float8", isNumeric: true },
    { name: "mean_exec_time", typeName: "float8", isNumeric: true },
    { name: "rows", typeName: "int8", isNumeric: true },
    { name: "shared_blks_hit", typeName: "int8", isNumeric: true },
  ],
  rows: [
    ["SELECT 1", "10", "12.5", "1.25", "10", "100"],
    ["SELECT 2", "5", "6.7", "1.34", "5", "50"],
    ["SELECT 3", "1", "0.5", "0.5", "1", "5"],
  ],
  truncated: false,
  durationMs: 1,
  affectedRows: null,
  statusMessage: "",
};

const resetResult = {
  columns: [],
  rows: [],
  truncated: false,
  durationMs: 1,
  affectedRows: null,
  statusMessage: "",
};

beforeEach(() => {
  queryExecuteMock.mockReset();
});

afterEach(() => {
  queryExecuteMock.mockReset();
});

describe("PgStatStatementsTab", () => {
  it("renders header strip + 3 rows after the initial query resolves", async () => {
    queryExecuteMock.mockResolvedValueOnce(successResult);

    render(<PgStatStatementsTab tab={tabModel} />);

    expect(screen.getByTestId("pg-stat-statements-tab")).toBeInTheDocument();

    await waitFor(() => {
      expect(queryExecuteMock).toHaveBeenCalledTimes(1);
    });

    // Default initial query: total_exec_time DESC, LIMIT 50.
    const [, sql0] = queryExecuteMock.mock.calls[0];
    expect(sql0).toContain("ORDER BY total_exec_time DESC");
    expect(sql0).toContain("LIMIT 50");

    const table = await screen.findByRole("table");
    const bodyRows = within(table).getAllByRole("row");
    // 1 header + 3 data rows
    expect(bodyRows.length).toBe(4);
    // The query column renders inside a <details><summary>; both summary
    // and the inner <pre> contain the text, so use getAllByText.
    expect(within(table).getAllByText(/SELECT 1/).length).toBeGreaterThan(0);
    expect(within(table).getAllByText(/SELECT 3/).length).toBeGreaterThan(0);
  });

  it("re-runs the query when Refresh is clicked", async () => {
    queryExecuteMock.mockResolvedValue(successResult);

    render(<PgStatStatementsTab tab={tabModel} />);

    await waitFor(() => {
      expect(queryExecuteMock).toHaveBeenCalledTimes(1);
    });

    await userEvent.click(screen.getByTestId("pgss-refresh"));

    await waitFor(() => {
      expect(queryExecuteMock).toHaveBeenCalledTimes(2);
    });
  });

  it("re-fires the query with LIMIT 100 when Top-N changes", async () => {
    queryExecuteMock.mockResolvedValue(successResult);

    render(<PgStatStatementsTab tab={tabModel} />);

    await waitFor(() => {
      expect(queryExecuteMock).toHaveBeenCalledTimes(1);
    });

    fireEvent.change(screen.getByTestId("pgss-top-n"), { target: { value: "100" } });

    await waitFor(() => {
      expect(queryExecuteMock).toHaveBeenCalledTimes(2);
    });
    const [, sql1] = queryExecuteMock.mock.calls[1];
    expect(sql1).toContain("LIMIT 100");
  });

  it("changing Sort by re-fires the query with the new ORDER BY", async () => {
    queryExecuteMock.mockResolvedValue(successResult);

    render(<PgStatStatementsTab tab={tabModel} />);

    await waitFor(() => {
      expect(queryExecuteMock).toHaveBeenCalledTimes(1);
    });

    fireEvent.change(screen.getByTestId("pgss-sort-by"), { target: { value: "calls" } });

    await waitFor(() => {
      expect(queryExecuteMock).toHaveBeenCalledTimes(2);
    });
    const [, sql1] = queryExecuteMock.mock.calls[1];
    expect(sql1).toContain("ORDER BY calls DESC");
  });

  it("Reset opens a confirm dialog and runs reset SQL + refresh on confirm", async () => {
    queryExecuteMock
      .mockResolvedValueOnce(successResult) // initial mount
      .mockResolvedValueOnce(resetResult) // reset call
      .mockResolvedValueOnce(successResult); // refresh after reset

    render(<PgStatStatementsTab tab={tabModel} />);

    await waitFor(() => {
      expect(queryExecuteMock).toHaveBeenCalledTimes(1);
    });

    await userEvent.click(screen.getByTestId("pgss-reset"));

    // Radix Dialog renders a confirm button with this testid.
    const confirm = await screen.findByTestId("pgss-reset-confirm");
    expect(confirm).toBeInTheDocument();

    await userEvent.click(confirm);

    await waitFor(() => {
      expect(queryExecuteMock).toHaveBeenCalledTimes(3);
    });

    const [, resetSql] = queryExecuteMock.mock.calls[1];
    expect(resetSql).toContain("pg_stat_statements_reset");
    const [, refreshSql] = queryExecuteMock.mock.calls[2];
    expect(refreshSql).toContain("FROM pg_stat_statements");
  });

  it("Export CSV triggers a Blob download via URL.createObjectURL + a.click", async () => {
    queryExecuteMock.mockResolvedValueOnce(successResult);

    const createObjectURL = vi.fn().mockReturnValue("blob:fake");
    const revokeObjectURL = vi.fn();
    const clickSpy = vi.fn();

    const realCreate = URL.createObjectURL;
    const realRevoke = URL.revokeObjectURL;
    URL.createObjectURL = createObjectURL as typeof URL.createObjectURL;
    URL.revokeObjectURL = revokeObjectURL as typeof URL.revokeObjectURL;

    const realCreateElement = document.createElement.bind(document);
    const createElementSpy = vi.spyOn(document, "createElement").mockImplementation(((      tag: string,
) => {
      const el = realCreateElement(tag);
      if (tag === "a") {
        Object.defineProperty(el, "click", { value: clickSpy, writable: true });
      }
      return el;
    }) as typeof document.createElement);

    try {
      render(<PgStatStatementsTab tab={tabModel} />);

      await waitFor(() => {
        expect(queryExecuteMock).toHaveBeenCalledTimes(1);
      });

      await userEvent.click(screen.getByTestId("pgss-export-csv"));

      expect(createObjectURL).toHaveBeenCalledTimes(1);
      const blob = createObjectURL.mock.calls[0][0];
      expect(blob).toBeInstanceOf(Blob);
      expect((blob as Blob).type).toContain("text/csv");
      expect(clickSpy).toHaveBeenCalledTimes(1);
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:fake");
    } finally {
      URL.createObjectURL = realCreate;
      URL.revokeObjectURL = realRevoke;
      createElementSpy.mockRestore();
    }
  });

  it("renders an inline error message when the query rejects", async () => {
    queryExecuteMock.mockRejectedValueOnce(new Error("permission denied"));

    render(<PgStatStatementsTab tab={tabModel} />);

    const err = await screen.findByTestId("pgss-error");
    expect(err).toHaveTextContent("permission denied");
  });
});
