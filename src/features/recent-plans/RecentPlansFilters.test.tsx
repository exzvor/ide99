import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { RecentPlansFilters } from "./RecentPlansFilters";
import { useRecentPlans } from "./store";

vi.mock("../../lib/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../lib/tauri")>("../../lib/tauri");
  return {
    ...actual,
    recentPlansSearch: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
  };
});

beforeAll(async () => {
  await i18n.changeLanguage("en");
});
beforeEach(() => useRecentPlans.getState().reset());
afterEach(() => vi.clearAllMocks());

describe("RecentPlansFilters", () => {
  it("typing in search updates store filter (debounced)", async () => {
    vi.useFakeTimers();
    render(<RecentPlansFilters />);
    const input = screen.getByPlaceholderText(/search sql/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "users" } });
    // Debounce 300ms — refresh has not fired yet.
    const { recentPlansSearch } = await import("../../lib/tauri");
    expect(vi.mocked(recentPlansSearch)).not.toHaveBeenCalled();
    vi.advanceTimersByTime(310);
    await Promise.resolve();
    expect(useRecentPlans.getState().filter.query).toBe("users");
    expect(vi.mocked(recentPlansSearch)).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("Reset clears filter and refreshes", async () => {
    useRecentPlans.setState({ filter: { query: "x", limit: 50, offset: 0 } });
    render(<RecentPlansFilters />);
    fireEvent.click(screen.getByRole("button", { name: /reset/i }));
    expect(useRecentPlans.getState().filter.query).toBeUndefined();
    const { recentPlansSearch } = await import("../../lib/tauri");
    expect(vi.mocked(recentPlansSearch)).toHaveBeenCalled();
  });
});
