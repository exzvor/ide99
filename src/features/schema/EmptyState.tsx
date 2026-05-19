import { AlertTriangle, Database } from "lucide-react";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";

/**
 * Right-sidebar empty / error state (quiet redesign).
 */

export interface EmptyStateAction {
  label: string;
  onClick: () => void;
}

export interface EmptyStateProps {
  kind: "idle" | "error";
  message?: string;
  onRetry?: () => void;
  /** Extra action — used for password-missing → "Open Edit", since plain
   * retry against an empty password loops forever. */
  primaryAction?: EmptyStateAction;
}

export function EmptyState({
  kind,
  message,
  onRetry,
  primaryAction,
}: EmptyStateProps): JSX.Element {
  const { t } = useTranslation();

  if (kind === "error") {
    return (      <div
        style={{
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
          padding: "0 24px",
          textAlign: "center",
        }}
        data-testid="schema-empty-error"
      >
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            background: "var(--danger-q-soft)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--danger-q)",
          }}
        >
          <AlertTriangle size={18} aria-hidden="true" data-testid="schema-empty-error-icon" />
        </div>
        <p style={{ fontSize: 12.5, color: "var(--danger-q)", maxWidth: 220, margin: 0 }}>
          {message}
        </p>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
          {primaryAction ? (            <button
              type="button"
              onClick={primaryAction.onClick}
              className="btn btn-sm btn-primary"
              data-testid="schema-empty-error-action"
            >
              {primaryAction.label}
            </button>
) : null}
          {onRetry ? (            <button type="button" onClick={onRetry} className="btn btn-sm">
              {t("schema.retry")}
            </button>
) : null}
        </div>
      </div>
);
  }

  return (    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        padding: "0 24px",
        textAlign: "center",
      }}
      data-testid="schema-empty-idle"
    >
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          background: "var(--bg-sunken)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--ink-4)",
        }}
      >
        <Database size={18} aria-hidden="true" data-testid="schema-empty-idle-icon" />
      </div>
      <h3 style={{ fontSize: 12.5, fontWeight: 500, color: "var(--ink-2)", margin: 0 }}>
        {t("schema.empty.title")}
      </h3>
      <p
        style={{
          fontSize: 11.5,
          lineHeight: 1.5,
          color: "var(--ink-4)",
          margin: 0,
          maxWidth: 200,
        }}
      >
        {t("schema.empty.body")}
      </p>
    </div>
);
}
