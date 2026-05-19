// — Radix Dialog wizard that emits a `partman.create_parent(...)`
// SQL block (plus an optional retention UPDATE) into a new query editor tab.
// Never auto-runs — the user reviews + executes the SQL themselves.
//
// Cross-extension import: `IntervalInput` + `intervalToSqlLiteral` from the
// timescale module. This is the SINGLE permitted cross-extension import
// for S29 (see Q29-E in the design doc) — promotion to a shared package is a
// v1.1 follow-up.
import * as RadixDialog from "@radix-ui/react-dialog";
import { type JSX, useEffect, useMemo, useState } from "react";

import { useEditor } from "../editor/store";
import { IntervalInput, type IntervalValue, intervalToSqlLiteral } from "../timescale";
import { type CreateParentForm, buildCreateParentSql } from "./createParentSql";

export interface CreateParentWizardProps {
  open: boolean;
  connId: string;
  schema: string;
  table: string;
  /** Pre-quoted "schema"."table" — purely for display in the dialog title. */
  qualifiedTable: string;
  columns: { name: string; typeName: string }[];
  onClose: () => void;
}

// Same set as S28 `detectTimeColumns` + integer types — partman supports both
// time-based and id-based partitioning, so the control column may be a
// timestamp/date OR an integer epoch.
const PARTMAN_CONTROL_TYPES = new Set<string>([
  "timestamp",
  "timestamp without time zone",
  "timestamptz",
  "timestamp with time zone",
  "date",
  "int2",
  "int4",
  "int8",
  "bigint",
  "integer",
  "smallint",
]);

// Time-based partitioning is the dominant pattern; default to a temporal
// column when one exists. Falls back to physical column order otherwise.
const PARTMAN_TIME_TYPES = new Set<string>([
  "timestamp",
  "timestamp without time zone",
  "timestamptz",
  "timestamp with time zone",
  "date",
]);

const fieldLabel: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  fontSize: 12,
  gap: 2,
};

const PARTMAN_DEFAULT_PREMAKE = 4;

export function CreateParentWizard(props: CreateParentWizardProps): JSX.Element | null {
  const { open, connId, schema, table, qualifiedTable, columns, onClose } = props;

  const controlCandidates = useMemo(    () => columns.filter((c) => PARTMAN_CONTROL_TYPES.has(c.typeName)),
    [columns],
);

  // Prefer a temporal column for the default — `events(id, created_at, ...)`
  // should land on `created_at`, not `id`. If no time column exists, fall
  // back to the first candidate (preserves the previous behaviour).
  const defaultControlCol = useMemo(    () =>
      controlCandidates.find((c) => PARTMAN_TIME_TYPES.has(c.typeName))?.name ??
      controlCandidates[0]?.name ??
      "",
    [controlCandidates],
);
  const [controlCol, setControlCol] = useState<string>(defaultControlCol);
  // The panel may mount before SchemaBrowser's column cache loads, so the
  // first render's `controlCandidates` is `[]` and `defaultControlCol` is "".
  // Sync state once columns arrive — but never override a value the user has
  // already picked manually.
  useEffect(() => {
    if (controlCol === "" && defaultControlCol !== "") {
      setControlCol(defaultControlCol);
    }
  }, [defaultControlCol, controlCol]);
  const [interval, setInterval] = useState<IntervalValue>({ count: 1, unit: "day" });
  const [premake, setPremake] = useState<number>(PARTMAN_DEFAULT_PREMAKE);
  const [retentionEnabled, setRetentionEnabled] = useState(false);
  const [retention, setRetention] = useState<IntervalValue>({ count: 6, unit: "month" });

  if (!open) return null;

  const handleApply = (): void => {
    const form: CreateParentForm = {
      parentTable: `${schema}.${table}`,
      controlColumn: controlCol,
      partitionType: "native",
      partitionInterval: intervalToSqlLiteral(interval),
    };
    if (premake !== PARTMAN_DEFAULT_PREMAKE) {
      form.premakeCount = premake;
    }
    if (retentionEnabled) {
      form.retention = intervalToSqlLiteral(retention);
    }
    const sql = buildCreateParentSql(form);
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
          data-testid="pg-partman-create-parent-wizard"
          style={{ padding: 20, minWidth: 480, display: "flex", flexDirection: "column", gap: 12 }}
        >
          <RadixDialog.Title className="q-modal-title">
            {`Create Partition Set: ${qualifiedTable}`}
          </RadixDialog.Title>
          <RadixDialog.Description style={{ fontSize: 12, color: "var(--ink-3)" }}>
            Generate a `partman.create_parent(...)` call. The SQL opens in a new editor tab — review
            before running.
          </RadixDialog.Description>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <label style={fieldLabel}>
              <span>Control column</span>
              <select
                data-testid="pg-partman-create-parent-control-col"
                value={controlCol}
                onChange={(e) => setControlCol(e.target.value)}
              >
                {controlCandidates.length === 0 ? (                  <option value="">No timestamp/date/integer columns detected</option>
) : null}
                {controlCandidates.map((c) => (                  <option key={c.name} value={c.name}>
                    {c.name} ({c.typeName})
                  </option>
))}
              </select>
            </label>

            <div style={{ ...fieldLabel }}>
              <span>Partition interval</span>
              <IntervalInput
                idSuffix="pg-partman-interval"
                value={interval}
                onChange={setInterval}
              />
            </div>

            <label style={fieldLabel}>
              <span>Premake count</span>
              <input
                type="number"
                min="0"
                data-testid="pg-partman-create-parent-premake"
                value={premake}
                style={{ width: 80 }}
                onChange={(e) => {
                  const n = Number.parseInt(e.target.value, 10);
                  setPremake(Number.isFinite(n) && n >= 0 ? n : 0);
                }}
              />
            </label>

            <label style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "center" }}>
              <input
                type="checkbox"
                data-testid="pg-partman-create-parent-retention-toggle"
                checked={retentionEnabled}
                onChange={(e) => setRetentionEnabled(e.target.checked)}
              />
              <span>Enable retention</span>
            </label>

            {retentionEnabled ? (              <div style={{ ...fieldLabel }}>
                <span>Retention interval</span>
                <IntervalInput
                  idSuffix="pg-partman-retention"
                  value={retention}
                  onChange={setRetention}
                />
              </div>
) : null}

            <p style={{ fontSize: 11, color: "var(--ink-3)", margin: 0 }}>
              Retention is configured via direct UPDATE on partman.part_config — review the SQL
              before running.
            </p>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button
              type="button"
              className="btn btn-ghost"
              data-testid="pg-partman-create-parent-cancel"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              data-testid="pg-partman-create-parent-apply"
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
