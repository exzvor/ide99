// — owner: .
//
// Dialog for compression policy management. Mounts → loads current policy
// from `timescaledb_information.jobs` (via `loadCompressionPolicy`). Once
// loaded, lets the user create or drop the policy. The generated SQL is
// always opened in a Query Editor tab — never auto-runs.
import * as RadixDialog from "@radix-ui/react-dialog";
import { type JSX, useEffect, useState } from "react";

import { useEditor } from "../editor/store";
import {
  IntervalInput,
  type IntervalUnit,
  type IntervalValue,
  intervalToSqlLiteral,
} from "./IntervalInput";
import { buildCompressionPolicySql } from "./compressionPolicySql";
import { type CompressionPolicy, loadCompressionPolicy } from "./policyState";

export interface CompressionPolicyDialogProps {
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

const KNOWN_UNITS: IntervalUnit[] = ["minute", "hour", "day", "week", "month"];

/**
 * Parse a Postgres-style interval literal like `"7 days"` into an
 * `IntervalValue`. Falls back to `{count: 7, unit: "day"}` if parsing fails.
 */
export function parseIntervalLiteral(literal: string): IntervalValue {
  const trimmed = literal.trim();
  const match = /^(\d+)\s+([a-z]+)/i.exec(trimmed);
  if (!match) return { count: 7, unit: "day" };
  const count = Number.parseInt(match[1] ?? "", 10);
  const word = (match[2] ?? "").toLowerCase().replace(/s$/, "") as IntervalUnit;
  if (!Number.isFinite(count) || count <= 0) return { count: 7, unit: "day" };
  if (!KNOWN_UNITS.includes(word)) return { count: 7, unit: "day" };
  return { count, unit: word };
}

export function CompressionPolicyDialog(props: CompressionPolicyDialogProps): JSX.Element | null {
  const { open, connId, qualifiedTable, schema, table, onClose } = props;

  const [loading, setLoading] = useState(true);
  const [existing, setExisting] = useState<CompressionPolicy | null>(null);
  const [segmentBy, setSegmentBy] = useState<string>("");
  const [orderBy, setOrderBy] = useState<string>("");
  const [compressAfter, setCompressAfter] = useState<IntervalValue>({
    count: 7,
    unit: "day",
  });

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    loadCompressionPolicy(connId, schema, table)
      .then((policy) => {
        if (cancelled) return;
        setExisting(policy);
        if (policy) {
          setCompressAfter(parseIntervalLiteral(policy.compressAfter));
        }
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setExisting(null);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, connId, schema, table]);

  if (!open) return null;

  const emit = (mode: "create" | "drop"): void => {
    const sql = buildCompressionPolicySql({
      qualifiedTable,
      segmentBy: segmentBy || undefined,
      orderBy: orderBy || undefined,
      compressAfter: intervalToSqlLiteral(compressAfter),
      mode,
    });
    useEditor.getState().openEditorTab(connId, { prefillSql: sql });
    onClose();
  };

  return (
    <RadixDialog.Root
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="q-backdrop" />
        <RadixDialog.Content
          className="q-modal md"
          data-testid="compression-policy-dialog"
          style={{ padding: 20, minWidth: 480, display: "flex", flexDirection: "column", gap: 12 }}
        >
          <RadixDialog.Title className="q-modal-title">
            {`Compression Policy: ${qualifiedTable}`}
          </RadixDialog.Title>
          <RadixDialog.Description style={{ fontSize: 12, color: "var(--ink-3)" }}>
            Manage TimescaleDB compression for older chunks of this hypertable.
          </RadixDialog.Description>

          {loading ? (
            <p style={{ fontSize: 12, color: "var(--ink-3)" }}>Loading current policy…</p>
          ) : (
            <>
              {existing ? (
                <p
                  style={{
                    fontSize: 12,
                    color: "var(--ink-2)",
                    padding: 8,
                    background: "var(--bg-2)",
                    borderRadius: 4,
                  }}
                >
                  {`Policy active: compress chunks older than ${existing.compressAfter}. Job ID ${existing.jobId}.`}
                </p>
              ) : null}

              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <label style={fieldLabel}>
                  <span>Segment by (column)</span>
                  <input
                    type="text"
                    data-testid="compression-policy-dialog-segmentby"
                    value={segmentBy}
                    onChange={(e) => setSegmentBy(e.target.value)}
                    placeholder="device_id"
                  />
                </label>
                <label style={fieldLabel}>
                  <span>Order by</span>
                  <input
                    type="text"
                    data-testid="compression-policy-dialog-orderby"
                    value={orderBy}
                    onChange={(e) => setOrderBy(e.target.value)}
                    placeholder="ts DESC"
                  />
                </label>
                <div style={fieldLabel}>
                  <span>Compress chunks older than</span>
                  <IntervalInput
                    idSuffix="compress-after"
                    value={compressAfter}
                    onChange={setCompressAfter}
                  />
                </div>
                <p style={{ fontSize: 11, color: "var(--ink-3)" }}>
                  Note: existing segmentby/orderby are not loaded from the policy config (they live
                  on the table options) — fill them in if you want to refresh those settings as part
                  of this apply.
                </p>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button type="button" className="btn btn-ghost" onClick={onClose}>
                  Cancel
                </button>
                {existing ? (
                  <button
                    type="button"
                    className="btn btn-danger"
                    data-testid="compression-policy-dialog-drop"
                    onClick={() => emit("drop")}
                  >
                    Drop policy
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn btn-primary"
                  data-testid="compression-policy-dialog-apply"
                  onClick={() => emit("create")}
                >
                  Apply
                </button>
              </div>
            </>
          )}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
