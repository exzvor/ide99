import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { RecentPlansTab } from "./RecentPlansTab";
import { useRecentPlans } from "./store";

vi.mock("../../lib/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../lib/tauri")>("../../lib/tauri");
  return {
    ...actual,
    recentPlansSearch: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
  };
});

vi.mock("../editor/explain/Pev2Bridge", () => ({
  Pev2Bridge: () => <div data-testid="pev2-host" />,
}));

vi.mock("../../hooks/useTheme", () => ({
  useTheme: () => ({ theme: "light", resolved: "light", setTheme: () => {} }),
}));

beforeAll(async () => {
  await i18n.changeLanguage("en");
});
beforeEach(() => useRecentPlans.getState().reset());
afterEach(() => vi.clearAllMocks());

describe("RecentPlansTab", () => {
  it("renders filters + list + preview placeholder; refreshes on mount", async () => {
    render(<RecentPlansTab />);
    expect(screen.getByTestId("recent-plans-filters")).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByTestId("recent-plans-list-empty")).toBeTruthy();
    });
    expect(screen.getByTestId("recent-plans-preview-placeholder")).toBeTruthy();
    const { recentPlansSearch } = await import("../../lib/tauri");
    expect(vi.mocked(recentPlansSearch)).toHaveBeenCalled();
  });
});
