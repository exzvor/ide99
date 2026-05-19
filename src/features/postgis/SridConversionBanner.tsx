// — owner: .
// Yellow banner offering an ST_Transform helper for unknown SRIDs.
import type { JSX } from "react";

import { useEditor } from "../editor/store";

export interface SridConversionBannerProps {
  connId: string | null;
  geometryColumn: string;
  originalSql: string;
  unknownSrid: number;
}

function buildHelperSql(geometryColumn: string, originalSql: string, unknownSrid: number): string {
  return [
    `-- ide99: PostGIS SRID conversion helper for SRID ${unknownSrid}`,
    "SELECT *,",
    `       ST_AsEWKT(ST_Transform(${geometryColumn}, 4326)) AS ${geometryColumn}_wgs84`,
    `FROM (${originalSql}) sub;`,
  ].join("\n");
}

export function SridConversionBanner(props: SridConversionBannerProps): JSX.Element {
  const { connId, geometryColumn, originalSql, unknownSrid } = props;
  const disabled = connId === null;
  const handleClick = (): void => {
    if (disabled) return;
    const sql = buildHelperSql(geometryColumn, originalSql, unknownSrid);
    useEditor.getState().openEditorTab(connId, { prefillSql: sql });
  };

  return (
    <div
      data-testid="srid-conversion-banner"
      role="status"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "8px 12px",
        background: "rgba(250, 204, 21, 0.18)",
        border: "1px solid rgba(202, 138, 4, 0.55)",
        borderRadius: 4,
        color: "var(--ink-1, #1f2937)",
        fontSize: 13,
      }}
    >
      <span>
        Conversion required (SRID <code>{unknownSrid}</code>). Generate ST_Transform query?
      </span>
      <button
        type="button"
        data-testid="srid-banner-generate"
        onClick={handleClick}
        disabled={disabled}
        title={
          disabled
            ? "No connection — open a query editor manually"
            : "Generate an ST_Transform helper query"
        }
        style={{
          padding: "4px 10px",
          fontSize: 13,
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.6 : 1,
        }}
      >
        Generate query
      </button>
    </div>
  );
}
