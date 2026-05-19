// — : smoke tests for the per-table PostGIS panel.
//
// We mock `queryExecute` (lib/tauri) and `useEditor` (editor/store) so the
// panel can run its happy/error paths without touching real IPC or zustand.

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const queryExecuteMock = vi.fn();
const openMapViewTab = vi.fn();

vi.mock("../../../lib/tauri", () => ({
  queryExecute: (connId: string, sql: string) => queryExecuteMock(connId, sql),
}));

vi.mock("../../editor/store", () => ({
  useEditor: { getState: () => ({ openMapViewTab }) },
}));

import { PostgisTablePanel } from "../PostgisTablePanel";

const baseProps = {
  connId: "conn-1",
  qualifiedTable: "public.items",
  pk: "id" as string | null,
  geometryColumns: [{ name: "geom", type: "geometry" as const, srid: 4326 }],
  rowCount: 100,
};

const successResult = {
  columns: [
    { name: "id", typeName: "int4", isNumeric: true },
    { name: "geom", typeName: "geometry(Point,4326)", isNumeric: false },
  ],
  rows: [["1", "hex"]],
  truncated: false,
  durationMs: 1,
  affectedRows: null,
  statusMessage: "",
};

afterEach(() => {
  queryExecuteMock.mockReset();
  openMapViewTab.mockReset();
});

describe("PostgisTablePanel", () => {
  it("returns null when there are no geometry columns", () => {
    const { container } = render(<PostgisTablePanel {...baseProps} geometryColumns={[]} />);
    expect(screen.queryByTestId("postgis-table-panel")).not.toBeInTheDocument();
    expect(container.firstChild).toBeNull();
  });

  it("opens the Map View tab on successful query execution", async () => {
    queryExecuteMock.mockResolvedValueOnce(successResult);

    render(<PostgisTablePanel {...baseProps} />);

    const button = screen.getByTestId("postgis-panel-open-map-view");
    expect(button).not.toBeDisabled();

    await userEvent.click(button);

    await waitFor(() => {
      expect(queryExecuteMock).toHaveBeenCalledTimes(1);
    });

    const [calledConnId, calledSql] = queryExecuteMock.mock.calls[0];
    expect(calledConnId).toBe("conn-1");
    expect(calledSql).toContain("public.items");
    expect(calledSql).toContain("LIMIT 5000");

    await waitFor(() => {
      expect(openMapViewTab).toHaveBeenCalledTimes(1);
    });
    expect(openMapViewTab).toHaveBeenCalledWith({
      connectionId: "conn-1",
      rowsSnapshot: successResult.rows,
      columns: successResult.columns,
      geometryColumn: "geom",
    });
  });

  it("shows the error inline when the query fails", async () => {
    queryExecuteMock.mockRejectedValueOnce(new Error("connection lost"));

    render(<PostgisTablePanel {...baseProps} />);

    const button = screen.getByTestId("postgis-panel-open-map-view");
    await userEvent.click(button);

    const errorEl = await screen.findByTestId("postgis-panel-error");
    expect(errorEl).toHaveTextContent("connection lost");
    expect(openMapViewTab).not.toHaveBeenCalled();

    // Loading state must clear after the rejection settles.
    await waitFor(() => {
      expect(button).not.toBeDisabled();
    });
  });
});
