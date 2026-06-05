import { type BeforeMount, Editor, type Monaco, type OnMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { LanguageIdEnum, setupLanguageFeatures } from "monaco-sql-languages";
import { type JSX, useEffect, useRef, useState } from "react";
import { useDebouncedCallback } from "../../hooks/useDebouncedCallback";
import { parseSelect } from "../../lib/parser";
import { useEasyLinter } from "../easy-linter";
import { normalizeSql } from "../erd/edit/normalizeSql";
import { registerAutocomplete } from "./autocomplete";
import { bindFormatOnSave, bindFormatShortcut } from "./format/formatOnSave";
import { type QuietThemeId, readResolvedQuietTheme, registerQuietThemes } from "./monacoQuietTheme";
import { regenerateSelect } from "./queryShape/regenerate";
import { splitStatements, statementAtCursor } from "./sql/splitStatements";
import { setActiveMonacoEditor } from "./store";
import { useEditor } from "./store";

/**
 * Monaco editor wrapper for SQL editor.
 *
 * - Uses `<Editor>` from `@monaco-editor/react` (named import; the package
 * default export is a memoized wrapper but named imports give us better
 * TypeScript ergonomics in tests).
 * - Theme follows the resolved theme on `<html data-theme>`. We watch the
 * attribute via a `MutationObserver` rather than coupling to `useTheme()`
 * directly so this component doesn't need its own React state for the
 * theme — the observer flips Monaco's theme prop in place.
 * - PG SQL language registration uses `monaco-sql-languages` v1's
 * `setupLanguageFeatures(LanguageIdEnum.PG, ...)`. The library's static
 * side-effect registers the "pgsql" language with Monaco; we just enable
 * feature providers. A module-level `registered` flag keeps it idempotent
 * across remounts (mount → unmount → mount in the same session).
 * - Keybindings:
 * Cmd/Ctrl+Enter         → run selection if any, else run whole tab
 * Cmd/Ctrl+Shift+Enter   → run selection only; toast warning if none
 * - Error markers: when the run state is `error` with a line/col, set
 * model markers under the "pg-error" owner. On running/success/idle
 * the markers are cleared.
 */

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
    // The library throws if Monaco isn't loaded yet — that path doesn't
    // happen in production (Editor's onMount runs after Monaco init), but
    // tests stub Monaco out and shouldn't crash here.
  }
}

interface MonacoEditorProps {
  tabId: string;
}

