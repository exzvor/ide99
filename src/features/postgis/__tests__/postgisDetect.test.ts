// — : postgisDetect tests.
import { describe, expect, it } from "vitest";

import { detectGeometryColumns } from "../postgisDetect";

describe("detectGeometryColumns", () => {
  it("returns empty array when no geometry/geography columns", () => {
    expect(      detectGeometryColumns([
        { name: "id", typeName: "int4" },
        { name: "label", typeName: "text" },
      ]),
).toEqual([]);
  });

  it("detects a single geometry(Point,4326) column", () => {
    const result = detectGeometryColumns([{ name: "geom", typeName: "geometry(Point,4326)" }]);
    expect(result).toEqual([{ name: "geom", type: "geometry", srid: 4326 }]);
  });

  it("detects mixed text + geometry + geography + bare geometry, preserves order", () => {
    const result = detectGeometryColumns([
      { name: "id", typeName: "int4" },
      { name: "label", typeName: "text" },
      { name: "loc", typeName: "geometry(Point,4326)" },
      { name: "area", typeName: "geography(Polygon, 4326)" },
      { name: "raw", typeName: "geometry" },
    ]);
    expect(result).toEqual([
      { name: "loc", type: "geometry", srid: 4326 },
      { name: "area", type: "geography", srid: 4326 },
      { name: "raw", type: "geometry", srid: null },
    ]);
  });

  it("matches case-insensitively (e.g. GEOMETRY(POINT,3857))", () => {
    const result = detectGeometryColumns([{ name: "g", typeName: "GEOMETRY(POINT,3857)" }]);
    expect(result).toEqual([{ name: "g", type: "geometry", srid: 3857 }]);
  });
});
