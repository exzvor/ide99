// — owner: .
//
// Continuous-aggregate refresh policy dialog. Three intervals:
// `start_offset`, `end_offset`, and `schedule_interval`. Reads current
// policy state from `timescaledb_information.jobs` via `loadRefreshPolicy`.
import * as RadixDialog from "@radix-ui/react-dialog";
import { type JSX, useEffect, useState } from "react";

import { useEditor } from "../editor/store";
import { parseIntervalLiteral } from "./CompressionPolicyDialog";
import { IntervalInput, type IntervalValue, intervalToSqlLiteral } from "./IntervalInput";
import { type RefreshPolicy, loadRefreshPolicy } from "./policyState";
import { buildRefreshPolicySql } from "./refreshPolicySql";

export interface RefreshPolicyDialogProps {
  open: boolean;
  connId: string;
  qualifiedView: string;
  schema: string;
  view: string;
  onClose: () => void;
}

const fieldLabel: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  fontSize: 12,
  gap: 2,
};

export function RefreshPolicyDialog(props: RefreshPolicyDialogProps): JSX.Element | null {
  const { open, connId, qualifiedView, schema, view, onClose } = props;

  const [loading, setLoading] = useState(true);
  const [existing, setExisting] = useState<RefreshPolicy | null>(null);
  const [startOffset, setStartOffset] = useState<IntervalValue>({ count: 30, unit: "day" });
  const [endOffset, setEndOffset] = useState<IntervalValue>({ count: 1, unit: "hour" });
  const [scheduleInterval, setScheduleInterval] = useState<IntervalValue>({
    count: 1,
    unit: "hour",
  });

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    loadRefreshPolicy(connId, schema, view)
      .then((policy) => {
        if (cancelled) return;
        setExisting(policy);
        if (policy) {
          setStartOffset(parseIntervalLiteral(policy.startOffset));
          setEndOffset(parseIntervalLiteral(policy.endOffset));
          setScheduleInterval(parseIntervalLiteral(policy.scheduleInterval));
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
  }, [open, connId, schema, view]);

  if (!open) return null;

  const emit = (mode: "create" | "drop"): void => {
    const sql = buildRefreshPolicySql({
      qualifiedView,
      startOffset: intervalToSqlLiteral(startOffset),
      endOffset: intervalToSqlLiteral(endOffset),
      scheduleInterval: intervalToSqlLiteral(scheduleInterval),
      mode,
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
          data-testid="refresh-policy-dialog"
          style={{ padding: 20, minWidth: 480, display: "flex", flexDirection: "column", gap: 12 }}
        >
          <RadixDialog.Title className="q-modal-title">
            {`Refresh Policy: ${qualifiedView}`}
          </RadixDialog.Title>
          <RadixDialog.Description style={{ fontSize: 12, color: "var(--ink-3)" }}>
            Schedule incremental refresh for this continuous aggregate.
          </RadixDialog.Description>

          {loading ? (            <p style={{ fontSize: 12, color: "var(--ink-3)" }}>Loading current policy…</p>
) : (            <>
              {existing ? (                <p
                  style={{
                    fontSize: 12,
                    color: "var(--ink-2)",
                    padding: 8,
                    background: "var(--bg-2)",
                    borderRadius: 4,
                  }}
                >
                  {`Policy active: refresh window [${existing.startOffset}, ${existing.endOffset}] every ${existing.scheduleInterval}. Job ID ${existing.jobId}.`}
                </p>
) : null}

              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={fieldLabel}>
                  <span>Start offset (refresh window starts this far in the past)</span>
                  <IntervalInput
                    idSuffix="start-offset"
                    value={startOffset}
                    onChange={setStartOffset}
                  />
                </div>
                <div style={fieldLabel}>
                  <span>End offset (refresh window ends this far in the past)</span>
                  <IntervalInput idSuffix="end-offset" value={endOffset} onChange={setEndOffset} />
                </div>
                <div style={fieldLabel}>
                  <span>Schedule interval</span>
                  <IntervalInput
                    idSuffix="schedule-interval"
                    value={scheduleInterval}
                    onChange={setScheduleInterval}
                  />
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button type="button" className="btn btn-ghost" onClick={onClose}>
                  Cancel
                </button>
                {existing ? (                  <button
                    type="button"
                    className="btn btn-danger"
                    data-testid="refresh-policy-dialog-drop"
                    onClick={() => emit("drop")}
                  >
                    Drop policy
                  </button>
) : null}
                <button
                  type="button"
                  className="btn btn-primary"
                  data-testid="refresh-policy-dialog-apply"
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
