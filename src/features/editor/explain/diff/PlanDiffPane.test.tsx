import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../../../i18n";
import type { RecentPlanRow } from "../../../../lib/tauri";
import { type PlanDiffTab, __testing, useEditor } from "../../store";
import { PlanDiffPane } from "./PlanDiffPane";

vi.mock("../Pev2Bridge", () => ({
  Pev2Bridge: ({ plan }: { plan: unknown }) => (    <div data-testid="pev2-host">{JSON.stringify(plan)}</div>
),
}));

vi.mock("../../../../hooks/useTheme", () => ({
  useTheme: () => ({ theme: "light", resolved: "light", setTheme: () => {} }),
}));

vi.mock("../../../../lib/tauri", async () => {
  const actual =
    await vi.importActual<typeof import("../../../../lib/tauri")>("../../../../lib/tauri");
  return {
    ...actual,
    tabsList: vi.fn().mockResolvedValue([]),
    tabsSave: vi.fn().mockResolvedValue(undefined),
    tabsDelete: vi.fn().mockResolvedValue(undefined),
    recentPlansGet: vi.fn(),
  };
});

const samplePlanA = JSON.stringify([
  {
    Plan: {
      "Node Type": "Sort",
      "Total Cost": 100,
      Plans: [
        {
          "Node Type": "Seq Scan",
          Schema: "public",
          "Relation Name": "users",
          Alias: "users",
          "Total Cost": 80,
        },
      ],
    },
  },
]);

const samplePlanB = JSON.stringify([
  {
    Plan: {
      "Node Type": "Sort",
      "Total Cost": 30,
      Plans: [
        {
          "Node Type": "Index Scan",
          Schema: "public",
          "Relation Name": "users",
          Alias: "users",
          "Total Cost": 20,
        },
      ],
    },
  },
]);

const fakeRow = (id: string, planJson: string): RecentPlanRow => ({
  id,
  connectionId: "c1",
  connectionName: "t",
  sql: `SELECT ${id}`,
  planJson,
  executedAt: "2026-04-28T19:00:00Z",
  durationMs: 12,
  totalCost: 100,
  mode: "analyze",
  optionsJson: "{}",
  involvedTables: [],
  pinned: false,
});

beforeAll(async () => {
  await i18n.changeLanguage("en");
});
beforeEach(() => __testing.reset());
afterEach(() => vi.clearAllMocks());

function seedTab(): PlanDiffTab {
  const tab: PlanDiffTab = {
    id: "plan-diff-r:rA-r:rB",
    kind: "plan-diff",
    left: { kind: "recent", recentPlanId: "rA" },
    right: { kind: "recent", recentPlanId: "rB" },
    createdAt: "",
  };
  useEditor.setState({ tabs: [tab], activeTabId: tab.id });
  return tab;
}

describe("PlanDiffPane", () => {
  it("layout has toolbar / summary / two plan canvases / panel", async () => {
    const tab = seedTab();
    const { recentPlansGet } = await import("../../../../lib/tauri");
    vi.mocked(recentPlansGet).mockImplementation(async (id: string) =>
      id === "rA" ? fakeRow("rA", samplePlanA) : fakeRow("rB", samplePlanB),
);

    render(<PlanDiffPane tabId={tab.id} />);
    // — pev2 was replaced with QuietPlanCanvas on both sides.
    await waitFor(() => {
      expect(screen.getAllByTestId("quiet-plan-canvas")).toHaveLength(2);
    });
    expect(screen.getByTestId("plan-diff-toolbar")).toBeTruthy();
    expect(screen.getByTestId("plan-diff-summary")).toBeTruthy();
    expect(screen.getByTestId("plan-diff-panel")).toBeTruthy();
  });

  it("renders left_gone placeholder when left side recentPlansGet returns null", async () => {
    const tab = seedTab();
    const { recentPlansGet } = await import("../../../../lib/tauri");
    vi.mocked(recentPlansGet).mockImplementation(async (id: string) =>
      id === "rA" ? null : fakeRow("rB", samplePlanB),
);

    render(<PlanDiffPane tabId={tab.id} />);
    await waitFor(() => {
      expect(screen.getByTestId("plan-diff-left-gone")).toBeTruthy();
    });
    // right side renders normally (loaded) — QuietPlanCanvas now hosts the plan
    expect(screen.getAllByTestId("quiet-plan-canvas")).toHaveLength(1);
  });

  it("both sides parse-error → renders combined parse_error placeholder", async () => {
    const tab = seedTab();
    const { recentPlansGet } = await import("../../../../lib/tauri");
    vi.mocked(recentPlansGet).mockImplementation(async (id: string) => fakeRow(id, "{not json"));

    render(<PlanDiffPane tabId={tab.id} />);
    await waitFor(() => {
      expect(screen.getByTestId("plan-diff-placeholder-both")).toBeTruthy();
    });
  });

  it("missing tab renders the safe placeholder, not a crash", () => {
    render(<PlanDiffPane tabId="nonexistent" />);
    expect(screen.getByTestId("plan-diff-pane-missing")).toBeTruthy();
  });
});
