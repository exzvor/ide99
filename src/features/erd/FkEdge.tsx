import type { JSX } from "react";
import type { LaidErdEdge } from "./layout";

interface FkEdgeProps {
  edge: LaidErdEdge;
  highlighted: boolean;
}

/**
 * — single FK arrow on the ERD canvas. The arrow marker
 * (`#erd-arrow`) is defined exactly once inside `<Canvas />` so all edges
 * share the same triangle and the SVG stays small. Highlight just swaps
 * the stroke colour + width to `var(--accent)` so a focused FK pops over
 * the surrounding hairline traffic without redrawing geometry.
 */
export function FkEdge({ edge, highlighted }: FkEdgeProps): JSX.Element {
  const stroke = highlighted ? "var(--accent)" : "var(--hairline)";
  const strokeWidth = highlighted ? 1.5 : 1;
  return (    <g data-testid="erd-fk-edge" data-edge-id={edge.id}>
      <path
        d={edge.d}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        markerEnd="url(#erd-arrow)"
      />
    </g>
);
}
