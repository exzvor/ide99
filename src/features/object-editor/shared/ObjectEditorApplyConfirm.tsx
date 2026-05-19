// production-aware Apply confirmation for object editors.
//
// Drop-in replacement for `ApplyConfirmModal` that checks the connection's
// `environment` and, when it's `"prod"`, renders `TypingConfirmModal` with
// a typed-confirmation gate keyed on the database name. Other environments
// keep the lighter `ApplyConfirmModal` UX.

import type { JSX } from "react";
import { useTranslation } from "react-i18next";

import { TypingConfirmModal } from "../../../components/TypingConfirmModal";
import { useConnections } from "../../connections/store";
import { ApplyConfirmModal } from "../../erd/edit/ApplyConfirmModal";

export interface ObjectEditorApplyConfirmProps {
  open: boolean;
  connId: string;
  statementCount: number;
  /** Full DDL preview shown above the typing input on prod. Skipped for
   * non-prod environments. */
  ddl: string;
  onConfirm(): void;
  onCancel(): void;
}

export function ObjectEditorApplyConfirm({
  open,
  connId,
  statementCount,
  ddl,
  onConfirm,
  onCancel,
}: ObjectEditorApplyConfirmProps): JSX.Element | null {
  const { t } = useTranslation();
  const conn = useConnections((s) => s.connections.find((c) => c.id === connId));
  const connectionName = conn?.name ?? connId;
  const databaseName = conn?.database ?? connectionName;
  const isProd = conn?.environment === "prod";

  if (!open) return null;

  if (isProd) {
    return (
      <TypingConfirmModal
        title={t("object_editor.actions.prod_confirm_title")}
        description={t("object_editor.actions.prod_confirm_body", {
          conn: connectionName,
          n: statementCount,
        })}
        expectedToken={databaseName}
        inputLabel={t("object_editor.actions.prod_confirm_input_label", { db: databaseName })}
        confirmLabel={t("object_editor.actions.apply")}
        cancelLabel={t("object_editor.actions.cancel")}
        dangerSqlPreview={ddl}
        onCancel={onCancel}
        onConfirm={() => onConfirm()}
      />
    );
  }

  return (
    <ApplyConfirmModal
      open={open}
      statementCount={statementCount}
      connectionName={connectionName}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
