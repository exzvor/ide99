// — per-table panel for the SchemaBrowser. Two states:
// * Regular table → single primary "Create Partition Set…" button.
// * Partman parent → inline summary + "View Config…" button (the config
// dialog hosts the maintenance + drop actions).
import { Layers } from "lucide-react";
import { type JSX, useState } from "react";

import { ConfigViewerDialog } from "./ConfigViewerDialog";
import { CreateParentWizard } from "./CreateParentWizard";
import type { PartmanParent } from "./store";

export interface PgPartmanTablePanelProps {
  connId: string;
  schema: string;
  table: string;
  qualifiedTable: string;
  isPartmanParent: boolean;
  partmanInfo: PartmanParent | null;
  columns: { name: string; typeName: string }[];
}

type DialogKind = "create" | "config";

export function PgPartmanTablePanel(props: PgPartmanTablePanelProps): JSX.Element | null {
  const { connId, schema, table, qualifiedTable, isPartmanParent, partmanInfo, columns } = props;
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const close = (): void => setDialog(null);

  // The ConfigViewerDialog uses the un-quoted "schema.table" string both as
  // the partman literal and as the typing-confirm token.
  const partmanQualified = `${schema}.${table}`;

  const summaryText = partmanInfo
    ? `Control: ${partmanInfo.controlColumn}, every ${partmanInfo.intervalText}, retention ${
        partmanInfo.retentionText ?? "none"
      }, premake ${partmanInfo.premakeCount}`
    : "";

  return (    <div
      data-testid="pg-partman-table-panel"
      className="ts-panel rounded-lg border border-slate-200 bg-slate-50/50 p-3 dark:border-slate-800 dark:bg-slate-900/40"
    >
      <div className="ts-panel-title mb-2 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        <Layers className="h-3 w-3" aria-hidden="true" />
        <span>pg_partman</span>
      </div>

      {isPartmanParent && partmanInfo ? (        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <p
            data-testid="pg-partman-panel-summary"
            style={{ margin: 0, fontSize: 12, color: "var(--ink-2)" }}
          >
            {summaryText}
          </p>
          <div className="ts-panel-actions flex flex-wrap gap-2">
            <button
              type="button"
              data-testid="pg-partman-panel-config"
              className="ts-panel-btn flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
              onClick={() => setDialog("config")}
            >
              View Config…
            </button>
          </div>
        </div>
) : (        <div className="ts-panel-actions flex flex-wrap gap-2">
          <button
            type="button"
            data-testid="pg-partman-panel-create"
            className="ts-panel-btn flex items-center gap-2 rounded-md border border-transparent bg-blue-600 px-3 py-1.5 text-sm text-white transition hover:bg-blue-700"
            onClick={() => setDialog("create")}
          >
            Create Partition Set…
          </button>
        </div>
)}

      {dialog === "create" ? (        <CreateParentWizard
          open={true}
          connId={connId}
          schema={schema}
          table={table}
          qualifiedTable={qualifiedTable}
          columns={columns}
          onClose={close}
        />
) : null}
      {partmanInfo ? (        <ConfigViewerDialog
          open={dialog === "config"}
          connId={connId}
          qualifiedTable={partmanQualified}
          partmanInfo={partmanInfo}
          onClose={close}
        />
) : null}
    </div>
);
}
