// — owner: .
//
// Per-table pg_repack panel. Single button that opens the <RepackDialog/>
// — repack is an operation, not a property, so there's no badge in the
// SchemaTree.
import { type JSX, useState } from "react";

import { RepackDialog } from "./RepackDialog";

export interface PgRepackTablePanelProps {
  connId: string;
  database: string;
  schema: string;
  table: string;
}

const sectionTitle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: "var(--ink-3)",
  textTransform: "uppercase",
  letterSpacing: 0.4,
  marginBottom: 6,
};

export function PgRepackTablePanel(props: PgRepackTablePanelProps): JSX.Element {
  const { connId, database, schema, table } = props;
  const [open, setOpen] = useState(false);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={sectionTitle}>pg_repack</div>
      <div>
        <button
          type="button"
          className="btn btn-ghost"
          data-testid="pg-repack-panel-repack"
          onClick={() => setOpen(true)}
        >
          Repack table…
        </button>
      </div>
      <RepackDialog
        open={open}
        connId={connId}
        database={database}
        schema={schema}
        table={table}
        onClose={() => setOpen(false)}
      />
    </div>
  );
}
