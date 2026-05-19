import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import type { RecentPlanRow as RowDTO } from "../../lib/tauri";
import { RecentPlansRow } from "./RecentPlansRow";
import { useRecentPlans } from "./store";

vi.mock("../../lib/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../lib/tauri")>("../../lib/tauri");
  return {
    ...actual,
    recentPlansSearch: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
    recentPlansSetPinned: vi.fn().mockResolvedValue(undefined),
    recentPlansDelete: vi.fn().mockResolvedValue(undefined),
  };
});

const sample: RowDTO = {
  id: "r1",
  connectionId: "c1",
  connectionName: "test",
  sql: "SELECT * FROM users WHERE id < 100",
  planJson: "[{}]",
  executedAt: "2026-04-28T19:00:00Z",
  durationMs: 12,
  totalCost: 16.11,
  mode: "analyze",
  optionsJson: "{}",
  involvedTables: ["public.users"],
  pinned: false,
};

beforeAll(async () => {
  await i18n.changeLanguage("en");
});
beforeEach(() => useRecentPlans.getState().reset());
afterEach(() => vi.clearAllMocks());

describe("RecentPlansRow", () => {
  it("renders truncated sql + meta + tables", () => {
    render(<RecentPlansRow row={sample} />);
    expect(screen.getByText(/SELECT/)).toBeTruthy();
    expect(screen.getByText(/test/)).toBeTruthy();
    expect(screen.getByText(/12ms/)).toBeTruthy();
    expect(screen.getByText(/public\.users/)).toBeTruthy();
  });

  it("Open click calls store.selectRow", () => {
    render(<RecentPlansRow row={sample} />);
    fireEvent.click(screen.getByRole("button", { name: /open/i }));
    expect(useRecentPlans.getState().selectedId).toBe("r1");
  });

  it("Pin toggle flips state via store.togglePinned", async () => {
    useRecentPlans.setState({ rows: [sample], total: 1 });
    render(<RecentPlansRow row={sample} />);
    fireEvent.click(screen.getByRole("button", { name: /pin/i }));
    const { recentPlansSetPinned } = await import("../../lib/tauri");
    expect(vi.mocked(recentPlansSetPinned)).toHaveBeenCalledWith("r1", true);
  });

  describe("compare mode ", () => {
    it("renders checkbox, hides pin/Open when compareMode=true", () => {
      useRecentPlans.setState({ compareMode: true, rows: [sample], total: 1 });
      render(<RecentPlansRow row={sample} />);
      expect(screen.getByTestId("recent-plans-row-checkbox-r1")).toBeTruthy();
      // Pin button should NOT be present.
      expect(screen.queryByRole("button", { name: /pin/i })).toBeNull();
      // Open button should NOT be present in compare mode.
      expect(screen.queryByRole("button", { name: /open/i })).toBeNull();
    });

    it("checkbox click toggles compareSelected", () => {
      useRecentPlans.setState({ compareMode: true, rows: [sample], total: 1 });
      render(<RecentPlansRow row={sample} />);
      fireEvent.click(screen.getByTestId("recent-plans-row-checkbox-r1"));
      expect(useRecentPlans.getState().compareSelected).toContain("r1");
    });
  });
});
