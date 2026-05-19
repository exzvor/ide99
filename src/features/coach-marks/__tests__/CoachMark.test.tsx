/**
 * v1.0 GA — CoachMark component tests.
 */

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { CoachMark } from "../CoachMark";
import { useCoachMarks } from "../store";

describe("CoachMark", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useCoachMarks.getState().reset();
  });

  it("renders title + body when not yet seen", () => {
    render(<CoachMark id="x" title="T" body="B" dismissLabel="Got it" />);
    expect(screen.getByText("T")).toBeInTheDocument();
    expect(screen.getByText("B")).toBeInTheDocument();
    expect(screen.getByTestId("coach-mark-x")).toBeInTheDocument();
  });

  it("returns null when already seen", () => {
    useCoachMarks.getState().markSeen("x");
    const { container } = render(<CoachMark id="x" title="T" body="B" dismissLabel="Got it" />);
    expect(container.firstChild).toBeNull();
  });

  it("dismiss button marks seen and unmounts the hint", () => {
    render(<CoachMark id="x" title="T" body="B" dismissLabel="Got it" />);
    fireEvent.click(screen.getByTestId("coach-mark-x-dismiss"));
    expect(useCoachMarks.getState().isSeen("x")).toBe(true);
    expect(screen.queryByTestId("coach-mark-x")).not.toBeInTheDocument();
  });

  it("two marks with different ids render independently", () => {
    render(      <>
        <CoachMark id="a" title="A" body="aa" dismissLabel="Got it" />
        <CoachMark id="b" title="B" body="bb" dismissLabel="Got it" />
      </>,
);
    expect(screen.getByTestId("coach-mark-a")).toBeInTheDocument();
    expect(screen.getByTestId("coach-mark-b")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("coach-mark-a-dismiss"));
    expect(screen.queryByTestId("coach-mark-a")).not.toBeInTheDocument();
    expect(screen.getByTestId("coach-mark-b")).toBeInTheDocument();
  });
});
