// — owner: .
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const RepackDialogMock = vi.fn();

vi.mock("../RepackDialog", () => ({
  RepackDialog: (props: { open: boolean; onClose: () => void }) => {
    RepackDialogMock(props);
    if (!props.open) return null;
    return (
      <div data-testid="repack-dialog-mock">
        <button type="button" data-testid="repack-dialog-mock-close" onClick={props.onClose}>
          close
        </button>
      </div>
    );
  },
}));

import { PgRepackTablePanel } from "../PgRepackTablePanel";

beforeEach(() => {
  RepackDialogMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("PgRepackTablePanel", () => {
  test("renders the section title and a single 'Repack table…' button", () => {
    render(<PgRepackTablePanel connId="conn-1" database="mydb" schema="public" table="metrics" />);
    expect(screen.getByText(/pg_repack/i)).toBeInTheDocument();
    expect(screen.getByTestId("pg-repack-panel-repack")).toBeInTheDocument();
  });

  test("clicking the button opens the RepackDialog with open={true}", () => {
    render(<PgRepackTablePanel connId="conn-1" database="mydb" schema="public" table="metrics" />);

    // First render: dialog mock invoked with open=false.
    const lastCallBefore = RepackDialogMock.mock.calls.at(-1)?.[0] as { open: boolean } | undefined;
    expect(lastCallBefore?.open).toBe(false);

    fireEvent.click(screen.getByTestId("pg-repack-panel-repack"));

    const lastCallAfter = RepackDialogMock.mock.calls.at(-1)?.[0] as { open: boolean } | undefined;
    expect(lastCallAfter?.open).toBe(true);
    expect(screen.getByTestId("repack-dialog-mock")).toBeInTheDocument();
  });

  test("dialog onClose closes the panel", () => {
    render(<PgRepackTablePanel connId="conn-1" database="mydb" schema="public" table="metrics" />);

    fireEvent.click(screen.getByTestId("pg-repack-panel-repack"));
    expect(screen.getByTestId("repack-dialog-mock")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("repack-dialog-mock-close"));
    expect(screen.queryByTestId("repack-dialog-mock")).not.toBeInTheDocument();
  });
});
