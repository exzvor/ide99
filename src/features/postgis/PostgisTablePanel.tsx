// — owner: .
//
// Per-table PostGIS panel. Rendered by the SchemaBrowser (Phase E wires
// the slot) under any table node that has at least one detected geometry
// column. One button — "Open Map View…" — runs a small SELECT and opens
// a Map View tab with the result snapshot.
//
// Mirrors the PgvectorTablePanel pattern: defence-in-depth null when
// there are no geometry columns, single inline error message on failure,
// no toast/zustand state of its own.

import { type JSX, useState } from "react";
import { queryExecute } from "../../lib/tauri";
import { useEditor } from "../editor/store";
import { buildOpenMapViewSql } from "./mapViewSql";
import type { DetectedGeometryColumn } from "./postgisDetect";

export interface PostgisTablePanelProps {
  connId: string;
  qualifiedTable: string;
  pk: string | null;
  geometryColumns: DetectedGeometryColumn[];
  rowCount: number;
}

export function PostgisTablePanel(props: PostgisTablePanelProps): JSX.Element | null {
  const { connId, qualifiedTable, pk, geometryColumns } = props;

  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Defence-in-depth: caller already gates on this, but render nothing
  // when the table has no geometry columns so direct uses stay safe.
  if (geometryColumns.length === 0) return null;

  const primaryGeometry = geometryColumns[0];

  async function handleOpenMapView(): Promise<void> {
    setLoading(true);
    setError(null);
    const sql = buildOpenMapViewSql({
      qualifiedTable,
      pk,
      geometryColumn: primaryGeometry.name,
    });
    try {
      const result = await queryExecute(connId, sql);
      // The Map View tab stores `string[][]`; QueryResult.rows is
      // `(string | null)[][]`. Normalize nulls to empty strings — the
      // viewer treats missing geometry the same way.
      const rowsSnapshot: string[][] = result.rows.map((row) =>
        row.map((cell) => (cell === null ? "" : cell)),
);
      useEditor.getState().openMapViewTab({
        connectionId: connId,
        rowsSnapshot,
        columns: result.columns,
        geometryColumn: primaryGeometry.name,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (    <div
      data-testid="postgis-table-panel"
      style={{
        background: "var(--surface, #fff)",
        border: "1px solid var(--hairline)",
        borderRadius: 6,
        padding: 8,
        margin: 4,
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div style={{ fontSize: 11, color: "var(--ink-3)", fontWeight: 600 }}>PostGIS tools</div>
      <div style={{ display: "flex", gap: 6 }}>
        <button
          type="button"
          data-testid="postgis-panel-open-map-view"
          className="btn btn-ghost"
          disabled={loading}
          onClick={() => {
            void handleOpenMapView();
          }}
        >
          {loading ? "Loading…" : "Open Map View…"}
        </button>
      </div>
      {error !== null ? (        <div
          data-testid="postgis-panel-error"
          style={{ fontSize: 11, color: "var(--danger, #c0392b)" }}
        >
          {error}
        </div>
) : null}
    </div>
);
}
