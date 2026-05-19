import L from "leaflet";
// — owner: .
//
// MapViewTab renders a Leaflet map for a snapshot of result rows that include
// a geometry column. Renders all parsed geometries as GeoJSON, auto-fits the
// map to their bbox on mount, and exposes drawing tools that copy WKT to the
// clipboard.
//
// We use bare `leaflet` (not react-leaflet) to keep the dep graph small and
// because we only need three or four Leaflet primitives. jsdom can't drive
// the real engine, so the tests mock the entire module.
import { type JSX, useEffect, useMemo, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";

import { type MapViewTab as MapViewTabModel, useEditor } from "../editor/store";

import { type DrawTool, MapViewToolbar } from "./MapViewToolbar";
import { type Geometry, parseEwkbHex } from "./ewkbParser";
import { toWgs84 } from "./sridProj";

export interface MapViewTabProps {
  tab: MapViewTabModel;
}

type Coord = [number, number];

/** Convert a parsed Geometry into a GeoJSON geometry, projecting every coord
 * to WGS84 via `toWgs84`. Returns `null` if any coord can't be projected
 * (e.g. unknown SRID). */
function geometryToGeoJson(g: Geometry): GeoJSON.Geometry | null {
  if (g.type === "Unsupported") return null;
  const project = (c: Coord): Coord | null => toWgs84(c, g.srid);

  switch (g.type) {
    case "Point": {
      const p = project(g.coords);
      if (!p) return null;
      return { type: "Point", coordinates: p };
    }
    case "MultiPoint": {
      const out: Coord[] = [];
      for (const c of g.coords) {
        const p = project(c);
        if (!p) return null;
        out.push(p);
      }
      return { type: "MultiPoint", coordinates: out };
    }
    case "LineString": {
      const out: Coord[] = [];
      for (const c of g.coords) {
        const p = project(c);
        if (!p) return null;
        out.push(p);
      }
      return { type: "LineString", coordinates: out };
    }
    case "MultiLineString": {
      const out: Coord[][] = [];
      for (const line of g.coords) {
        const lineOut: Coord[] = [];
        for (const c of line) {
          const p = project(c);
          if (!p) return null;
          lineOut.push(p);
        }
        out.push(lineOut);
      }
      return { type: "MultiLineString", coordinates: out };
    }
    case "Polygon": {
      const rings: Coord[][] = [];
      for (const ring of g.coords) {
        const ringOut: Coord[] = [];
        for (const c of ring) {
          const p = project(c);
          if (!p) return null;
          ringOut.push(p);
        }
        rings.push(ringOut);
      }
      return { type: "Polygon", coordinates: rings };
    }
    case "MultiPolygon": {
      const polys: Coord[][][] = [];
      for (const poly of g.coords) {
        const polyOut: Coord[][] = [];
        for (const ring of poly) {
          const ringOut: Coord[] = [];
          for (const c of ring) {
            const p = project(c);
            if (!p) return null;
            ringOut.push(p);
          }
          polyOut.push(ringOut);
        }
        polys.push(polyOut);
      }
      return { type: "MultiPolygon", coordinates: polys };
    }
  }
}

export function MapViewTab({ tab }: MapViewTabProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const [active, setActive] = useState<DrawTool>("pan");
  const [draftPoints, setDraftPoints] = useState<L.LatLng[]>([]);

  const features = useMemo<Geometry[]>(() => {
    const idx = tab.columns.findIndex((c) => c.name === tab.geometryColumn);
    if (idx < 0) return [];
    return tab.rowsSnapshot.map((row) => parseEwkbHex(row[idx] ?? ""));
  }, [tab.columns, tab.geometryColumn, tab.rowsSnapshot]);

  const srids = useMemo(() => {
    const s = new Set<number>();
    for (const f of features) {
      if (f.type !== "Unsupported") s.add(f.srid);
    }
    return s;
  }, [features]);

  const sridLabel =
    srids.size === 0 ? "—" : srids.size === 1 ? `SRID: ${[...srids][0]}` : "Mixed SRIDs";
  const geomCount = features.filter((f) => f.type !== "Unsupported").length;

  // Mount Leaflet on first render.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current).setView([0, 0], 2);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Render GeoJSON features and auto-fit bbox.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const layer = L.featureGroup();
    for (const f of features) {
      if (f.type === "Unsupported") continue;
      const geojson = geometryToGeoJson(f);
      if (geojson) {
        L.geoJSON(geojson).addTo(layer);
      }
    }
    layer.addTo(map);
    const bounds = layer.getBounds();
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [20, 20] });
    }
    return () => {
      layer.remove();
    };
  }, [features]);

  // Drawing handlers — only attach when we're not in pan mode.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (active === "pan") return;

    const handler = (e: L.LeafletMouseEvent) => {
      if (active === "point") {
        const wkt = `POINT(${e.latlng.lng} ${e.latlng.lat})`;
        void navigator.clipboard.writeText(wkt);
        // Simple toast — the codebase has no global toast surface yet.
        // eslint-disable-next-line no-alert
        alert(`Copied: ${wkt}`);
        setActive("pan");
      } else {
        setDraftPoints((p) => [...p, e.latlng]);
      }
    };

    const dblHandler = () => {
      if (draftPoints.length === 0) return;
      const coords = draftPoints.map((p) => `${p.lng} ${p.lat}`).join(", ");
      const wkt =
        active === "line"
          ? `LINESTRING(${coords})`
          : `POLYGON((${coords}, ${draftPoints[0].lng} ${draftPoints[0].lat}))`;
      void navigator.clipboard.writeText(wkt);
      // eslint-disable-next-line no-alert
      alert(`Copied: ${wkt}`);
      setDraftPoints([]);
      setActive("pan");
    };

    map.on("click", handler);
    map.on("dblclick", dblHandler);
    return () => {
      map.off("click", handler);
      map.off("dblclick", dblHandler);
    };
  }, [active, draftPoints]);

  return (
    <div
      data-testid="map-view-tab"
      style={{ display: "flex", flexDirection: "column", height: "100%" }}
    >
      <div
        style={{
          padding: 8,
          display: "flex",
          gap: 12,
          alignItems: "center",
          borderBottom: "1px solid var(--hairline, #ddd)",
        }}
      >
        <MapViewToolbar active={active} onChange={setActive} />
        <div data-testid="map-srid-indicator" style={{ fontSize: 12, color: "var(--ink-3, #666)" }}>
          {sridLabel}
        </div>
        <div data-testid="map-geom-count" style={{ fontSize: 12, color: "var(--ink-3, #666)" }}>
          {geomCount} geom
        </div>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          onClick={() => {
            void useEditor.getState().closeTab(tab.id);
          }}
          style={{
            padding: "4px 8px",
            fontSize: 12,
            border: "1px solid var(--hairline, #ccc)",
            borderRadius: 4,
            background: "transparent",
            cursor: "pointer",
          }}
        >
          Close
        </button>
      </div>
      <div ref={containerRef} style={{ flex: 1, minHeight: 0 }} data-testid="map-view-leaflet" />
    </div>
  );
}
