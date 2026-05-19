import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../../i18n";
import { __testing, useEditor } from "../store";
import { InsightsPanel } from "./InsightsPanel";

vi.mock("../../../lib/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/tauri")>("../../../lib/tauri");
  return {
    ...actual,
    tabsList: vi.fn().mockResolvedValue([]),
    tabsSave: vi.fn().mockResolvedValue(undefined),
    tabsDelete: vi.fn().mockResolvedValue(undefined),
    recentPlansGet: vi.fn().mockResolvedValue(null),
  };
});

beforeAll(async () => {
  await i18n.changeLanguage("en");
});
beforeEach(() => __testing.reset());
afterEach(() => vi.clearAllMocks());

const PLAN_R1 = [
  {
    Plan: {
      "Node Type": "Seq Scan",
      "Relation Name": "users",
      Schema: "public",
      Filter: "status = 'active'",
      "Plan Rows": 2_000_000,
      "Actual Rows": 2_000_000,
    },
  },
];

const PLAN_EMPTY = [{ Plan: { "Node Type": "Result" } }];

describe("InsightsPanel", () => {
  it("renders the all-clear empty state when there are zero insights ", () => {
    render(<InsightsPanel tabId="explain-x" plan={PLAN_EMPTY} onHighlight={() => {}} />);
    // — InsightsPanel no longer returns null on empty: the
    // tabbed right rail in ExplainPane needs a visible placeholder so
    // the user knows the rail is alive (and not a rendering bug).
    expect(screen.getByTestId("insights-panel")).toBeTruthy();
    expect(screen.getByTestId("insights-empty")).toBeTruthy();
  });

  it("renders one card per insight with severity bar colour", () => {
    render(<InsightsPanel tabId="explain-x" plan={PLAN_R1} onHighlight={() => {}} />);
    const panel = screen.getByTestId("insights-panel");
    expect(panel).toBeTruthy();

    // R1 fires once for this fixture — find the card
    const card = panel.querySelector("[data-severity='high']");
    expect(card).toBeTruthy();
    // Inline-style check: borderLeft ~ red colour reference; we set
    // var(--color-danger). React serialises that as a CSS value.
    const style = (card as HTMLElement).getAttribute("style") ?? "";
    expect(style).toContain("border-left");
  });

  it("clicking the card body fires onHighlight with the node label", () => {
    const onHighlight = vi.fn();
    render(<InsightsPanel tabId="explain-x" plan={PLAN_R1} onHighlight={onHighlight} />);
    const card = screen.getByTestId("insights-panel").querySelector("[data-severity='high']");
    expect(card).toBeTruthy();
    // The first <button> inside the card is the body button.
    const bodyBtn = (card as HTMLElement).querySelector("button");
    fireEvent.click(bodyBtn as HTMLElement);
    expect(onHighlight).toHaveBeenCalledTimes(1);
    expect(onHighlight.mock.calls[0][0]).toContain("Seq Scan");
  });

  it("Open in editor click invokes openEditorFromInsight", () => {
    const spy = vi
      .spyOn(useEditor.getState(), "openEditorFromInsight")
      .mockResolvedValue(undefined);
    render(<InsightsPanel tabId="explain-x" plan={PLAN_R1} onHighlight={() => {}} />);
    fireEvent.click(screen.getByTestId("insight-open-in-editor-R1_seq_scan_large"));
    expect(spy).toHaveBeenCalledTimes(1);
    const [tabId, insight] = spy.mock.calls[0];
    expect(tabId).toBe("explain-x");
    expect(insight.ruleId).toBe("R1_seq_scan_large");
  });

  it("Copy click writes to clipboard", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<InsightsPanel tabId="explain-x" plan={PLAN_R1} onHighlight={() => {}} />);
    fireEvent.click(screen.getByTestId("insight-copy-R1_seq_scan_large"));
    expect(writeText).toHaveBeenCalledTimes(1);
    const arg = writeText.mock.calls[0][0] as string;
    expect(arg).toMatch(/CREATE INDEX/);
  });
});
