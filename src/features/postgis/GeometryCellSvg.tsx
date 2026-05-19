// — owner: .
//
// Renders a 120x60 SVG miniature of a parsed PostGIS geometry. No deps, no
// network, no theme assumptions beyond CSS custom properties already present
// in the codebase. Holes in polygons are intentionally dropped (only outer
// rings are drawn). Unsupported variants fall back to a centered "?" glyph.
import type { JSX } from "react";

import type { Geometry } from "./ewkbParser";

export interface GeometryCellSvgProps {
  geom: Geometry;
}

const VIEW_W = 120;
const VIEW_H = 60;
const PAD = 4;
const STROKE = "var(--ink-2, #555)";
const FILL = "rgba(60, 120, 220, 0.25)";
const POINT_FILL = "var(--accent, #4080ff)";

type Coord = readonly [number, number];

function collectAllCoords(geom: Geometry): Coord[] {
  switch (geom.type) {
    case "Point":
      return [geom.coords];
    case "LineString":
    case "MultiPoint":
      return geom.coords;
    case "Polygon":
      return geom.coords[0] ?? [];
    case "MultiLineString":
      return geom.coords.flat();
    case "MultiPolygon":
      return geom.coords.flatMap((poly) => poly[0] ?? []);
    default:
      return [];
  }
}

function makeProjector(coords: Coord[]): (c: Coord) => [number, number] {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const [x, y] of coords) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  let dx = maxX - minX;
  let dy = maxY - minY;
  if (dx === 0) {
    minX -= 0.0001;
    dx = 0.0002;
  }
  if (dy === 0) {
    minY -= 0.0001;
    dy = 0.0002;
  }
  const innerW = VIEW_W - 2 * PAD;
  const innerH = VIEW_H - 2 * PAD;
  return ([x, y]) => {
    const sx = PAD + ((x - minX) / dx) * innerW;
    // Flip Y so larger latitudes render upward.
    const sy = PAD + (1 - (y - minY) / dy) * innerH;
    return [sx, sy];
  };
}

function pointsAttr(coords: Coord[], project: (c: Coord) => [number, number]): string {
  return coords
    .map((c) => {
      const [sx, sy] = project(c);
      return `${sx.toFixed(2)},${sy.toFixed(2)}`;
    })
    .join(" ");
}

export function GeometryCellSvg({ geom }: GeometryCellSvgProps): JSX.Element {
  if (geom.type === "Unsupported") {
    return (
      <svg
        data-testid="geom-cell-svg"
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        width={VIEW_W}
        height={VIEW_H}
        role="img"
        aria-label="unsupported geometry"
      >
        <text
          data-testid="geom-cell-unsupported"
          x={VIEW_W / 2}
          y={VIEW_H / 2}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={14}
          fill={STROKE}
        >
          ?
        </text>
      </svg>
    );
  }

  const all = collectAllCoords(geom);
  if (all.length === 0) {
    return (
      <svg
        data-testid="geom-cell-svg"
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        width={VIEW_W}
        height={VIEW_H}
        role="img"
        aria-label="empty geometry"
      />
    );
  }

  const project = makeProjector(all);
  const shapes: JSX.Element[] = [];

  switch (geom.type) {
    case "Point": {
      const [sx, sy] = project(geom.coords);
      shapes.push(
        <circle
          key="p"
          cx={sx}
          cy={sy}
          r={2.5}
          fill={POINT_FILL}
          stroke={STROKE}
          strokeWidth={1}
        />,
      );
      break;
    }
    case "MultiPoint": {
      geom.coords.forEach((c, i) => {
        const [sx, sy] = project(c);
        shapes.push(
          <circle
            key={`p${i}`}
            cx={sx}
            cy={sy}
            r={2.5}
            fill={POINT_FILL}
            stroke={STROKE}
            strokeWidth={1}
          />,
        );
      });
      break;
    }
    case "LineString": {
      shapes.push(
        <polyline
          key="ls"
          points={pointsAttr(geom.coords, project)}
          fill="none"
          stroke={STROKE}
          strokeWidth={1}
        />,
      );
      break;
    }
    case "MultiLineString": {
      geom.coords.forEach((line, i) => {
        shapes.push(
          <polyline
            key={`ls${i}`}
            points={pointsAttr(line, project)}
            fill="none"
            stroke={STROKE}
            strokeWidth={1}
          />,
        );
      });
      break;
    }
    case "Polygon": {
      const outer = geom.coords[0] ?? [];
      shapes.push(
        <polygon
          key="po"
          points={pointsAttr(outer, project)}
          fill={FILL}
          stroke={STROKE}
          strokeWidth={1}
        />,
      );
      break;
    }
    case "MultiPolygon": {
      geom.coords.forEach((poly, i) => {
        const outer = poly[0] ?? [];
        shapes.push(
          <polygon
            key={`po${i}`}
            points={pointsAttr(outer, project)}
            fill={FILL}
            stroke={STROKE}
            strokeWidth={1}
          />,
        );
      });
      break;
    }
  }

  return (
    <svg
      data-testid="geom-cell-svg"
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      width={VIEW_W}
      height={VIEW_H}
      role="img"
      aria-label={`${geom.type} geometry`}
    >
      {shapes}
    </svg>
  );
}
