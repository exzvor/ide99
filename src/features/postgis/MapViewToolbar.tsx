// — owner: .
//
// Drawing-tool selector for `MapViewTab`. Pure presentational component:
// the parent owns `active` state and reacts to `onChange`. Active button is
// distinguished both visually (via `--accent-soft` background) and via
// `aria-pressed`, mirroring the codebase's other toggle-button toolbars.
import type { JSX } from "react";

export type DrawTool = "pan" | "point" | "line" | "polygon";

export interface MapViewToolbarProps {
  active: DrawTool;
  onChange: (next: DrawTool) => void;
}

interface ToolDef {
  tool: DrawTool;
  label: string;
  testId: string;
  title: string;
}

const TOOLS: readonly ToolDef[] = [
  { tool: "pan", label: "Pan", testId: "map-tool-pan", title: "Pan / move the map" },
  {
    tool: "point",
    label: "Pick Point",
    testId: "map-tool-point",
    title: "Click on the map to copy a POINT WKT",
  },
  {
    tool: "line",
    label: "Pick Line",
    testId: "map-tool-line",
    title: "Click vertices, double-click to finish a LINESTRING WKT",
  },
  {
    tool: "polygon",
    label: "Pick Polygon",
    testId: "map-tool-polygon",
    title: "Click vertices, double-click to finish a POLYGON WKT",
  },
];

export function MapViewToolbar({ active, onChange }: MapViewToolbarProps): JSX.Element {
  return (
    <div
      data-testid="map-view-toolbar"
      role="toolbar"
      aria-label="Map drawing tools"
      style={{ display: "inline-flex", gap: 4 }}
    >
      {TOOLS.map((t) => {
        const isActive = active === t.tool;
        return (
          <button
            key={t.tool}
            type="button"
            data-testid={t.testId}
            aria-pressed={isActive}
            title={t.title}
            onClick={() => onChange(t.tool)}
            style={{
              padding: "4px 8px",
              fontSize: 12,
              border: "1px solid var(--hairline, #ccc)",
              borderRadius: 4,
              cursor: "pointer",
              background: isActive ? "var(--accent-soft, #e6efff)" : "transparent",
              color: "var(--ink-1, #222)",
              fontWeight: isActive ? 600 : 400,
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
