/**
 * Monaco wrapper for SQL cells in the notebook.
 *
 * The main `MonacoEditor.tsx` is too tightly coupled to the editor-tab
 * store (it pulls `tab.content` by `tabId` and registers a whole set of
 * commands for the current tab). That contract does not fit notebook
 * cells: each cell is a self-contained piece of SQL tied to a cellId and
 * has its own run/explain commands. So this file is a minimal wrapper:
 * PG highlighting, theme (inherited from `<html data-theme>`),
 * Cmd/Ctrl-Enter → onRun, everything else default.
 *
 * Keep the fonts and toolbar styling of the main editor so cells look
 * visually identical to regular tabs.
 */
import { Editor, type Monaco, type OnMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { LanguageIdEnum, setupLanguageFeatures } from "monaco-sql-languages";
import { type JSX, useEffect, useRef, useState } from "react";

import {
  type QuietThemeId,
  readResolvedQuietTheme,
  registerQuietThemes,
} from "../editor/monacoQuietTheme";

let pgLanguageRegistered = false;

function registerPgLanguage(): void {
  if (pgLanguageRegistered) return;
  pgLanguageRegistered = true;
  try {
    setupLanguageFeatures(LanguageIdEnum.PG, {
      completionItems: true,
      diagnostics: false,
      definitions: false,
      references: false,
      hover: true,
    });
  } catch {
    // Ignore — covered by the main editor's registration in the prod path.
  }
}

interface NotebookSqlEditorProps {
  cellId: string;
  value: string;
  onChange: (next: string) => void;
  onRun?: () => void;
  /** Approximate desired height in px. Falls back to a 6-line default. */
  height?: number;
  readOnly?: boolean;
}

export function NotebookSqlEditor({
  cellId,
  value,
  onChange,
  onRun,
  height,
  readOnly,
}: NotebookSqlEditorProps): JSX.Element {
  const [theme, setTheme] = useState<QuietThemeId>(() => readResolvedQuietTheme());
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const onRunRef = useRef(onRun);
  useEffect(() => {
    onRunRef.current = onRun;
  }, [onRun]);

  // Mirror MonacoEditor.tsx — observe <html data-theme> changes.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const observer = new MutationObserver(() => setTheme(readResolvedQuietTheme()));
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  const onMount: OnMount = (mountedEditor, monaco: Monaco) => {
    editorRef.current = mountedEditor;
    monaco.editor.setTheme(readResolvedQuietTheme());
    registerQuietThemes(monaco);
    registerPgLanguage();

    mountedEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      onRunRef.current?.();
    });
  };

  const computedHeight = height ?? 132; // ~6 lines @ 22px line-height + padding

  return (
    <div
      data-testid={`notebook-sql-editor-${cellId}`}
      className="q-editor-rules"
      style={
        // Notebook SQL cells use lineHeight 22 + padding.top 6 (vs the main
        // editor's 22 + 10). Pin the rules vars to those numbers so each
        // line of code lines up with one stripe.
        {
          height: computedHeight,
          width: "100%",
          ["--editor-line-h" as string]: "22px",
          ["--editor-pad-top" as string]: "6px",
        }
      }
    >
      <Editor
        value={value}
        language={LanguageIdEnum.PG}
        theme={theme}
        onMount={onMount}
        onChange={(v) => onChange(v ?? "")}
        options={{
          minimap: { enabled: false },
          fontSize: 13,
          lineHeight: 22,
          fontFamily: '"JetBrains Mono", "SF Mono", ui-monospace, Menlo, monospace',
          fontLigatures: false,
          wordWrap: "on",
          lineNumbers: "on",
          lineNumbersMinChars: 3,
          lineDecorationsWidth: 8,
          padding: { top: 6, bottom: 6 },
          glyphMargin: false,
          folding: false,
          renderLineHighlight: "line",
          scrollBeyondLastLine: false,
          automaticLayout: true,
          overviewRulerLanes: 0,
          hideCursorInOverviewRuler: true,
          overviewRulerBorder: false,
          readOnly: readOnly ?? false,
        }}
      />
    </div>
  );
}
