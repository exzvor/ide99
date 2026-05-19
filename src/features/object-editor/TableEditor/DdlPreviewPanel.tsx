// — Local minimal DDL preview + Apply footer.
// TODO(B3->B4 integrate): swap to `shared/DdlPreviewPanel.tsx` + `ApplyFooter.tsx` once B4 lands.

import type { JSX } from "react";
import { useTranslation } from "react-i18next";

import type { DdlResult } from "../ddl/types";

export interface DdlPreviewPanelProps {
  result: DdlResult;
  onApply: () => void;
  onCancel: () => void;
  /** Apply button enabled flag (validation + non-empty SQL). */
  canApply: boolean;
  /** Optional inline error/warning banner (e.g. backend Apply failure). */
  banner?: { kind: "error" | "info"; message: string } | null;
  /**
   * Whether to surface required-field validation errors. Defaults to true
   * so existing call sites + tests are unchanged. Editors that wire the
   * `useTouched` hook pass `false` until the user starts interacting,
   * which avoids the "Name is required / Body is required" scream on a
   * freshly-opened blank form.
   */
  showErrors?: boolean;
}

export function DdlPreviewPanel({
  result,
  onApply,
  onCancel,
  canApply,
  banner,
  showErrors = true,
}: DdlPreviewPanelProps): JSX.Element {
  const { t } = useTranslation();
  const sql = result.sql.trim().length > 0 ? result.sql : t("object_editor.actions.no_changes");
  return (
    <div
      data-testid="object-editor-ddl-preview"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        borderLeft: "1px solid var(--hairline)",
        background: "var(--bg-1, var(--bg))",
      }}
    >
      <div
        style={{
          padding: "8px 12px",
          fontSize: 12,
          fontWeight: 600,
          borderBottom: "1px solid var(--hairline)",
        }}
      >
        {t("object_editor.common.ddl_preview")}
      </div>
      <pre
        data-testid="object-editor-ddl-preview-sql"
        style={{
          margin: 0,
          padding: 12,
          flex: 1,
          overflow: "auto",
          fontFamily: '"JetBrains Mono", ui-monospace, Menlo, monospace',
          fontSize: 12,
          lineHeight: 1.5,
          whiteSpace: "pre-wrap",
        }}
      >
        {sql}
      </pre>
      {result.warnings.length > 0 ? (
        <ul
          data-testid="object-editor-ddl-warnings"
          style={{
            listStyle: "none",
            margin: 0,
            padding: "6px 12px",
            background: "var(--accent-soft, rgba(212,155,28,0.08))",
            borderTop: "1px solid var(--hairline)",
            fontSize: 12,
          }}
        >
          {result.warnings.map((w) => (
            <li key={w.code}>{w.message}</li>
          ))}
        </ul>
      ) : null}
      {showErrors && result.errors.length > 0 ? (
        <ul
          data-testid="object-editor-ddl-errors"
          style={{
            listStyle: "none",
            margin: 0,
            padding: "6px 12px",
            background: "var(--danger-soft, rgba(255,80,80,0.08))",
            borderTop: "1px solid var(--hairline)",
            color: "var(--danger, #c0392b)",
            fontSize: 12,
          }}
        >
          {result.errors.map((e) => (
            <li key={e.code}>{e.message}</li>
          ))}
        </ul>
      ) : null}
      {banner ? (
        <div
          // biome-ignore lint/a11y/useSemanticElements: passive banner; not a form <output>.
          role="status"
          data-testid="object-editor-banner"
          data-banner-kind={banner.kind}
          style={{
            padding: "6px 12px",
            background:
              banner.kind === "error"
                ? "var(--danger-soft, rgba(255,80,80,0.08))"
                : "var(--accent-soft, rgba(80,160,255,0.08))",
            borderTop: "1px solid var(--hairline)",
            fontSize: 12,
          }}
        >
          {banner.message}
        </div>
      ) : null}
      <div
        style={{
          padding: 12,
          borderTop: "1px solid var(--hairline)",
          display: "flex",
          gap: 8,
          justifyContent: "flex-end",
        }}
      >
        <button
          type="button"
          data-testid="object-editor-cancel"
          onClick={onCancel}
          className="btn-icon"
          style={{ minWidth: 80, padding: "0 14px", height: 28 }}
        >
          {t("object_editor.actions.cancel")}
        </button>
        <button
          type="button"
          data-testid="object-editor-apply"
          onClick={onApply}
          disabled={!canApply}
          className="btn-icon"
          style={{
            minWidth: 80,
            padding: "0 14px",
            height: 28,
            background: canApply ? "var(--accent, #4a90e2)" : undefined,
            color: canApply ? "#fff" : undefined,
            opacity: canApply ? 1 : 0.5,
          }}
        >
          {t("object_editor.actions.apply")}
        </button>
      </div>
    </div>
  );
}
