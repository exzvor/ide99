// src/features/erd/edit/ApplyConfirmModal.tsx
import type { JSX } from "react";
import { useTranslation } from "react-i18next";

interface Props {
  open: boolean;
  statementCount: number;
  connectionName: string;
  onConfirm(): void;
  onCancel(): void;
}

export function ApplyConfirmModal({
  open,
  statementCount,
  connectionName,
  onConfirm,
  onCancel,
}: Props): JSX.Element | null {
  const { t } = useTranslation();
  if (!open) return null;
  return (
    <div
      data-testid="apply-confirm-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="apply-confirm-title"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <div
        style={{
          background: "var(--bg)",
          padding: 20,
          borderRadius: 6,
          minWidth: 380,
          maxWidth: 520,
        }}
      >
        <h2 id="apply-confirm-title" style={{ margin: 0, marginBottom: 8 }}>
          {t("erd.edit.confirm.apply.title")}
        </h2>
        <p style={{ marginBottom: 16, color: "var(--ink-3)" }}>
          {t("erd.edit.confirm.apply.body", { n: statementCount, conn: connectionName })}
        </p>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 12,
            justifyContent: "flex-end",
          }}
        >
          <button
            type="button"
            data-testid="apply-confirm-cancel"
            className="btn-icon"
            onClick={onCancel}
            style={{ minWidth: 96, padding: "0 14px", height: 30 }}
          >
            {t("erd.edit.cancel")}
          </button>
          <button
            type="button"
            data-testid="apply-confirm-ok"
            className="btn-icon"
            style={{
              minWidth: 96,
              padding: "0 14px",
              height: 30,
              background: "var(--accent, #4a90e2)",
              color: "#fff",
            }}
            onClick={onConfirm}
          >
            {t("erd.edit.apply")}
          </button>
        </div>
      </div>
    </div>
  );
}
