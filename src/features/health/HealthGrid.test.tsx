import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HealthGrid } from "./HealthGrid";

describe("HealthGrid", () => {
  it("renders the auto-fit grid container with children", () => {
    render(
      <HealthGrid>
        <div data-testid="grid-child">a</div>
      </HealthGrid>,
    );
    const grid = screen.getByTestId("health-grid");
    expect(grid).toBeTruthy();
    expect(screen.getByTestId("grid-child")).toBeTruthy();
    // CSS Grid: minmax(280px, 1fr)
    const inline = grid.getAttribute("style") ?? "";
    expect(inline.includes("grid")).toBe(true);
    expect(inline.includes("280px")).toBe(true);
  });
});
