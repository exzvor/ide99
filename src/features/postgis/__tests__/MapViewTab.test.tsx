// — .
//
// We mock Leaflet entirely (jsdom can't run the real engine) and mock
// `parseEwkbHex` so these tests don't depend on whether // shipped its real EWKB parser yet. `toWgs84` is real but harmless when
// invoked with SRID 4326 (identity).
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { MapViewTab as MapViewTabModel } from "../../editor/store";

vi.mock("leaflet/dist/leaflet.css", () => ({}));

vi.mock("leaflet", () => {
  const map = {
    setView: vi.fn().mockReturnThis(),
    remove: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    fitBounds: vi.fn(),
  };
  const tileLayer = { addTo: vi.fn().mockReturnThis() };
  const featureGroup = {
    addTo: vi.fn().mockReturnThis(),
    getBounds: () => ({ isValid: () => true }),
    remove: vi.fn(),
  };
  const geoJSON = { addTo: vi.fn().mockReturnThis() };
  return {
    default: {
      map: vi.fn(() => map),
      tileLayer: vi.fn(() => tileLayer),
      featureGroup: vi.fn(() => featureGroup),
      geoJSON: vi.fn(() => geoJSON),
    },
  };
});

vi.mock("../ewkbParser", () => ({
  parseEwkbHex: vi.fn((hex: string) => {
    if (hex === "POINT_FIXTURE_4326") {
      return { type: "Point", coords: [37.6, 55.7], srid: 4326 };
    }
    if (hex === "POINT_FIXTURE_3857") {
      return { type: "Point", coords: [0, 0], srid: 3857 };
    }
    return { type: "Unsupported", reason: "test" };
  }),
}));

// Provide a minimal toWgs84 that returns identity for known SRIDs so the
// GeoJSON conversion path runs end-to-end in tests.
vi.mock("../sridProj", () => ({
  KNOWN_SRIDS: new Set([0, 4326, 3857, 4269]),
  toWgs84: vi.fn((coord: [number, number]) => coord),
}));

import { MapViewTab } from "../MapViewTab";

function makeTab(rows: string[][]): MapViewTabModel {
  return {
    id: "map-test",
    kind: "map-view",
    connectionId: "conn-1",
    rowsSnapshot: rows,
    columns: [
      { name: "id", typeName: "int4", isNumeric: true },
      { name: "geom", typeName: "geometry", isNumeric: false },
    ],
    geometryColumn: "geom",
    createdAt: "2026-05-04T00:00:00.000Z",
  };
}

describe("MapViewTab", () => {
  it("renders 'SRID: 4326' when all features share that SRID", () => {
    const tab = makeTab([
      ["1", "POINT_FIXTURE_4326"],
      ["2", "POINT_FIXTURE_4326"],
    ]);
    const { getByTestId } = render(<MapViewTab tab={tab} />);
    expect(getByTestId("map-srid-indicator").textContent).toBe("SRID: 4326");
    expect(getByTestId("map-geom-count").textContent).toBe("2 geom");
  });

  it("renders 'Mixed SRIDs' when features have different SRIDs", () => {
    const tab = makeTab([
      ["1", "POINT_FIXTURE_4326"],
      ["2", "POINT_FIXTURE_3857"],
    ]);
    const { getByTestId } = render(<MapViewTab tab={tab} />);
    expect(getByTestId("map-srid-indicator").textContent).toBe("Mixed SRIDs");
  });

  it("renders '—' indicator and 0 geom count when only Unsupported rows are present", () => {
    const tab = makeTab([
      ["1", "GARBAGE"],
      ["2", "ALSO_GARBAGE"],
    ]);
    const { getByTestId } = render(<MapViewTab tab={tab} />);
    expect(getByTestId("map-srid-indicator").textContent).toBe("—");
    expect(getByTestId("map-geom-count").textContent).toBe("0 geom");
  });

  it("flips the toolbar's active state when Pick Point is clicked", () => {
    const tab = makeTab([["1", "POINT_FIXTURE_4326"]]);
    const { getByTestId } = render(<MapViewTab tab={tab} />);
    expect(getByTestId("map-tool-pan").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(getByTestId("map-tool-point"));
    expect(getByTestId("map-tool-point").getAttribute("aria-pressed")).toBe("true");
    expect(getByTestId("map-tool-pan").getAttribute("aria-pressed")).toBe("false");
  });
});
