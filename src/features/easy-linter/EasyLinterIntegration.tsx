/**
 * — Easy linter ↔ Monaco glue.
 *
 * Hook that watches the editor text and writes Monaco markers under the
 * `easy-mistakes` owner. Active only in Easy mode (`useUiMode === "easy"`)
 * — in Standard mode the hook is a no-op AND any previously-set markers
 * are cleared so toggling modes doesn't leave stale underlines behind.
 */

import type { editor } from "monaco-editor";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useUiMode } from "../easy-mode/store";
import { lintSql } from "./lint";
import { type Locale, lintFindingsToMarkers } from "./lintMarkers";

const MARKER_OWNER = "easy-mistakes";
const DEBOUNCE_MS = 300;

function pickLocale(language: string): Locale {
  return language.toLowerCase().startsWith("ru") ? "ru" : "en";
}

interface MonacoNamespace {
  editor: {
    setModelMarkers(model: editor.ITextModel, owner: string, markers: editor.IMarkerData[]): void;
  };
}

/**
 * Subscribe an editor instance to easy-linter findings.
 *
 * @param ed       The mounted Monaco editor (null while booting).
 * @param monaco   The Monaco namespace returned by `onMount`.
 * @param sql      Current buffer text (re-runs on change, debounced).
 */
export function useEasyLinter(
  ed: editor.IStandaloneCodeEditor | null,
  monaco: MonacoNamespace | null,
  sql: string,
): void {
  const mode = useUiMode((s) => s.mode);
  const { i18n } = useTranslation();
  const locale = pickLocale(i18n.language ?? "en");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!ed || !monaco) return;
    const model = ed.getModel();
    if (!model) return;

    // Clear timer on unmount or dependency change.
    if (timerRef.current) clearTimeout(timerRef.current);

    if (mode !== "easy") {
      // Standard mode → wipe any markers we may have left behind.
      monaco.editor.setModelMarkers(model, MARKER_OWNER, []);
      return;
    }

    timerRef.current = setTimeout(() => {
      const findings = lintSql(sql);
      const markers = lintFindingsToMarkers(findings, locale);
      monaco.editor.setModelMarkers(model, MARKER_OWNER, markers);
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [ed, monaco, sql, mode, locale]);
}
