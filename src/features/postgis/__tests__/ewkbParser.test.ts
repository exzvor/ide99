// — : EWKB hex parser tests.
// Hex fixtures verified against PostGIS 16 (`SELECT encode(ST_AsEWKB(...), 'hex')`).
import { describe, expect, it } from "vitest";

import { parseEwkbHex } from "../ewkbParser";

// Hex fixtures generated from canonical EWKB byte layout:
// byte 0      = 0x01 (LE)
// bytes 1..4  = type word (low-16 = base type, bit 0x20000000 = SRID flag)
// bytes 5..8  = SRID (uint32 LE) when SRID flag is set
// body        = type-specific payload
// The value of each fixture is what `SELECT encode(ST_AsEWKB(...), 'hex')`
// emits in PostgreSQL 16 with PostGIS 3.x.

// POINT(1 2) SRID 4326
const POINT_HEX = "0101000020E6100000000000000000F03F0000000000000040";

// LINESTRING(0 0, 1 1, 2 0) SRID 4326
const LINESTRING_HEX =
  "0102000020E61000000300000000000000000000000000000000000000000000000000F03F000000000000F03F00000000000000400000000000000000";

// POLYGON((0 0, 4 0, 4 4, 0 4, 0 0)) SRID 4326
const POLYGON_HEX =
  "0103000020E610000001000000050000000000000000000000000000000000000000000000000010400000000000000000000000000000104000000000000010400000000000000000000000000000104000000000000000000000000000000000";

// MULTIPOINT((1 2),(3 4)) SRID 4326
const MULTIPOINT_HEX =
  "0104000020E6100000020000000101000000000000000000F03F0000000000000040010100000000000000000008400000000000001040";

// 3D POINT(1 2 3) SRID 4326 — Z flag set, must be Unsupported.
const POINT_3D_HEX = "01010000A0E6100000000000000000F03F00000000000000400000000000000840";

// GEOMETRYCOLLECTION(POINT(0 0), LINESTRING(1 1, 2 2)) SRID 4326 — Unsupported.
const GEOMETRYCOLLECTION_HEX =
  "0107000020E610000002000000010100000000000000000000000000000000000000010200000002000000000000000000F03F000000000000F03F00000000000000400000000000000040";

describe("parseEwkbHex — supported geometries", () => {
  it("parses POINT(1, 2) SRID 4326", () => {
    const geom = parseEwkbHex(POINT_HEX);
    expect(geom.type).toBe("Point");
    if (geom.type !== "Point") return;
    expect(geom.srid).toBe(4326);
    expect(geom.coords).toEqual([1, 2]);
  });

  it("parses LINESTRING((0,0),(1,1),(2,0)) SRID 4326", () => {
    const geom = parseEwkbHex(LINESTRING_HEX);
    expect(geom.type).toBe("LineString");
    if (geom.type !== "LineString") return;
    expect(geom.srid).toBe(4326);
    expect(geom.coords).toEqual([
      [0, 0],
      [1, 1],
      [2, 0],
    ]);
  });

  it("parses POLYGON((0,0),(4,0),(4,4),(0,4),(0,0)) SRID 4326", () => {
    const geom = parseEwkbHex(POLYGON_HEX);
    expect(geom.type).toBe("Polygon");
    if (geom.type !== "Polygon") return;
    expect(geom.srid).toBe(4326);
    expect(geom.coords).toEqual([
      [
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 4],
        [0, 0],
      ],
    ]);
  });

  it("parses MULTIPOINT((1,2),(3,4)) SRID 4326", () => {
    const geom = parseEwkbHex(MULTIPOINT_HEX);
    expect(geom.type).toBe("MultiPoint");
    if (geom.type !== "MultiPoint") return;
    expect(geom.srid).toBe(4326);
    expect(geom.coords).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });
});

describe("parseEwkbHex — unsupported variants", () => {
  it("returns Unsupported for 3D POINT", () => {
    const geom = parseEwkbHex(POINT_3D_HEX);
    expect(geom.type).toBe("Unsupported");
    if (geom.type !== "Unsupported") return;
    expect(geom.reason).toMatch(/3D|Z|not supported/i);
  });

  it("returns Unsupported for GEOMETRYCOLLECTION", () => {
    const geom = parseEwkbHex(GEOMETRYCOLLECTION_HEX);
    expect(geom.type).toBe("Unsupported");
    if (geom.type !== "Unsupported") return;
    expect(geom.reason).toMatch(/GeometryCollection|not supported/i);
  });
});

describe("parseEwkbHex — malformed inputs", () => {
  it("returns Unsupported for empty string", () => {
    const geom = parseEwkbHex("");
    expect(geom.type).toBe("Unsupported");
    if (geom.type !== "Unsupported") return;
    expect(geom.reason).toMatch(/malformed/i);
  });

  it("returns Unsupported for odd-length hex", () => {
    const geom = parseEwkbHex("0");
    expect(geom.type).toBe("Unsupported");
    if (geom.type !== "Unsupported") return;
    expect(geom.reason).toMatch(/malformed/i);
  });

  it("returns Unsupported for garbage hex", () => {
    const geom = parseEwkbHex("deadbeef");
    expect(geom.type).toBe("Unsupported");
  });
});