export function MonacoEditor({ tabId }: MonacoEditorProps): JSX.Element {
  const tab = useEditor((s) => s.tabs.find((entry) => entry.id === tabId));
  const runState = useEditor((s) => s.runStates.get(tabId));
  // S20 — bidirectional SELECT wiring
  const queryShape = useEditor((s) => s.queryShapes.get(tabId) ?? null);
  const applyShapeFromAst = useEditor((s) => s.applyShapeFromAst);
  const setContent = useEditor((s) => s.setContent);
  // Last text the forward effect wrote, so we don't loop when reverse re-parses
  // the very text we just generated.
  const lastForwardWriteRef = useRef<string | null>(null);

  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);

  const [monacoTheme, setMonacoTheme] = useState<QuietThemeId>(() => readResolvedQuietTheme());

  // Track theme changes by observing `<html data-theme>` mutations. We don't
  // hook into `useTheme()` because that hook owns its own React state and we
  // only need the resolved value here.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const apply = () => {
      const next = readResolvedQuietTheme();
      setMonacoTheme(next);
      // Force Monaco to repaint with the new theme even if React batching
      // delays the prop flush.
      monacoRef.current?.editor.setTheme(next);
    };
    apply();
    const target = document.documentElement;
    const observer = new MutationObserver(apply);
    observer.observe(target, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  // Re-register the quiet themes on every render so HMR-edited rules
  // (token colors, ALPHA backgrounds) take effect immediately on Vite hot
  // reloads — without this, the active Monaco instance keeps the rules from
  // the FIRST mount.
  useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco) return;
    registerQuietThemes(monaco);
    monaco.editor.setTheme(readResolvedQuietTheme());
  });

  // S20 reverse direction: text → AST → queryShape. Debounced 200 ms.
  // Also writes a typed parse-error into the store so ResultPanel can render
  // a status banner (fix).
  const parseAndApply = useDebouncedCallback((textInput: unknown) => {
    void (async () => {
      const text = textInput as string;
      // defensive guard: don't ping the parser on empty / whitespace
      // text. After connect, the schema/store opens an empty editor tab; the
      // post-connect hydration cycle would otherwise spam parser_parse_select
      // with empty strings, and any unhandled error path here would unmount
      // the entire workspace.
      if (text.trim().length === 0) {
        const monaco = monacoRef.current;
        const model = editorRef.current?.getModel();
        if (monaco && model) {
          monaco.editor.setModelMarkers(model, "select-parser", []);
        }
        useEditor.getState().setSelectParseError(tabId, null);
        return;
      }
      // Skip if this text is what the forward effect just wrote — the shape
      // is already canonical for it.
      if (lastForwardWriteRef.current !== null && lastForwardWriteRef.current === text) {
        lastForwardWriteRef.current = null;
        return;
      }
      const monaco = monacoRef.current;
      const ed = editorRef.current;
      const model = ed?.getModel();
      const result = await parseSelect(text);
      if (!result.ok) {
        useEditor.getState().setSelectParseError(tabId, result.error);
        if (monaco && model) {
          monaco.editor.setModelMarkers(model, "select-parser", [
            {
              severity: monaco.MarkerSeverity.Error,
              message: result.error.message,
              startLineNumber: result.error.line,
              startColumn: result.error.column,
              endLineNumber: result.error.line,
              endColumn: result.error.column + 1,
            },
          ]);
        }
        return;
      }
      useEditor.getState().setSelectParseError(tabId, null);
      if (monaco && model) {
        monaco.editor.setModelMarkers(model, "select-parser", []);
      }
      applyShapeFromAst(tabId, result.value, []);
    })();
  }, 200);

  // Gate the reverse-parse on `tab.content` (a string) instead of the entire
  // `tab` object — every cursor move also produces a new `tab` reference and
  // would otherwise re-fire parseSelect on every single keystroke / cursor
  // event. (contributing factor.)
  const tabContentForParse = tab && tab.kind === "editor" ? tab.content : null;
  useEffect(() => {
    if (tabContentForParse === null) return;
    parseAndApply(tabContentForParse as unknown);
  }, [tabContentForParse, parseAndApply]);

  // S20 forward direction: queryShape filters / sort / limit change → regenerate
  // SELECT text and write it back. Idempotent guard prevents the user's caret
  // from being clobbered when the shape change came FROM the user typing.
  // Depends on `tabContentForParse` (the string) rather than the full `tab`
  // object so cursor moves don't re-fire the regenerator.
  useEffect(() => {
    if (tabContentForParse === null) return;
    if (!queryShape) return;
    if (queryShape.unrepresentableTail) return;
    const next = regenerateSelect(tabContentForParse, queryShape);
    if (normalizeSql(next) === normalizeSql(tabContentForParse)) return;
    lastForwardWriteRef.current = next;
    setContent(tabId, next);
    // Mirror the new value into Monaco directly so the editor visually updates
    // even if React's reconciliation is delayed.
    editorRef.current?.setValue(next);
  }, [queryShape, tabContentForParse, setContent, tabId]);

  // S33 — Easy-mode common-mistakes linter. No-op outside Easy mode.
  useEasyLinter(editorRef.current, monacoRef.current, tabContentForParse ?? "");

  // When run state flips to error, paint a marker; otherwise clear them.
  useEffect(() => {
    const monaco = monacoRef.current;
    const ed = editorRef.current;
    if (!monaco || !ed) return;
    const model = ed.getModel();
    if (!model) return;

    if (runState && runState.status === "error" && runState.line && runState.col) {
      // detail is the raw PG message; fall back to the code if absent.
      const message = runState.detail ?? runState.code;
      monaco.editor.setModelMarkers(model, "pg-error", [
        {
          severity: monaco.MarkerSeverity.Error,
          message,
          startLineNumber: runState.line,
          startColumn: runState.col,
          endLineNumber: runState.line,
          endColumn: runState.col + 1,
        },
      ]);
    } else {
      monaco.editor.setModelMarkers(model, "pg-error", []);
    }
  }, [runState]);

  if (!tab || tab.kind !== "editor") {
    return <div data-testid="monaco-editor-empty" />;
  }

  const beforeMount: BeforeMount = (monaco) => {
    // Register the quiet themes BEFORE the editor mounts so the initial
    // `theme` prop ("quiet-light" / "quiet-dark") is recognized — otherwise
    // Monaco falls back to its built-in "vs" (light) on first paint, even
    // when [data-theme="dark"] is set on <html>.
    registerQuietThemes(monaco);
  };

  const onMount: OnMount = (mountedEditor, monaco) => {
    editorRef.current = mountedEditor;
    monacoRef.current = monaco;

    // Fix the WebView2 (Windows) initial-layout glitch. Verified against real
    // WebView2: a lazily-mounted editor lays out with a collapsed first line and
    // a ~half-line text/caret offset (the gutter line-numbers and the text don't
    // line up, and the caret is invisible). The global `remeasureFonts()` on
    // `document.fonts.ready` (monaco-setup.ts) already fired before this editor
    // existed, so it never covered it. A forced font re-measure plus a 1px
    // layout nudge after mount re-renders the lines at the correct positions —
    // exactly what a real window resize does (the only thing that fixed it).
    // Harmless on macOS/WebKit, where the first layout is already correct.
    const fixInitialLayout = () => {
      try {
        monaco.editor.remeasureFonts();
        const node = mountedEditor.getDomNode();
        if (node && node.clientWidth > 0 && node.clientHeight > 0) {
          const w = node.clientWidth;
          const h = node.clientHeight;
          mountedEditor.layout({ width: w - 1, height: h });
          mountedEditor.layout({ width: w, height: h });
        } else {
          mountedEditor.layout();
        }
      } catch {
        // The tab may have closed (editor disposed) before this ran — ignore.
      }
    };
    requestAnimationFrame(() => requestAnimationFrame(fixInitialLayout));
    window.setTimeout(fixInitialLayout, 150);

    // Belt-and-braces: ensure the theme is applied after the editor mounts.
    monaco.editor.setTheme(readResolvedQuietTheme());

    registerQuietThemes(monaco);
    registerPgLanguage();
    registerAutocomplete(monaco, {
      getActiveConnId: () => useEditor.getState().getActiveConnId(),
      getActiveEditor: () => editorRef.current,
    });

    // format wiring — Cmd+Shift+F formats immediately, Cmd+S
    // debounces (500ms) and then formats on save. Both keep cursor + undo
    // stack intact via a single executeEdits per format.
    bindFormatShortcut(mountedEditor, monaco);
    bindFormatOnSave(mountedEditor, monaco);

    // register this editor instance as the snippet-palette target.
    // Cmd+J palette inserts at this editor's cursor via Monaco's
    // editor.action.insertSnippet (handled by useEditor.insertSnippetAtCursor).
    setActiveMonacoEditor(mountedEditor);

    // Restore cursor position from the persisted tab.
    if (tab.cursorPos) {
      mountedEditor.setPosition({
        lineNumber: tab.cursorPos.line,
        column: tab.cursorPos.col,
      });
    }

    mountedEditor.onDidChangeCursorPosition((event) => {
      useEditor.getState().setCursor(tabId, event.position.lineNumber, event.position.column);
    });

    // Clear stale pg-error markers as soon as the user edits the buffer.
    // Without this the squiggle from a previous failed query stays painted
    // at the original (line, col) — which now points at unrelated text in
    // the new SQL and contradicts the run state once the next Run succeeds.
    // The runState-driven effect above also clears, but it only fires after
    // Run; clearing on edit makes the editor honest the moment the user
    // starts fixing the query.
    const model = mountedEditor.getModel();
    if (model) {
      mountedEditor.onDidChangeModelContent(() => {
        monaco.editor.setModelMarkers(model, "pg-error", []);
      });
    }

    // ─── Active-statement gutter marker + selection sync ─────────────────
    // The gutter marker hugs the lines of the statement under the cursor.
    // Selection text is mirrored into `useEditor.selectionByTab` so the
    // RunToolbar caption can reactively read it (Monaco's selection state
    // is otherwise opaque to React).
    let lastDecorations: editor.IEditorDecorationsCollection | null = null;
    let recomputeTimer: number | null = null;
    const recomputeCurrent = () => {
      const m = mountedEditor.getModel();
      if (!m) return;
      const sel = mountedEditor.getSelection();
      const hasSelection = !!sel && !sel.isEmpty();
      const selText = hasSelection ? m.getValueInRange(sel) : null;
      useEditor.getState().setSelection(tabId, selText);

      if (hasSelection) {
        lastDecorations?.clear();
        useEditor.getState().setCurrentStatement(tabId, null);
        return;
      }
      const stmts = splitStatements(m.getValue());
      const cursor = mountedEditor.getPosition();
      const offset = cursor ? m.getOffsetAt(cursor) : 0;
      const cur = statementAtCursor(stmts, offset);
      useEditor.getState().setCurrentStatement(tabId, cur);

      if (!cur) {
        lastDecorations?.clear();
        return;
      }
      const range = new monaco.Range(cur.startLine, 1, cur.endLine, 1);
      const dec = {
        range,
        options: {
          isWholeLine: true,
          linesDecorationsClassName: "q-current-stmt-marker",
        },
      };
      if (lastDecorations) {
        lastDecorations.set([dec]);
      } else {
        lastDecorations = mountedEditor.createDecorationsCollection([dec]);
      }
    };
    const debouncedRecompute = () => {
      if (recomputeTimer !== null) window.clearTimeout(recomputeTimer);
      recomputeTimer = window.setTimeout(recomputeCurrent, 80);
    };
    mountedEditor.onDidChangeModelContent(debouncedRecompute);
    mountedEditor.onDidChangeCursorPosition(debouncedRecompute);
    mountedEditor.onDidChangeCursorSelection(debouncedRecompute);
    recomputeCurrent();
    mountedEditor.onDidDispose(() => {
      if (recomputeTimer !== null) window.clearTimeout(recomputeTimer);
      lastDecorations?.clear();
    });

    // Cmd/Ctrl + Enter → mirror Run button — selection or current statement.
    mountedEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      const sel = mountedEditor.getSelection();
      const m = mountedEditor.getModel();
      const selText = sel && !sel.isEmpty() && m ? m.getValueInRange(sel).trim() : "";
      if (selText.length > 0) {
        void useEditor.getState().runQuery(tabId, { kind: "selection", text: selText });
      } else {
        void useEditor.getState().runQuery(tabId, { kind: "current" });
      }
    });

    // Cmd/Ctrl + Shift + Enter → Run all (every statement in the tab).
    mountedEditor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter,
      () => {
        void useEditor.getState().runQuery(tabId, { kind: "all" });
      },
    );

    // (): Cmd/Ctrl+E runs EXPLAIN, Cmd/Ctrl+Shift+E runs
    // EXPLAIN ANALYZE on the active editor tab. Bound here as Monaco commands
    // so they win over Monaco's default Cmd+E (`editor.action.nextMatchFindAction`)
    // when the editor has focus — a window-level fallback in Workspace.tsx
    // covers the case where focus is outside the editor.
    mountedEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyE, () => {
      void useEditor.getState().runExplain(tabId, "explain");
    });
    mountedEditor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyE,
      () => {
        void useEditor.getState().runExplain(tabId, "analyze");
      },
    );
  };

  const onChange = (value: string | undefined) => {
    useEditor.getState().setContent(tabId, value ?? "");
  };

  // — clear the active-monaco-editor pointer on unmount so the
  // snippet palette doesn't try to insert into a torn-down instance.
  useEffect(() => {
    return () => setActiveMonacoEditor(null);
  }, []);

  return (
    <div
      className="q-editor-rules"
      style={{ height: "100%", width: "100%", backgroundColor: "transparent" }}
      data-testid="monaco-editor"
    >
      <Editor
        value={tab.content}
        language={LanguageIdEnum.PG}
        theme={monacoTheme}
        beforeMount={beforeMount}
        onMount={onMount}
        onChange={onChange}
        options={{
          minimap: { enabled: false },
          fontSize: 13,
          lineHeight: 22,
          fontFamily: '"JetBrains Mono", "SF Mono", ui-monospace, Menlo, monospace',
          fontLigatures: false,
          letterSpacing: 0,
          wordWrap: "on",
          lineNumbers: "on",
          lineNumbersMinChars: 3,
          lineDecorationsWidth: 12,
          padding: { top: 10, bottom: 10 },
          glyphMargin: false,
          folding: false,
          renderLineHighlight: "line",
          scrollBeyondLastLine: false,
          automaticLayout: true,
          smoothScrolling: true,
          cursorBlinking: "smooth",
          cursorSmoothCaretAnimation: "on",
          overviewRulerBorder: false,
          hideCursorInOverviewRuler: true,
          scrollbar: {
            verticalScrollbarSize: 8,
            horizontalScrollbarSize: 8,
            useShadows: false,
          },
          guides: {
            indentation: false,
            highlightActiveIndentation: false,
          },
        }}
      />
    </div>
  );
}
