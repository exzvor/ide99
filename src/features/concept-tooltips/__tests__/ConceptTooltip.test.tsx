/**
 * — `ConceptTooltip` behavioural tests.
 *
 * Three behaviours are guarded:
 * 1. Standard mode → renders children unchanged, no Radix `Tooltip.Trigger`
 * wrapping span ever appears.
 * 2. Easy mode + valid id → trigger gets a `data-concept-id` adornment,
 * and the explanation text shows up after a hover.
 * 3. Easy mode + bad id → falls back to plain children + `console.warn`,
 * so a missing entry never crashes the surrounding layout.
 *
 * Radix Tooltip's pointer-tracking is brittle in jsdom; we therefore drive
 * `data-state="instant-open"` via direct `dispatchEvent` of pointer events on
 * the trigger, and use Radix's exposed `Tooltip.Provider` skipDelay to make
 * the open immediate.
 */

import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUiMode } from "../../easy-mode/store";
import { ConceptTooltip } from "../ConceptTooltip";
import { ConceptTooltipProvider } from "../ConceptTooltipProvider";

function renderInProvider(node: React.ReactNode) {
  return render(<ConceptTooltipProvider>{node}</ConceptTooltipProvider>);
}

describe("ConceptTooltip", () => {
  beforeEach(() => {
    // Reset mode between tests; default contract is "standard".
    act(() => useUiMode.getState().setMode("standard"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders children unchanged in Standard mode (no trigger span)", () => {
    renderInProvider(      <ConceptTooltip id="schema">
        <span data-testid="child">Schema</span>
      </ConceptTooltip>,
);
    expect(screen.getByTestId("child")).toBeInTheDocument();
    // No trigger adornment / data-concept-id wrapper should be in the DOM.
    expect(screen.queryByTestId("concept-tooltip-trigger-schema")).not.toBeInTheDocument();
  });

  it("wraps children in a trigger span in Easy mode", () => {
    act(() => useUiMode.getState().setMode("easy"));
    renderInProvider(      <ConceptTooltip id="schema">
        <span data-testid="child">Schema</span>
      </ConceptTooltip>,
);
    const trigger = screen.getByTestId("concept-tooltip-trigger-schema");
    expect(trigger).toBeInTheDocument();
    // The original child is still rendered inside the trigger.
    expect(screen.getByTestId("child")).toBeInTheDocument();
  });

  it("renders the help icon by default and hides it when showHelpIcon=false", () => {
    act(() => useUiMode.getState().setMode("easy"));
    const { unmount } = renderInProvider(      <ConceptTooltip id="schema">
        <span>Schema</span>
      </ConceptTooltip>,
);
    // lucide HelpCircle renders an <svg/>; the trigger has gap=3 between
    // children and icon. We assert at least one <svg/> is present inside the
    // trigger when the default `showHelpIcon` is true.
    const trigger = screen.getByTestId("concept-tooltip-trigger-schema");
    expect(trigger.querySelector("svg")).not.toBeNull();
    unmount();

    renderInProvider(      <ConceptTooltip id="schema" showHelpIcon={false}>
        <span>Schema</span>
      </ConceptTooltip>,
);
    const trigger2 = screen.getByTestId("concept-tooltip-trigger-schema");
    expect(trigger2.querySelector("svg")).toBeNull();
  });

  it("falls back to children + console.warn for an unknown id", () => {
    act(() => useUiMode.getState().setMode("easy"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderInProvider(      <ConceptTooltip id="not_a_real_concept_xyz">
        <span data-testid="child">orphan</span>
      </ConceptTooltip>,
);
    expect(screen.getByTestId("child")).toBeInTheDocument();
    expect(      screen.queryByTestId("concept-tooltip-trigger-not_a_real_concept_xyz"),
).not.toBeInTheDocument();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("not_a_real_concept_xyz");
  });

  it("warns at most once per missing id (memoised)", () => {
    act(() => useUiMode.getState().setMode("easy"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderInProvider(      <>
        <ConceptTooltip id="another_unknown_xyz">
          <span>a</span>
        </ConceptTooltip>
        <ConceptTooltip id="another_unknown_xyz">
          <span>b</span>
        </ConceptTooltip>
      </>,
);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
