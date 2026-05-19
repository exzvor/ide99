// — owner: .
//
// 2-tier modal that converts a regular table into a TimescaleDB hypertable.
// Basic section (always visible): time column + chunk time interval.
// Advanced section (collapsed by default): partitioning column + 3 toggles.
// Apply opens the generated SQL in a new Query Editor tab — never auto-runs.
import * as RadixDialog from "@radix-ui/react-dialog";
import { ChevronDown, ChevronRight } from "lucide-react";
import { type JSX, useMemo, useState } from "react";

import { useEditor } from "../editor/store";
import { IntervalInput, type IntervalValue, intervalToSqlLiteral } from "./IntervalInput";
import { buildCreateHypertableSql } from "./hypertableSql";
import { detectTimeColumns } from "./timescaleDetect";

export interface HypertableWizardProps {
  open: boolean;
  connId: string;
  qualifiedTable: string;
  columns: { name: string; typeName: string }[];
  onClose: () => void;
}

const fieldLabel: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  fontSize: 12,
  gap: 2,
};

export function HypertableWizard(props: HypertableWizardProps): JSX.Element | null {
  const { open, connId, qualifiedTable, columns, onClose } = props;

  const timeCandidates = useMemo(() => detectTimeColumns(columns), [columns]);

  const [timeCol, setTimeCol] = useState<string>(timeCandidates[0]?.name ?? "");
  const [chunkInterval, setChunkInterval] = useState<IntervalValue>({
    count: 7,
    unit: "day",
  });
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [partitioningCol, setPartitioningCol] = useState<string>("");
  const [migrateData, setMigrateData] = useState(false);
  const [ifNotExists, setIfNotExists] = useState(false);
  const [createDefaultIndexes, setCreateDefaultIndexes] = useState(false);

  if (!open) return null;

  const handleApply = (): void => {
    const sql = buildCreateHypertableSql({
      qualifiedTable,
      timeColumn: timeCol,
      chunkTimeInterval: intervalToSqlLiteral(chunkInterval),
      partitioningColumn: partitioningCol || undefined,
      migrateData: migrateData || undefined,
      ifNotExists: ifNotExists || undefined,
      createDefaultIndexes: createDefaultIndexes || undefined,
    });
    useEditor.getState().openEditorTab(connId, { prefillSql: sql });
    onClose();
  };

  return (    <RadixDialog.Root
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="q-backdrop" />
        <RadixDialog.Content
          className="q-modal md"
          data-testid="hypertable-wizard"
          style={{ padding: 20, minWidth: 480, display: "flex", flexDirection: "column", gap: 12 }}
        >
          <RadixDialog.Title className="q-modal-title">
            {`Convert to Hypertable: ${qualifiedTable}`}
          </RadixDialog.Title>
          <RadixDialog.Description style={{ fontSize: 12, color: "var(--ink-3)" }}>
            Generate a `create_hypertable(...)` call. The SQL opens in a new editor tab — review
            before running.
          </RadixDialog.Description>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <label style={fieldLabel}>
              <span>Time column</span>
              <select
                data-testid="hypertable-wizard-time-col"
                value={timeCol}
                onChange={(e) => setTimeCol(e.target.value)}
              >
                {timeCandidates.length === 0 ? (                  <option value="">No timestamp/date columns detected</option>
) : null}
                {timeCandidates.map((c) => (                  <option key={c.name} value={c.name}>
                    {c.name} ({c.typeName})
                  </option>
))}
              </select>
            </label>

            <div style={{ ...fieldLabel }}>
              <span>Chunk time interval</span>
              <IntervalInput
                idSuffix="hypertable-chunk"
                value={chunkInterval}
                onChange={setChunkInterval}
              />
            </div>

            <button
              type="button"
              className="btn btn-ghost"
              data-testid="hypertable-wizard-advanced-toggle"
              onClick={() => setAdvancedOpen((v) => !v)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                alignSelf: "flex-start",
                padding: 0,
                background: "transparent",
                border: "none",
                cursor: "pointer",
                fontSize: 12,
              }}
            >
              {advancedOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              <span>Advanced</span>
            </button>

            {advancedOpen ? (              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  padding: 8,
                  border: "1px solid var(--hairline)",
                  borderRadius: 4,
                }}
              >
                <label style={fieldLabel}>
                  <span>Partitioning column (optional)</span>
                  <select
                    data-testid="hypertable-wizard-partitioning-col"
                    value={partitioningCol}
                    onChange={(e) => setPartitioningCol(e.target.value)}
                  >
                    <option value="">— none —</option>
                    {columns.map((c) => (                      <option key={c.name} value={c.name}>
                        {c.name} ({c.typeName})
                      </option>
))}
                  </select>
                </label>
                <label style={{ fontSize: 12, display: "flex", gap: 6 }}>
                  <input
                    type="checkbox"
                    data-testid="hypertable-wizard-migrate-data"
                    checked={migrateData}
                    onChange={(e) => setMigrateData(e.target.checked)}
                  />
                  <span>migrate_data — copy existing rows into chunks</span>
                </label>
                <label style={{ fontSize: 12, display: "flex", gap: 6 }}>
                  <input
                    type="checkbox"
                    data-testid="hypertable-wizard-if-not-exists"
                    checked={ifNotExists}
                    onChange={(e) => setIfNotExists(e.target.checked)}
                  />
                  <span>if_not_exists — skip if already a hypertable</span>
                </label>
                <label style={{ fontSize: 12, display: "flex", gap: 6 }}>
                  <input
                    type="checkbox"
                    data-testid="hypertable-wizard-create-default-indexes"
                    checked={createDefaultIndexes}
                    onChange={(e) => setCreateDefaultIndexes(e.target.checked)}
                  />
                  <span>create_default_indexes — auto-add time-column index</span>
                </label>
              </div>
) : null}
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              data-testid="hypertable-wizard-apply"
              onClick={handleApply}
            >
              Apply
            </button>
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
);
}
