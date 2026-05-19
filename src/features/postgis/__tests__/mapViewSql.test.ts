// — : unit tests for the map-view SQL builder.
import { describe, expect, it } from "vitest";
import { buildOpenMapViewSql } from "../mapViewSql";

describe("buildOpenMapViewSql", () => {
  it("emits SELECT pk, geom FROM table LIMIT 5000 by default", () => {
    expect(
      buildOpenMapViewSql({
        qualifiedTable: "public.items",
        pk: "id",
        geometryColumn: "geom",
      }),
    ).toBe("SELECT id, geom FROM public.items LIMIT 5000");
  });

  it("omits the pk when null", () => {
    expect(
      buildOpenMapViewSql({
        qualifiedTable: "public.items",
        pk: null,
        geometryColumn: "geom",
      }),
    ).toBe("SELECT geom FROM public.items LIMIT 5000");
  });

  it("respects a custom limit", () => {
    expect(
      buildOpenMapViewSql({
        qualifiedTable: "public.items",
        pk: "id",
        geometryColumn: "geom",
        limit: 100,
      }),
    ).toBe("SELECT id, geom FROM public.items LIMIT 100");
  });
});
