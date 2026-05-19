import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Sparkline } from "./Sparkline";

describe("Sparkline", () => {
  it("returns null when data is empty", () => {
    const { container } = render(<Sparkline data={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders a single point centered at x=50", () => {
    const { container } = render(<Sparkline data={[42]} />);
    const polyline = container.querySelector("polyline");
    expect(polyline).not.toBeNull();
    // Single point: x = 50.0; y = h - ((42-42)/1)*h = h (24.0).
    expect(polyline?.getAttribute("points")).toBe("50.0,24.0");
  });

  it("renders multi-point shape with x spread across viewBox", () => {
    const { container } = render(<Sparkline data={[1, 2, 3, 4]} />);
    const polyline = container.querySelector("polyline");
    expect(polyline).not.toBeNull();
    const points = polyline?.getAttribute("points") ?? "";
    // 4 points → 4 "x,y" pairs separated by spaces.
    const pairs = points.split(" ");
    expect(pairs).toHaveLength(4);
    // First x = 0; last x = 100 (viewBox width).
    expect(pairs[0].startsWith("0.0,")).toBe(true);
    expect(pairs[3].startsWith("100.0,")).toBe(true);
  });

  it("propagates ariaLabel", () => {
    const { container } = render(<Sparkline data={[1, 2]} ariaLabel="growth chart" />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("aria-label")).toBe("growth chart");
    expect(svg?.getAttribute("role")).toBe("img");
  });

  it("flat line when min === max (no NaN)", () => {
    const { container } = render(<Sparkline data={[5, 5, 5]} />);
    const polyline = container.querySelector("polyline");
    const points = polyline?.getAttribute("points") ?? "";
    // None of the y coordinates should be NaN.
    expect(points).not.toMatch(/NaN/);
    // All y values should be equal (flat line).
    const ys = points.split(" ").map((p) => p.split(",")[1]);
    expect(new Set(ys).size).toBe(1);
  });

  it("uses currentColor for theme awareness", () => {
    const { container } = render(<Sparkline data={[1, 2]} />);
    const polyline = container.querySelector("polyline");
    expect(polyline?.getAttribute("stroke")).toBe("currentColor");
    const path = container.querySelector("path");
    expect(path?.getAttribute("fill")).toBe("currentColor");
    expect(path?.getAttribute("opacity")).toBe("0.15");
  });
});
