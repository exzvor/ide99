import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../../i18n";
import { __testing, useEditor } from "../store";
import { ExplainPane, countNodes } from "./ExplainPane";

// — ExplainPane no longer mounts Pev2Bridge directly (the
// pev2 escape hatch was replaced by PlanInspector). We keep the module
// mock for any transitive imports so jsdom doesn't try to boot the real
// Vue island.
vi.mock("./Pev2Bridge", () => ({
  Pev2Bridge: ({ plan }: { plan: unknown }) => (    <div data-testid="pev2-host">{JSON.stringify(plan)}</div>
),
}));

vi.mock("../../../lib/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/tauri")>("../../../lib/tauri");
  return {
    ...actual,
    tabsList: vi.fn().mockResolvedValue([]),
    tabsSave: vi.fn().mockResolvedValue(undefined),
    tabsDelete: vi.fn().mockResolvedValue(undefined),
    queryExplain: vi.fn(),
    queryExplainCancel: vi.fn(),
  };
});

beforeEach(() => __testing.reset());
afterEach(() => vi.clearAllMocks());

function seedTab() {
  useEditor.setState({
    tabs: [
      {
        id: "explain-x",
        kind: "explain" as const,
        sourceTabId: "x",
        options: { mode: "explain", verbose: false, wal: false, timing: false },
        createdAt: "",
      },
    ],
  });
}

describe("ExplainPane", () => {
  it("idle state renders ExplainEmpty", () => {
    seedTab();
    render(<ExplainPane tabId="explain-x" />);
    expect(screen.getByTestId("explain-empty")).toBeTruthy();
    expect(screen.queryByTestId("pev2-host")).toBeNull();
    expect(screen.queryByTestId("explain-footer")).toBeNull();
  });

  it("ready state renders the plan canvas + footer with duration + node count", () => {
    seedTab();
    useEditor.setState({
      explainRunStates: new Map([
        [
          "explain-x",
          {
            status: "ready" as const,
            plan: [
              {
                Plan: {
                  "Node Type": "Hash Join",
                  Plans: [
                    { "Node Type": "Seq Scan", Plans: [] },
                    { "Node Type": "Hash", Plans: [{ "Node Type": "Seq Scan", Plans: [] }] },
                  ],
                },
              },
            ],
            durationMs: 12,
            statusMessage: "",
            ranAt: Date.now(),
            executedSql: "SELECT 1",
          },
        ],
      ]),
    });

    render(<ExplainPane tabId="explain-x" />);
    // — QuietPlanCanvas is the inline visualization; the Plan
    // Inspector (table / raw / query) sits behind the "⤢ Inspector"
    // button. pev2 was dropped from the EXPLAIN view entirely — its data
    // is now surfaced by NodesTable + RawJsonView + QueryView in our own
    // styling.
    expect(screen.getByTestId("quiet-plan-canvas")).toBeTruthy();
    expect(screen.getByTestId("explain-open-inspector")).toBeTruthy();
    const footerText = screen.getByTestId("explain-footer").textContent ?? "";
    // Duration appears in the i18n template ("Duration · 12ms · 4 nodes").
    expect(footerText).toContain("12");
    // 4 nodes total: root + 3 descendants.
    expect(footerText).toContain("4");
  });

  it("error state renders ExplainErrorView", () => {
    seedTab();
    useEditor.setState({
      explainRunStates: new Map([
        [
          "explain-x",
          {
            status: "error" as const,
            code: "postgres_error",
            detail: "syntax error",
          },
        ],
      ]),
    });
    render(<ExplainPane tabId="explain-x" />);
    expect(screen.getByTestId("explain-error")).toBeTruthy();
    expect(screen.queryByTestId("pev2-host")).toBeNull();
  });

  it("missing tab renders the safe placeholder, not a crash", () => {
    render(<ExplainPane tabId="nonexistent" />);
    expect(screen.getByTestId("explain-pane-missing")).toBeTruthy();
  });
});

describe("countNodes", () => {
  it("returns 0 for empty / malformed plans", () => {
    expect(countNodes(null)).toBe(0);
    expect(countNodes([])).toBe(0);
    expect(countNodes([{}])).toBe(0);
    expect(countNodes("not a plan")).toBe(0);
  });

  it("counts a single-node plan", () => {
    expect(countNodes([{ Plan: { "Node Type": "Seq Scan" } }])).toBe(1);
  });

  it("walks Plans children recursively", () => {
    const plan = [
      {
        Plan: {
          "Node Type": "Sort",
          Plans: [
            {
              "Node Type": "Hash Join",
              Plans: [
                { "Node Type": "Seq Scan" },
                { "Node Type": "Hash", Plans: [{ "Node Type": "Seq Scan" }] },
              ],
            },
          ],
        },
      },
    ];
    expect(countNodes(plan)).toBe(5);
  });
});
