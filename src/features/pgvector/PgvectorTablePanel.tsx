// — owner: .
//
// Per-table pgvector panel. Rendered by the SchemaBrowser under any table
// node that has at least one detected vector column. Three buttons each
// open one of the dedicated tools (kNN browse / 2D projection / hybrid
// search) — disabled state encodes the prerequisites each tool needs.
//
// Prerequisites:
// kNN          — at least one vector column.
// Projection   — at least one vector column AND a single-column primary key.
// Hybrid       — at least one vector column AND a tsvector column AND a pk.

import { type JSX, useEffect, useState } from "react";
import { HybridSearchWizard } from "./HybridSearchWizard";
import { KnnBrowseDialog } from "./KnnBrowseDialog";
import { KnnBrowseResultPane } from "./KnnBrowseResultPane";
import { VectorProjectionView } from "./VectorProjectionView";
import type { DetectedVectorColumn } from "./pgvectorDetect";

export interface PgvectorTablePanelProps {
  connId: string;
  qualifiedTable: string;
  pk: string | null;
  vectorColumns: DetectedVectorColumn[];
  textColumns: string[];
  rowCount: number;
}

export function PgvectorTablePanel(props: PgvectorTablePanelProps): JSX.Element | null {
  const { connId, qualifiedTable, pk, vectorColumns, textColumns, rowCount } = props;

  const [knnOpen, setKnnOpen] = useState<boolean>(false);
  const [knnResultSql, setKnnResultSql] = useState<string | null>(null);
  const [projectionOpen, setProjectionOpen] = useState<boolean>(false);
  const [hybridOpen, setHybridOpen] = useState<boolean>(false);

  // Reset transient dialog state when the user navigates to a different
  // table — otherwise the kNN result modal lingers over the new table's
  // panel and blocks pointer events.
  useEffect(() => {
    setKnnOpen(false);
    setKnnResultSql(null);
    setProjectionOpen(false);
    setHybridOpen(false);
  }, [qualifiedTable]);

  // Defence-in-depth: caller already gates on this, but render nothing
  // when the table has no vector columns so direct uses stay safe.
  if (vectorColumns.length === 0) return null;

  const primaryVectorCol = vectorColumns[0];
  const knnDisabled = vectorColumns.length === 0;
  const projectionDisabled = vectorColumns.length === 0 || pk === null;
  const hybridDisabled = vectorColumns.length === 0 || textColumns.length === 0 || pk === null;

  return (    <div
      data-testid="pgvector-table-panel"
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
      <div style={{ fontSize: 11, color: "var(--ink-3)", fontWeight: 600 }}>pgvector tools</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        <button
          type="button"
          data-testid="panel-knn"
          className="btn btn-ghost"
          disabled={knnDisabled}
          onClick={() => setKnnOpen(true)}
        >
          Find nearest…
        </button>
        <button
          type="button"
          data-testid="panel-projection"
          className="btn btn-ghost"
          disabled={projectionDisabled}
          onClick={() => setProjectionOpen(true)}
        >
          2D Projection…
        </button>
        <button
          type="button"
          data-testid="panel-hybrid"
          className="btn btn-ghost"
          disabled={hybridDisabled}
          onClick={() => setHybridOpen(true)}
        >
          Hybrid search…
        </button>
      </div>

      <KnnBrowseDialog
        open={knnOpen}
        connId={connId}
        qualifiedTable={qualifiedTable}
        vectorColumn={primaryVectorCol.name}
        onClose={() => setKnnOpen(false)}
        onSubmit={(req) => {
          setKnnOpen(false);
          setKnnResultSql(req.sql);
        }}
      />

      {knnResultSql !== null ? (        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1100,
            background: "rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          onMouseDown={() => setKnnResultSql(null)}
        >
          <div
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              background: "var(--bg, #fff)",
              border: "1px solid var(--hairline)",
              borderRadius: 6,
              minWidth: 600,
              maxWidth: "90vw",
              maxHeight: "80vh",
              overflow: "auto",
            }}
          >
            <KnnBrowseResultPane
              connId={connId}
              sql={knnResultSql}
              onClose={() => setKnnResultSql(null)}
            />
          </div>
        </div>
) : null}

      {projectionOpen && pk !== null ? (        <VectorProjectionView
          connId={connId}
          qualifiedTable={qualifiedTable}
          pk={pk}
          vectorColumn={primaryVectorCol.name}
          rowCount={rowCount}
          onClose={() => setProjectionOpen(false)}
        />
) : null}

      {pk !== null ? (        <HybridSearchWizard
          open={hybridOpen}
          connId={connId}
          qualifiedTable={qualifiedTable}
          pk={pk}
          vectorColumns={vectorColumns.map((c) => c.name)}
          textColumns={textColumns}
          onClose={() => setHybridOpen(false)}
        />
) : null}
    </div>
);
}
