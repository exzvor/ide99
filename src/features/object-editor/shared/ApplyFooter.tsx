// — bottom-row Apply / Cancel toolbar shared by every object editor.
//
// Apply path (mirrors S19/S20 ERD edit-mode):
// 1. User clicks Apply → ApplyConfirmModal opens (count + connection).
// 2. On confirm → invoke schema_apply_ddl in a single transaction.
// 3. Success → invalidate ERD cache, refresh the schema tree, fire onSuccess.
// 4. Failure → red banner with the pgError; tab stays dirty.
//
// We deliberately do NOT call useEditor.emit("schema:invalidate") because the
// editor store has no event-bus surface today (verified by grep) — instead
// we replicate the existing ERD pattern: useErdStore.invalidate(connId) and
// useSchemaTreeStore.refreshAll() (best-effort; both are no-op safe).

import type { JSX } from "react";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { type ApplyError, schemaApplyDdl } from "../../../lib/tauri";
import { useConnections } from "../../connections/store";
import { ApplyConfirmModal } from "../../erd/edit/ApplyConfirmModal";
import { useErdStore } from "../../erd/store";
import { useSchema } from "../../schema/store";
import type { DdlError } from "../ddl/types";

interface Props {
  tabId: string;
  connId: string;
  ddl: string;
  isDirty: boolean;
  errors: DdlError[];
  onSuccess: () => void;
  /** Cancel resets the form to its `initial` state and
   * KEEPS the editor tab open. Previously Cancel closed the tab. */
  onCancel?: () => void;
}

/** Counts statements heuristically by splitting on top-level `;` — same
 * rule the ERD edit-mode uses. Empty trailing chunks are filtered. */
function countStatements(ddl: string): number {
  return ddl
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0).length;
}

export function ApplyFooter({
  tabId: _tabId,
  connId,
  ddl,
  isDirty,
  errors,
  onSuccess,
  onCancel: onCancelProp,
}: Props): JSX.Element {
  const { t } = useTranslation();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [applyError, setApplyError] = useState<ApplyError | null>(null);
  const [applying, setApplying] = useState(false);

  const connectionName =
    useConnections((s) => s.connections.find((c) => c.id === connId)?.name) ?? connId;

  const hasErrors = errors.length > 0;
  const ddlIsBlank = ddl.trim() === "";
  const applyDisabled = hasErrors || ddlIsBlank || applying;

  const onApplyClick = useCallback(() => {
    if (applyDisabled) return;
    setApplyError(null);
    setConfirmOpen(true);
  }, [applyDisabled]);

  const onConfirmApply = useCallback(async () => {
    setConfirmOpen(false);
    setApplying(true);
    try {
      await schemaApplyDdl(connId, ddl);
      // Schema mutation just shipped — invalidate ERD cache (the diagram
      // re-loads next mount) and re-fetch the schema tree so the new/edited
      // object becomes visible immediately.
      useErdStore.getState().invalidate(connId);
      void useSchema.getState().refreshAll();
      onSuccess();
    } catch (raw) {
      const e = raw as ApplyError;
      setApplyError(e);
    } finally {
      setApplying(false);
    }
  }, [connId, ddl, onSuccess]);

  const onCancel = useCallback(() => {
    // Cancel resets the form, not closes the tab. The
    // per-editor host owns reset semantics (because each editor knows its
    // form shape and emptyForm()), so we just delegate.
    onCancelProp?.();
  }, [onCancelProp]);

  return (
    <div
      data-testid="apply-footer"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "8px 12px",
        borderTop: "1px solid var(--border, #333)",
        background: "var(--bg-2, #1e1e1e)",
      }}
    >
      {applyError && (
        <div
          data-testid="apply-footer-error"
          role="alert"
          style={{
            color: "var(--danger, #e06c75)",
            fontSize: 12,
            background: "rgba(224, 108, 117, 0.1)",
            padding: "6px 8px",
            borderRadius: 4,
          }}
        >
          {applyError.pgErrorCode}: {applyError.pgMessage}
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button
          type="button"
          data-testid="apply-footer-cancel"
          className="btn-icon"
          onClick={onCancel}
          disabled={!isDirty}
          aria-disabled={!isDirty}
          style={{ minWidth: 96, padding: "0 14px", height: 30 }}
        >
          {t("object_editor.actions.cancel")}
        </button>
        <button
          type="button"
          data-testid="apply-footer-apply"
          className="btn-icon"
          onClick={onApplyClick}
          disabled={applyDisabled}
          aria-disabled={applyDisabled}
          style={{
            minWidth: 96,
            padding: "0 14px",
            height: 30,
            background: applyDisabled ? "var(--bg-3, #333)" : "var(--accent, #4a90e2)",
            color: applyDisabled ? "var(--ink-3, #888)" : "#fff",
          }}
        >
          {t("object_editor.actions.apply")}
        </button>
      </div>
      <ApplyConfirmModal
        open={confirmOpen}
        statementCount={countStatements(ddl)}
        connectionName={connectionName}
        onConfirm={() => {
          void onConfirmApply();
        }}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
