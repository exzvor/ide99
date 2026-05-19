import { type BeforeMount, Editor } from "@monaco-editor/react";
import { type JSX, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type QuietThemeId,
  readResolvedQuietTheme,
  registerQuietThemes,
} from "../../editor/monacoQuietTheme";

export interface TextViewProps {
  value: string;
  onChange: (next: string) => void;
  readOnly: boolean;
  /** Set when the parent's parse of `value` failed. */
  parseError: string | null;
}

/** JSON text-mode view for the JSONB modal. Wraps `@monaco-editor/react`
 * with `language="json"` and pretty-prints on mount.
 *
 * Theme: shares `quiet-light` / `quiet-dark` with the main SQL editor
 * via `monacoQuietTheme.ts`. Monaco's `editor.setTheme` is GLOBAL to the
 * runtime, so embedding two editors with different theme names (e.g. the
 * built-in `vs` here and `quiet-dark` in `MonacoEditor.tsx`) flips the
 * other editor's appearance whenever one of the two mounts. The shared
 * registration keeps both honest.
 *
 * The parent owns parse-error state — when set we render a `role="alert"`
 * banner above the editor. Pure: driven by props, no store reads. */
export function TextView({ value, onChange, readOnly, parseError }: TextViewProps): JSX.Element {
  const { t } = useTranslation();
  const [theme, setTheme] = useState<QuietThemeId>(() => readResolvedQuietTheme());

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return;
    const target = document.documentElement;
    const observer = new MutationObserver(() => {
      setTheme(readResolvedQuietTheme());
    });
    observer.observe(target, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  const beforeMount: BeforeMount = (monaco) => {
    // Idempotent: matches the registration in MonacoEditor.tsx (same
    // shared module). Without this the modal could mount before the SQL
    // editor ever did, and Monaco would have neither theme registered —
    // it would silently fall back to "vs" (the built-in light theme).
    registerQuietThemes(monaco);
  };

  const pretty = useMemo(() => {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }, [value]);

  return (    <div
      data-testid="jsonb-text-view"
      style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}
    >
      {parseError ? (        <div
          role="alert"
          data-testid="jsonb-text-parse-error"
          style={{
            padding: "8px 12px",
            background: "var(--accent-soft-danger, rgba(239,68,68,0.1))",
            color: "var(--ink-2)",
            borderBottom: "1px solid var(--hairline)",
            fontSize: 12,
            fontFamily: "var(--font-sans-q, sans-serif)",
          }}
        >
          {t("jsonb.text.invalidJson", { message: parseError })}
        </div>
) : null}
      <div style={{ flex: 1, minHeight: 0 }}>
        <Editor
          value={pretty}
          language="json"
          theme={theme}
          beforeMount={beforeMount}
          onChange={(v) => onChange(v ?? "")}
          options={{
            readOnly,
            automaticLayout: true,
            minimap: { enabled: false },
            fontSize: 13,
            fontFamily: '"JetBrains Mono", "SF Mono", ui-monospace, Menlo, monospace',
            wordWrap: "on",
            scrollBeyondLastLine: false,
            renderLineHighlight: "line",
          }}
        />
      </div>
    </div>
);
}
