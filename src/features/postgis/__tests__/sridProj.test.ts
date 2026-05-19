// — : sridProj tests.
import { describe, expect, it } from "vitest";

import { toWgs84 } from "../sridProj";

describe("toWgs84", () => {
  it("returns coord unchanged for SRID 4326", () => {
    expect(toWgs84([37.6175, 55.7504], 4326)).toEqual([37.6175, 55.7504]);
  });

  it("returns coord unchanged for SRID 0", () => {
    expect(toWgs84([1, 2], 0)).toEqual([1, 2]);
  });

  it("projects Web Mercator (3857) Moscow ≈ (37.6175, 55.7504)", () => {
    // Web Mercator forward of (37.6175, 55.7504) ≈ (4187560.94, 7508886.97).
    // (Brief gave (4187591.16, 7472635.07) which decodes to (37.6178, 55.5667)
    // — Y component drifts 0.18° in lat, well past the ±0.01 spec tolerance.
    // Substitute the mathematically consistent forward-projection so the
    // round-trip holds at ±0.005.)
    const result = toWgs84([4187560.94, 7508886.97], 3857);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result[0]).toBeCloseTo(37.6175, 2);
    expect(result[1]).toBeCloseTo(55.7504, 2);
  });

  it("projects NAD83 (4269) DC ≈ same as input (NAD83 ≈ WGS84 in CONUS)", () => {
    const result = toWgs84([-77.0369, 38.8951], 4269);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result[0]).toBeCloseTo(-77.0369, 2);
    expect(result[1]).toBeCloseTo(38.8951, 2);
  });

  it("returns null for unknown SRID 32636", () => {
    expect(toWgs84([500000, 6000000], 32636)).toBeNull();
  });
});
