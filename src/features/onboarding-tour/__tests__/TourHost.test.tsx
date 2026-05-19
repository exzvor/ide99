/**
 * — TourHost behaviour.
 *
 * Covers:
 * - inert until triggered
 * - manual `startOnboardingTour()` event activates the tour
 * - Next button advances the step
 * - Skip button closes + persists `tourCompleted = true`
 * - Finish on the last step closes + persists
 * - ESC key skips the tour
 * - Auto-start when mode flips standard → easy and tour not yet completed
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "../../../i18n";
import { useUiMode } from "../../easy-mode/store";
import { TourHost, startOnboardingTour } from "../TourHost";
import { TOUR_STEPS } from "../steps";

function resetUiMode() {
  useUiMode.setState({ mode: "standard", tourCompleted: false });
}

describe("TourHost", () => {
  beforeEach(() => {
    resetUiMode();
  });

  afterEach(() => {
    resetUiMode();
  });

  it("renders nothing initially", () => {
    const { container } = render(<TourHost />);
    expect(container.firstChild).toBeNull();
  });

  it("activates on startOnboardingTour() and shows the first step", () => {
    render(<TourHost />);
    act(() => {
      startOnboardingTour();
    });
    const host = screen.getByTestId("tour-host");
    expect(host).toHaveAttribute("data-tour-step", TOUR_STEPS[0].id);
    expect(screen.getByTestId("tour-bubble-body")).toBeInTheDocument();
  });

  it("Next button advances to the second step", () => {
    render(<TourHost />);
    act(() => {
      startOnboardingTour();
    });
    fireEvent.click(screen.getByTestId("tour-bubble-next"));
    expect(screen.getByTestId("tour-host")).toHaveAttribute("data-tour-step", TOUR_STEPS[1].id);
  });

  it("Back button returns to the previous step", () => {
    render(<TourHost />);
    act(() => {
      startOnboardingTour();
    });
    fireEvent.click(screen.getByTestId("tour-bubble-next"));
    fireEvent.click(screen.getByTestId("tour-bubble-prev"));
    expect(screen.getByTestId("tour-host")).toHaveAttribute("data-tour-step", TOUR_STEPS[0].id);
  });

  it("Back is disabled on the first step", () => {
    render(<TourHost />);
    act(() => {
      startOnboardingTour();
    });
    expect(screen.getByTestId("tour-bubble-prev")).toBeDisabled();
  });

  it("Skip closes the tour and sets tourCompleted=true", () => {
    render(<TourHost />);
    act(() => {
      startOnboardingTour();
    });
    fireEvent.click(screen.getByTestId("tour-bubble-skip"));
    expect(screen.queryByTestId("tour-host")).toBeNull();
    expect(useUiMode.getState().tourCompleted).toBe(true);
  });

  it("Finish on the last step closes and sets tourCompleted=true", () => {
    render(<TourHost />);
    act(() => {
      startOnboardingTour();
    });
    // Click Next until the final step.
    for (let i = 0; i < TOUR_STEPS.length - 1; i++) {
      fireEvent.click(screen.getByTestId("tour-bubble-next"));
    }
    expect(screen.getByTestId("tour-host")).toHaveAttribute(      "data-tour-step",
      TOUR_STEPS[TOUR_STEPS.length - 1].id,
);
    fireEvent.click(screen.getByTestId("tour-bubble-finish"));
    expect(screen.queryByTestId("tour-host")).toBeNull();
    expect(useUiMode.getState().tourCompleted).toBe(true);
  });

  it("ESC key skips the tour", () => {
    render(<TourHost />);
    act(() => {
      startOnboardingTour();
    });
    expect(screen.getByTestId("tour-host")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("tour-host")).toBeNull();
    expect(useUiMode.getState().tourCompleted).toBe(true);
  });

  it("auto-starts when mode flips standard → easy and tourCompleted is false", async () => {
    render(<TourHost />);
    expect(screen.queryByTestId("tour-host")).toBeNull();

    act(() => {
      useUiMode.setState({ mode: "easy" });
    });

    // Auto-start has a 300ms layout-settle delay; advance time and let
    // React process the resulting state update.
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 350));
    });

    expect(screen.getByTestId("tour-host")).toBeInTheDocument();
    expect(screen.getByTestId("tour-host")).toHaveAttribute("data-tour-step", TOUR_STEPS[0].id);
  });

  it("does NOT auto-start when tourCompleted is already true", async () => {
    act(() => {
      useUiMode.setState({ mode: "standard", tourCompleted: true });
    });
    render(<TourHost />);

    act(() => {
      useUiMode.setState({ mode: "easy" });
    });

    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 350));
    });

    expect(screen.queryByTestId("tour-host")).toBeNull();
  });
});
