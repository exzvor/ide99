import { Clock, Layers, Snowflake, Trash2, Wand2 } from "lucide-react";
// — owner: .
import { type JSX, useState } from "react";
import { CompressionPolicyDialog } from "./CompressionPolicyDialog";
import { ContinuousAggregateWizard } from "./ContinuousAggregateWizard";
import { HypertableWizard } from "./HypertableWizard";
import { RefreshPolicyDialog } from "./RefreshPolicyDialog";
import { RetentionPolicyDialog } from "./RetentionPolicyDialog";

export interface TimescaleTablePanelProps {
  connId: string;
  schema: string;
  table: string;
  qualifiedTable: string;
  isHypertable: boolean;
  isContinuousAggregate: boolean;
  columns: { name: string; typeName: string }[];
}

type DialogKind = "convert" | "ca" | "compression" | "retention" | "refresh";

const DISABLED_TITLE = "Convert to hypertable first";

function PanelButton(props: {
  testId: string;
  label: string;
  icon: JSX.Element;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  title?: string;
}): JSX.Element {
  const { testId, label, icon, onClick, disabled, primary, title } = props;
  const base =
    "ts-panel-btn flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition";
  const variant = primary
    ? "border-transparent bg-blue-600 text-white hover:bg-blue-700 disabled:bg-blue-300"
    : "border-slate-300 bg-white text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed";
  return (    <button
      type="button"
      data-testid={testId}
      className={`${base} ${variant}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {icon}
      <span>{label}</span>
    </button>
);
}

export function TimescaleTablePanel(props: TimescaleTablePanelProps): JSX.Element | null {
  const { connId, schema, table, qualifiedTable, isHypertable, isContinuousAggregate, columns } =
    props;

  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const close = () => setDialog(null);

  return (    <div
      data-testid="timescale-table-panel"
      className="ts-panel rounded-lg border border-slate-200 bg-slate-50/50 p-3 dark:border-slate-800 dark:bg-slate-900/40"
    >
      <div className="ts-panel-title mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        TimescaleDB tools
      </div>

      <div className="ts-panel-actions flex flex-wrap gap-2">
        {!isHypertable && (          <PanelButton
            testId="ts-panel-convert"
            label="Convert to Hypertable…"
            icon={<Wand2 className="h-4 w-4" aria-hidden="true" />}
            primary
            onClick={() => setDialog("convert")}
          />
)}

        <PanelButton
          testId="ts-panel-ca"
          label="Continuous Aggregate…"
          icon={<Layers className="h-4 w-4" aria-hidden="true" />}
          disabled={!isHypertable}
          title={!isHypertable ? DISABLED_TITLE : undefined}
          onClick={() => setDialog("ca")}
        />
        <PanelButton
          testId="ts-panel-compression"
          label="Compression Policy…"
          icon={<Snowflake className="h-4 w-4" aria-hidden="true" />}
          disabled={!isHypertable}
          title={!isHypertable ? DISABLED_TITLE : undefined}
          onClick={() => setDialog("compression")}
        />
        <PanelButton
          testId="ts-panel-retention"
          label="Retention Policy…"
          icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
          disabled={!isHypertable}
          title={!isHypertable ? DISABLED_TITLE : undefined}
          onClick={() => setDialog("retention")}
        />

        {isHypertable && isContinuousAggregate && (          <PanelButton
            testId="ts-panel-refresh"
            label="Refresh Policy…"
            icon={<Clock className="h-4 w-4" aria-hidden="true" />}
            onClick={() => setDialog("refresh")}
          />
)}
      </div>

      <HypertableWizard
        open={dialog === "convert"}
        connId={connId}
        qualifiedTable={qualifiedTable}
        columns={columns}
        onClose={close}
      />
      <ContinuousAggregateWizard
        open={dialog === "ca"}
        connId={connId}
        qualifiedTable={qualifiedTable}
        schema={schema}
        table={table}
        columns={columns}
        onClose={close}
      />
      <CompressionPolicyDialog
        open={dialog === "compression"}
        connId={connId}
        qualifiedTable={qualifiedTable}
        schema={schema}
        table={table}
        columns={columns}
        onClose={close}
      />
      <RetentionPolicyDialog
        open={dialog === "retention"}
        connId={connId}
        qualifiedTable={qualifiedTable}
        schema={schema}
        table={table}
        onClose={close}
      />
      <RefreshPolicyDialog
        open={dialog === "refresh"}
        connId={connId}
        qualifiedView={qualifiedTable}
        schema={schema}
        view={table}
        onClose={close}
      />
    </div>
);
}
