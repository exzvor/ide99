// — owner: .
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const runPreflightCheckMock = vi.fn();
const queryExecuteMock = vi.fn();

vi.mock("../preflightCheck", () => ({
  runPreflightCheck: (...args: unknown[]) => runPreflightCheckMock(...args),
}));

vi.mock("../../../lib/tauri", () => ({
  queryExecute: (...args: unknown[]) => queryExecuteMock(...args),
}));

import { RepackDialog } from "../RepackDialog";

function emptyJobsResult(): { rows: string[][] } {
  return { rows: [] };
}

beforeEach(() => {
  runPreflightCheckMock.mockReset();
  queryExecuteMock.mockReset();
  queryExecuteMock.mockResolvedValue(emptyJobsResult());
  // jsdom does not implement window.alert; replace with a spy so the dialog's
  // alert() calls don't throw.
  vi.stubGlobal("alert", vi.fn());
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("RepackDialog", () => {
  test("renders 4 pre-flight bullets after queries resolve", async () => {
    runPreflightCheckMock.mockResolvedValueOnce({
      hasPk: true,
      tableSize: "12 MB",
      indexCount: 3,
      fkCount: 1,
    });

    render(
      <RepackDialog
        open={true}
        connId="conn-1"
        database="mydb"
        schema="public"
        table="metrics"
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByText(/Has primary key/i)).toBeInTheDocument());

    expect(screen.getByText(/Has primary key/i).textContent).toContain("✓");
    expect(screen.getByText(/Total size/i).textContent).toContain("12 MB");
    expect(screen.getByText(/Index count/i).textContent).toContain("3");
    expect(screen.getByText(/Foreign[- ]key count/i).textContent).toContain("1");

    // hasPk=true should not render the warning banner.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  test("renders the warning banner when the table has no primary key", async () => {
    runPreflightCheckMock.mockResolvedValueOnce({
      hasPk: false,
      tableSize: "4 MB",
      indexCount: 2,
      fkCount: 0,
    });

    render(
      <RepackDialog
        open={true}
        connId="conn-1"
        database="mydb"
        schema="public"
        table="no_pk"
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert").textContent).toMatch(/primary key/i);
    expect(screen.getByText(/Has primary key/i).textContent).toContain("✗");
  });

  test("Copy to clipboard button writes the generated command", async () => {
    runPreflightCheckMock.mockResolvedValueOnce({
      hasPk: true,
      tableSize: "12 MB",
      indexCount: 3,
      fkCount: 1,
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: { writeText },
    });

    render(
      <RepackDialog
        open={true}
        connId="conn-1"
        database="mydb"
        schema="public"
        table="metrics"
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByText(/Has primary key/i)).toBeInTheDocument());

    const copyBtn = screen.getByTestId("repack-copy");
    fireEvent.click(copyBtn);

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const arg = writeText.mock.calls[0]?.[0] as string;
    expect(arg).toContain("pg_repack");
    expect(arg).toContain("-d mydb");
    expect(arg).toContain("-t public.metrics");
  });

  test("polls the active-jobs query every 2 seconds while open and stops after close", async () => {
    runPreflightCheckMock.mockResolvedValue({
      hasPk: true,
      tableSize: "1 MB",
      indexCount: 1,
      fkCount: 0,
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });

    const { rerender } = render(
      <RepackDialog
        open={true}
        connId="conn-1"
        database="mydb"
        schema="public"
        table="metrics"
        onClose={vi.fn()}
      />,
    );

    // Mount fires an initial fetch.
    await waitFor(() => expect(queryExecuteMock).toHaveBeenCalledTimes(1));

    await act(async () => {
      vi.advanceTimersByTime(2_000);
    });
    expect(queryExecuteMock).toHaveBeenCalledTimes(2);

    rerender(
      <RepackDialog
        open={false}
        connId="conn-1"
        database="mydb"
        schema="public"
        table="metrics"
        onClose={vi.fn()}
      />,
    );

    const callsAfterClose = queryExecuteMock.mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(queryExecuteMock.mock.calls.length).toBe(callsAfterClose);
  });

  test("renders the no-history placeholder when the active-jobs query fails", async () => {
    runPreflightCheckMock.mockResolvedValueOnce({
      hasPk: true,
      tableSize: "1 MB",
      indexCount: 1,
      fkCount: 0,
    });
    queryExecuteMock.mockReset();
    queryExecuteMock.mockRejectedValue(new Error("permission denied"));

    render(
      <RepackDialog
        open={true}
        connId="conn-1"
        database="mydb"
        schema="public"
        table="metrics"
        onClose={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(screen.getByText(/No repack history available/i)).toBeInTheDocument(),
    );
  });
});
