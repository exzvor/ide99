// — .
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { GeometryCellSvg } from "../GeometryCellSvg";
import type { Geometry } from "../ewkbParser";

describe("GeometryCellSvg", () => {
  it("renders a <circle> for Point geometries", () => {
    const geom: Geometry = { type: "Point", coords: [10, 20], srid: 4326 };
    const { getByTestId } = render(<GeometryCellSvg geom={geom} />);
    const svg = getByTestId("geom-cell-svg");
    expect(svg.querySelectorAll("circle")).toHaveLength(1);
  });

  it("renders a <polyline> for LineString with one point per coord", () => {
    const geom: Geometry = {
      type: "LineString",
      coords: [
        [0, 0],
        [10, 5],
        [20, 0],
      ],
      srid: 4326,
    };
    const { getByTestId } = render(<GeometryCellSvg geom={geom} />);
    const svg = getByTestId("geom-cell-svg");
    const polylines = svg.querySelectorAll("polyline");
    expect(polylines).toHaveLength(1);
    // points attribute should contain three "x,y" pairs.
    const points = polylines[0].getAttribute("points") ?? "";
    expect(points.trim().split(/\s+/)).toHaveLength(3);
  });

  it("renders a <polygon> for Polygon (outer ring only)", () => {
    const geom: Geometry = {
      type: "Polygon",
      coords: [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
          [0, 0],
        ],
      ],
      srid: 4326,
    };
    const { getByTestId } = render(<GeometryCellSvg geom={geom} />);
    const svg = getByTestId("geom-cell-svg");
    const polygons = svg.querySelectorAll("polygon");
    expect(polygons).toHaveLength(1);
    const points = polygons[0].getAttribute("points") ?? "";
    expect(points.trim().split(/\s+/)).toHaveLength(5);
  });

  it("renders one <polygon> per ring for MultiPolygon", () => {
    const geom: Geometry = {
      type: "MultiPolygon",
      coords: [
        [
          [
            [0, 0],
            [5, 0],
            [5, 5],
            [0, 5],
            [0, 0],
          ],
        ],
        [
          [
            [10, 10],
            [15, 10],
            [15, 15],
            [10, 15],
            [10, 10],
          ],
        ],
      ],
      srid: 4326,
    };
    const { getByTestId } = render(<GeometryCellSvg geom={geom} />);
    const svg = getByTestId("geom-cell-svg");
    expect(svg.querySelectorAll("polygon")).toHaveLength(2);
  });

  it("renders a `?` for Unsupported with the unsupported testid", () => {
    const geom: Geometry = { type: "Unsupported", reason: "test" };
    const { getByTestId } = render(<GeometryCellSvg geom={geom} />);
    const placeholder = getByTestId("geom-cell-unsupported");
    expect(placeholder.textContent).toBe("?");
  });
});
