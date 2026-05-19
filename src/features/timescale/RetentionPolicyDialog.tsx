// — owner: .
//
// Retention policy dialog. Same shape as `CompressionPolicyDialog` but
// simpler — only a `dropAfter` interval. Generates `add_retention_policy`
// or `remove_retention_policy` SQL into a Query Editor tab.
import * as RadixDialog from "@radix-ui/react-dialog";
import { type JSX, useEffect, useState } from "react";

import { useEditor } from "../editor/store";
import { parseIntervalLiteral } from "./CompressionPolicyDialog";
import { IntervalInput, type IntervalValue, intervalToSqlLiteral } from "./IntervalInput";
import { type RetentionPolicy, loadRetentionPolicy } from "./policyState";
import { buildRetentionPolicySql } from "./retentionPolicySql";

export interface RetentionPolicyDialogProps {
  open: boolean;
  connId: string;
  qualifiedTable: string;
  schema: string;
  table: string;
  onClose: () => void;
}

const fieldLabel: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  fontSize: 12,
  gap: 2,
};

export function RetentionPolicyDialog(props: RetentionPolicyDialogProps): JSX.Element | null {
  const { open, connId, qualifiedTable, schema, table, onClose } = props;

  const [loading, setLoading] = useState(true);
  const [existing, setExisting] = useState<RetentionPolicy | null>(null);
  const [dropAfter, setDropAfter] = useState<IntervalValue>({ count: 30, unit: "day" });

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    loadRetentionPolicy(connId, schema, table)
      .then((policy) => {
        if (cancelled) return;
        setExisting(policy);
        if (policy) {
          setDropAfter(parseIntervalLiteral(policy.dropAfter));
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
    const sql = buildRetentionPolicySql({
      qualifiedTable,
      dropAfter: intervalToSqlLiteral(dropAfter),
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
          data-testid="retention-policy-dialog"
          style={{ padding: 20, minWidth: 460, display: "flex", flexDirection: "column", gap: 12 }}
        >
          <RadixDialog.Title className="q-modal-title">
            {`Retention Policy: ${qualifiedTable}`}
          </RadixDialog.Title>
          <RadixDialog.Description style={{ fontSize: 12, color: "var(--ink-3)" }}>
            Drop chunks older than the configured threshold automatically.
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
                  {`Policy active: drop chunks older than ${existing.dropAfter}. Job ID ${existing.jobId}.`}
                </p>
              ) : null}

              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={fieldLabel}>
                  <span>Drop chunks older than</span>
                  <IntervalInput idSuffix="drop-after" value={dropAfter} onChange={setDropAfter} />
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button type="button" className="btn btn-ghost" onClick={onClose}>
                  Cancel
                </button>
                {existing ? (
                  <button
                    type="button"
                    className="btn btn-danger"
                    data-testid="retention-policy-dialog-drop"
                    onClick={() => emit("drop")}
                  >
                    Drop policy
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn btn-primary"
                  data-testid="retention-policy-dialog-apply"
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
