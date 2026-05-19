// — Radix Dialog that renders the cached partman config for a parent
// table and offers three action buttons that all emit SQL into a new editor
// tab (never auto-run):
//
// 1. Run Maintenance — SELECT partman.run_maintenance_proc()
// 2. Drop Partition Set (keep data) — SELECT partman.undo_partition(..., true)
// 3. Drop Partition Set (drop data) — SELECT partman.undo_partition(..., false)
//
// The "drop data" path uses a typing-confirm pattern (user re-types the
// qualified table name) before the destructive SQL is generated. The pattern
// is inlined here rather than reusing `<TypingConfirmModal/>` so the testids
// stay scoped to the partman feature (and to keep this dialog self-contained).
import * as RadixDialog from "@radix-ui/react-dialog";
import { type JSX, useState } from "react";

import { useEditor } from "../editor/store";
import { buildRunMaintenanceSql, buildUndoPartitionSql } from "./partmanMaintenanceSql";
import type { PartmanParent } from "./store";

export interface ConfigViewerDialogProps {
  open: boolean;
  connId: string;
  /** "schema.table" un-quoted text used both as the partman literal and as
   * the typing-confirm token. */
  qualifiedTable: string;
  partmanInfo: PartmanParent;
  onClose: () => void;
}

const dlStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "max-content 1fr",
  gap: "4px 12px",
  margin: 0,
  fontSize: 12,
};

const dtStyle: React.CSSProperties = {
  fontWeight: 600,
  color: "var(--ink-3)",
};

const ddStyle: React.CSSProperties = {
  margin: 0,
  fontFamily: "var(--font-mono-q)",
};

export function ConfigViewerDialog(props: ConfigViewerDialogProps): JSX.Element | null {
  const { open, connId, qualifiedTable, partmanInfo, onClose } = props;

  const [confirmDropOpen, setConfirmDropOpen] = useState(false);
  const [typedToken, setTypedToken] = useState("");

  if (!open) return null;

  const emit = (sql: string): void => {
    useEditor.getState().openEditorTab(connId, { prefillSql: sql });
    onClose();
  };

  const handleRunMaintenance = (): void => {
    emit(buildRunMaintenanceSql());
  };

  const handleDropKeepData = (): void => {
    emit(buildUndoPartitionSql({ parentTable: qualifiedTable, keepTable: true }));
  };

  const handleDropDropData = (): void => {
    setTypedToken("");
    setConfirmDropOpen(true);
  };

  const handleDropDropConfirm = (): void => {
    emit(buildUndoPartitionSql({ parentTable: qualifiedTable, keepTable: false }));
    setConfirmDropOpen(false);
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
          data-testid="pg-partman-config-viewer"
          style={{ padding: 20, minWidth: 480, display: "flex", flexDirection: "column", gap: 12 }}
        >
          <RadixDialog.Title className="q-modal-title">
            {`Partition Set Config: ${qualifiedTable}`}
          </RadixDialog.Title>
          <RadixDialog.Description style={{ fontSize: 12, color: "var(--ink-3)" }}>
            Read-only view of the partman configuration. Actions below open SQL in a new editor tab
            — review before running.
          </RadixDialog.Description>

          <dl style={dlStyle} data-testid="pg-partman-config-list">
            <dt style={dtStyle}>Control column</dt>
            <dd style={ddStyle}>{partmanInfo.controlColumn}</dd>
            <dt style={dtStyle}>Partition interval</dt>
            <dd style={ddStyle}>{partmanInfo.intervalText}</dd>
            <dt style={dtStyle}>Premake count</dt>
            <dd style={ddStyle}>{partmanInfo.premakeCount}</dd>
            <dt style={dtStyle}>Retention</dt>
            <dd style={ddStyle} data-testid="pg-partman-config-retention">
              {partmanInfo.retentionText ?? "—"}
            </dd>
          </dl>

          {confirmDropOpen ? (            <div
              data-testid="pg-partman-drop-drop-data-confirm-block"
              style={{
                marginTop: 4,
                padding: 10,
                border: "1px solid var(--hairline)",
                borderRadius: 6,
                background: "var(--bg-sunken)",
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              <p style={{ margin: 0, fontSize: 12, color: "var(--ink-2)" }}>
                {"This will drop all partition data for "}
                <code style={{ fontFamily: "var(--font-mono-q)" }}>{qualifiedTable}</code>
                {". Type the table name to confirm."}
              </p>
              <input
                type="text"
                data-testid="pg-partman-drop-drop-data-input"
                value={typedToken}
                onChange={(e) => setTypedToken(e.target.value)}
                placeholder={qualifiedTable}
                className="q-input mono"
                style={{ fontSize: 12 }}
              />
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => {
                    setConfirmDropOpen(false);
                    setTypedToken("");
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  data-testid="pg-partman-drop-drop-data-confirm"
                  disabled={typedToken.trim() !== qualifiedTable}
                  onClick={handleDropDropConfirm}
                >
                  Drop and lose data
                </button>
              </div>
            </div>
) : (            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <button
                type="button"
                className="btn"
                data-testid="pg-partman-run-maintenance"
                onClick={handleRunMaintenance}
              >
                Run Maintenance
              </button>
              <button
                type="button"
                className="btn"
                data-testid="pg-partman-drop-keep-data"
                onClick={handleDropKeepData}
              >
                Drop Partition Set (keep data)
              </button>
              <button
                type="button"
                className="btn btn-danger"
                data-testid="pg-partman-drop-drop-data"
                onClick={handleDropDropData}
              >
                Drop Partition Set (drop data)
              </button>
            </div>
)}

          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Close
            </button>
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
);
}
