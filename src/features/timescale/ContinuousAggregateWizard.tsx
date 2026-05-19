// — owner: .
//
// Single-tier modal that drafts a continuous aggregate against the parent
// hypertable. The view name is auto-quoted as `"<schema>"."<viewName>"` by
// default; users can opt into a raw qualified name via a checkbox.
import * as RadixDialog from "@radix-ui/react-dialog";
import { type JSX, useMemo, useState } from "react";

import { useEditor } from "../editor/store";
import { IntervalInput, type IntervalValue, intervalToSqlLiteral } from "./IntervalInput";
import { buildContinuousAggregateSql } from "./continuousAggregateSql";
import { detectTimeColumns } from "./timescaleDetect";

export interface ContinuousAggregateWizardProps {
  open: boolean;
  connId: string;
  qualifiedTable: string;
  schema: string;
  table: string;
  columns: { name: string; typeName: string }[];
  onClose: () => void;
}

const fieldLabel: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  fontSize: 12,
  gap: 2,
};

export function ContinuousAggregateWizard(  props: ContinuousAggregateWizardProps,
): JSX.Element | null {
  const { open, connId, qualifiedTable, schema, columns, onClose } = props;

  const timeCandidates = useMemo(() => detectTimeColumns(columns), [columns]);

  const [viewName, setViewName] = useState<string>("");
  const [customQualifiedName, setCustomQualifiedName] = useState(false);
  const [rawQualifiedName, setRawQualifiedName] = useState<string>("");
  const [timeCol, setTimeCol] = useState<string>(timeCandidates[0]?.name ?? "");
  const [bucket, setBucket] = useState<IntervalValue>({ count: 1, unit: "hour" });
  const [aggregations, setAggregations] = useState<string>("");
  const [groupByExtra, setGroupByExtra] = useState<string>("");
  const [withData, setWithData] = useState(false);

  if (!open) return null;

  const resolvedViewName = customQualifiedName ? rawQualifiedName : `"${schema}"."${viewName}"`;

  const handleApply = (): void => {
    const sql = buildContinuousAggregateSql({
      viewName: resolvedViewName,
      sourceHypertable: qualifiedTable,
      timeColumn: timeCol,
      bucketInterval: intervalToSqlLiteral(bucket),
      aggregationsExpression: aggregations,
      groupByExtra,
      withData,
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
          data-testid="continuous-aggregate-wizard"
          style={{ padding: 20, minWidth: 520, display: "flex", flexDirection: "column", gap: 12 }}
        >
          <RadixDialog.Title className="q-modal-title">
            Create Continuous Aggregate
          </RadixDialog.Title>
          <RadixDialog.Description style={{ fontSize: 12, color: "var(--ink-3)" }}>
            Drafts a `CREATE MATERIALIZED VIEW … WITH (timescaledb.continuous)` for review.
          </RadixDialog.Description>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {customQualifiedName ? (              <label style={fieldLabel}>
                <span>Qualified view name (raw)</span>
                <input
                  type="text"
                  data-testid="continuous-aggregate-wizard-view-name-raw"
                  value={rawQualifiedName}
                  onChange={(e) => setRawQualifiedName(e.target.value)}
                  placeholder='analytics."cagg_v1"'
                />
              </label>
) : (              <label style={fieldLabel}>
                <span>{`View name (will be quoted as "${schema}"."<name>")`}</span>
                <input
                  type="text"
                  data-testid="continuous-aggregate-wizard-view-name"
                  value={viewName}
                  onChange={(e) => setViewName(e.target.value)}
                  placeholder="hourly_metrics"
                />
              </label>
)}
            <label style={{ fontSize: 12, display: "flex", gap: 6 }}>
              <input
                type="checkbox"
                data-testid="continuous-aggregate-wizard-custom-name"
                checked={customQualifiedName}
                onChange={(e) => setCustomQualifiedName(e.target.checked)}
              />
              <span>Use custom qualified name</span>
            </label>

            <div style={{ ...fieldLabel }}>
              <span>Source hypertable</span>
              <code style={{ fontSize: 12, padding: "2px 4px", background: "var(--bg-2)" }}>
                {qualifiedTable}
              </code>
            </div>

            <label style={fieldLabel}>
              <span>Time column</span>
              <select
                data-testid="continuous-aggregate-wizard-time-col"
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

            <div style={fieldLabel}>
              <span>Bucket interval</span>
              <IntervalInput idSuffix="cagg-bucket" value={bucket} onChange={setBucket} />
            </div>

            <label style={fieldLabel}>
              <span>Aggregations expression</span>
              <textarea
                data-testid="continuous-aggregate-wizard-aggregations"
                value={aggregations}
                onChange={(e) => setAggregations(e.target.value)}
                placeholder="count(*) AS n, avg(temperature) AS avg_t"
                rows={3}
              />
            </label>

            <label style={fieldLabel}>
              <span>Group-by extra (optional)</span>
              <input
                type="text"
                data-testid="continuous-aggregate-wizard-groupby"
                value={groupByExtra}
                onChange={(e) => setGroupByExtra(e.target.value)}
                placeholder="device_id"
              />
            </label>

            <label style={{ fontSize: 12, display: "flex", gap: 6 }}>
              <input
                type="checkbox"
                data-testid="continuous-aggregate-wizard-with-data"
                checked={withData}
                onChange={(e) => setWithData(e.target.checked)}
              />
              <span>Materialize WITH DATA (otherwise WITH NO DATA)</span>
            </label>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              data-testid="continuous-aggregate-wizard-apply"
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
