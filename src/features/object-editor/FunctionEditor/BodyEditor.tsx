// — FunctionEditor sub-component: body editor.
//
// TODO(B3->B4 integrate): replace <textarea> fallback with the shared Monaco
// wrapper once a reusable mount-point lands. The existing
// `src/features/editor/MonacoEditor.tsx` is bound to a tab/result-store so it
// can't be reused as a generic editable region. Spec §7 (B3.T1) accepts a
// textarea fallback in this scenario.
//
// On mount we still attempt to dynamic-import `./plpgsqlLanguage` (B4) and
// register it on Monaco if available; the textarea path simply ignores it.

import { type JSX, useEffect } from "react";
import { useTranslation } from "react-i18next";

import type { FunctionLanguage } from "../ddl/types";

export interface BodyEditorProps {
  value: string;
  onChange: (next: string) => void;
  language: FunctionLanguage;
  /** Visible name when language === "other". */
  languageOther?: string;
}

export function BodyEditor({
  value,
  onChange,
  language,
  languageOther,
}: BodyEditorProps): JSX.Element {
  const { t } = useTranslation();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // B4 ships ./plpgsqlLanguage. Attempt registration; swallow if missing
        // (sub-agent ordering — parallel; module may not exist yet).
        const mod = (await import("./plpgsqlLanguage").catch(() => null)) as {
          registerPlpgsqlLanguage?: (m: unknown) => void;
        } | null;
        if (cancelled || !mod || typeof mod.registerPlpgsqlLanguage !== "function") return;
        // Lazy-load monaco only when the wrapper actually wires it up later.
        // For now we have no live monaco instance to pass; this branch is a
        // forward-compatible no-op that exercises the import path.
      } catch {
        // best-effort
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const showOtherWarning =
    language === "other" && (languageOther === undefined || languageOther.trim() !== "plpgsql");

  return (    <div data-testid="fn-body-editor" style={{ display: "grid", gap: 6 }}>
      {showOtherWarning ? (        <div
          // biome-ignore lint/a11y/useSemanticElements: passive banner.
          role="status"
          data-testid="fn-body-language-warning"
          style={{
            padding: "6px 10px",
            background: "var(--accent-soft, rgba(212,155,28,0.12))",
            border: "1px solid var(--hairline)",
            borderRadius: 4,
            fontSize: 12,
            color: "var(--accent, #b08018)",
          }}
        >
          {t("object_editor.function.language_other_warning")}
        </div>
) : null}
      <textarea
        data-testid="fn-body-textarea"
        data-language={language === "other" ? "plaintext" : language}
        className="q-editor-rules"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        style={{
          width: "100%",
          height: 400,
          padding: "10px 12px",
          fontFamily: '"JetBrains Mono", ui-monospace, Menlo, monospace',
          fontSize: 12,
          whiteSpace: "pre",
        }}
      />
    </div>
);
}
