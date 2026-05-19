import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../../i18n";
import type { RecentPlanRow } from "../../../lib/tauri";
import { RecentPlansPickerModal } from "./RecentPlansPickerModal";

vi.mock("../../../lib/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/tauri")>("../../../lib/tauri");
  return {
    ...actual,
    recentPlansSearch: vi.fn(),
  };
});

const fakeRow = (id: string, over: Partial<RecentPlanRow> = {}): RecentPlanRow => ({
  id,
  connectionId: "c1",
  connectionName: "t",
  sql: `SELECT ${id}`,
  planJson: "[{}]",
  executedAt: "2026-04-28T19:00:00Z",
  durationMs: 1,
  totalCost: null,
  mode: "explain",
  optionsJson: "{}",
  involvedTables: [],
  pinned: false,
  ...over,
});

beforeAll(async () => {
  await i18n.changeLanguage("en");
});
beforeEach(() => {});
afterEach(() => vi.clearAllMocks());

describe("RecentPlansPickerModal", () => {
  it("does not render when open=false", () => {
    const { container } = render(
      <RecentPlansPickerModal
        open={false}
        defaultConnectionId={null}
        onPick={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("mounts list of rows on open and renders an empty state when none", async () => {
    const { recentPlansSearch } = await import("../../../lib/tauri");
    vi.mocked(recentPlansSearch).mockResolvedValueOnce({ rows: [], total: 0 });
    render(
      <RecentPlansPickerModal
        open={true}
        defaultConnectionId="c1"
        onPick={() => {}}
        onCancel={() => {}}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("picker-empty")).toBeTruthy();
    });
  });

  it("renders rows and pick triggers onPick with recent side", async () => {
    const { recentPlansSearch } = await import("../../../lib/tauri");
    vi.mocked(recentPlansSearch).mockResolvedValueOnce({
      rows: [fakeRow("p1"), fakeRow("p2")],
      total: 2,
    });
    const onPick = vi.fn();
    render(
      <RecentPlansPickerModal
        open={true}
        defaultConnectionId="c1"
        onPick={onPick}
        onCancel={() => {}}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("picker-row-p1")).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId("picker-row-p1"));
    expect(onPick).toHaveBeenCalledWith({ kind: "recent", recentPlanId: "p1" });
  });

  it("scope toggle filters by connectionId / undefined", async () => {
    const { recentPlansSearch } = await import("../../../lib/tauri");
    const mock = vi.mocked(recentPlansSearch);
    mock.mockResolvedValue({ rows: [], total: 0 });
    render(
      <RecentPlansPickerModal
        open={true}
        defaultConnectionId="c1"
        onPick={() => {}}
        onCancel={() => {}}
      />,
    );
    // Initially scope=current → connectionId=c1
    await waitFor(() => {
      expect(mock).toHaveBeenCalled();
    });
    const firstFilter = mock.mock.calls[0][0];
    expect(firstFilter.connectionId).toBe("c1");

    // Click scope-all → connectionId=undefined
    mock.mockClear();
    mock.mockResolvedValue({ rows: [], total: 0 });
    fireEvent.click(screen.getByTestId("picker-scope-all"));
    await waitFor(() => {
      expect(mock).toHaveBeenCalled();
    });
    const allFilter = mock.mock.calls[mock.mock.calls.length - 1][0];
    expect(allFilter.connectionId).toBeUndefined();
  });

  it("Cancel click invokes onCancel", async () => {
    const { recentPlansSearch } = await import("../../../lib/tauri");
    vi.mocked(recentPlansSearch).mockResolvedValue({ rows: [], total: 0 });
    const onCancel = vi.fn();
    render(
      <RecentPlansPickerModal
        open={true}
        defaultConnectionId="c1"
        onPick={() => {}}
        onCancel={onCancel}
      />,
    );
    // The Cancel button is in the modal footer.
    const cancelBtns = screen.getAllByRole("button", { name: /cancel/i });
    fireEvent.click(cancelBtns[cancelBtns.length - 1]);
    expect(onCancel).toHaveBeenCalled();
  });
});
