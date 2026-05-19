// — sticky right-side DDL preview pane shared by every object
// editor. Pure presentational component — owners pass in a `DdlResult`
// produced by their per-kind generator.

import type { JSX } from "react";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import type { DdlResult } from "../ddl/types";

interface Props {
  result: DdlResult;
  onApply: () => void;
  onCopy?: () => void;
}

const COPIED_VISIBLE_MS = 1500;

export function DdlPreviewPanel({ result, onApply, onCopy }: Props): JSX.Element {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const isEmpty = result.sql.trim() === "";
  const hasErrors = result.errors.length > 0;
  const applyDisabled = hasErrors || isEmpty;

  const handleCopy = useCallback(() => {
    if (isEmpty) return;
    void navigator.clipboard.writeText(result.sql);
    setCopied(true);
    window.setTimeout(() => setCopied(false), COPIED_VISIBLE_MS);
    onCopy?.();
  }, [isEmpty, result.sql, onCopy]);

  return (    <section
      aria-label="DDL preview"
      data-testid="ddl-preview-panel"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minWidth: 320,
        background: "var(--bg-2, #1e1e1e)",
        borderLeft: "1px solid var(--border, #333)",
        padding: 12,
        gap: 8,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <strong style={{ fontSize: 13 }}>SQL</strong>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {copied && (            <output
              data-testid="ddl-preview-copied"
              aria-live="polite"
              style={{ fontSize: 12, color: "var(--ink-3, #888)" }}
            >
              Copied!
            </output>
)}
          <button
            type="button"
            data-testid="ddl-preview-copy"
            className="btn-icon"
            onClick={handleCopy}
            disabled={isEmpty}
            aria-disabled={isEmpty}
            style={{ height: 24, padding: "0 8px", fontSize: 12 }}
          >
            Copy
          </button>
        </div>
      </div>

      <pre
        data-testid="ddl-preview-sql"
        style={{
          flex: 1,
          minHeight: 0,
          margin: 0,
          padding: 8,
          fontFamily: "var(--mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
          fontSize: 12,
          background: "var(--bg-3, #252525)",
          border: "1px solid var(--border, #333)",
          borderRadius: 4,
          whiteSpace: "pre-wrap",
          overflowX: "auto",
          overflowY: "auto",
          color: isEmpty ? "var(--ink-3, #888)" : "var(--ink, #ddd)",
        }}
      >
        {isEmpty ? t("object_editor.actions.no_changes") : result.sql}
      </pre>

      {result.warnings.length > 0 && (        <ul
          data-testid="ddl-preview-warnings"
          style={{
            margin: 0,
            padding: "6px 12px",
            listStyle: "disc",
            color: "var(--warn, #d4a017)",
            fontSize: 12,
          }}
        >
          {result.warnings.map((w) => (            <li key={`${w.code}:${w.message}`}>
              {t(`object_editor.warnings.${w.code}`, { defaultValue: w.message })}
            </li>
))}
        </ul>
)}

      {result.errors.length > 0 && (        <ul
          data-testid="ddl-preview-errors"
          style={{
            margin: 0,
            padding: "6px 12px",
            listStyle: "disc",
            color: "var(--danger, #e06c75)",
            fontSize: 12,
          }}
        >
          {result.errors.map((e) => (            <li key={`${e.code}:${e.message}`}>
              {t(`object_editor.errors.${e.code}`, { defaultValue: e.message })}
            </li>
))}
        </ul>
)}

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          type="button"
          data-testid="ddl-preview-apply"
          className="btn-icon"
          onClick={onApply}
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
    </section>
);
}
