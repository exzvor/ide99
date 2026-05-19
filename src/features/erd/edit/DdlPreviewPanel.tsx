// src/features/erd/edit/DdlPreviewPanel.tsx
import { Editor, type Monaco, type OnMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { type JSX, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useDebouncedCallback } from "../../../hooks/useDebouncedCallback";
import { parseDdl } from "../../../lib/parser";
import type { ApplyError, ErdSchemaGraph } from "../../../lib/tauri";
import { type QuietThemeId, readResolvedQuietTheme } from "../../editor/monacoQuietTheme";
import { type AstWarning, deriveOpsFromAst } from "./applyAstChanges";
import { normalizeSql } from "./normalizeSql";
import { useEditStore } from "./store";
import type { DdlGenResult, ValidationIssue } from "./types";

// Stable references so Zustand selectors don't return a fresh `[]`/`null`
// each render and trigger an infinite update loop.
const EMPTY_WARNINGS: AstWarning[] = [];

type TranslateFn = (key: string, vars?: Record<string, unknown>) => string;

interface DdlPreviewPanelProps {
  ddl: DdlGenResult;
  issues: ValidationIssue[];
  applyError: ApplyError | null;
  /** S20 — tabId binds reverse-projection state. */
  tabId: string;
  /** S20 — base ERD graph used to resolve `(schema, name)` references during reverse mapping. */
  baseGraph: ErdSchemaGraph;
}

/**
 * banner-rendering kept for validation issues. turns the
 * preview into a real Monaco editor and wires it as the source-of-truth for
 * DDL ↔ ops bidirectional sync.
 */
function formatIssue(t: TranslateFn, issue: ValidationIssue): string {
  switch (issue.kind) {
    case "empty-name":
      return t("erd.edit.validation.empty_name");
    case "duplicate-table":
      return t("erd.edit.validation.duplicate_table", {
        name: issue.name,
        schema: issue.schema,
      });
    case "duplicate-column":
      return t("erd.edit.validation.duplicate_column", { name: issue.column });
    case "no-columns":
      return t("erd.edit.validation.no_columns");
    case "fk-type-mismatch":
      return t("erd.edit.validation.fk_type_mismatch", {
        source: issue.sourceType,
        target: issue.targetType,
      });
    case "fk-target-not-unique":
      return t("erd.edit.validation.fk_target_not_unique");
  }
}

export function DdlPreviewPanel({
  ddl,
  issues,
  applyError,
  tabId,
  baseGraph,
}: DdlPreviewPanelProps): JSX.Element {
  const { t } = useTranslation();
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  const astWarnings = useEditStore((s) => s.tabs.get(tabId)?.astWarnings ?? EMPTY_WARNINGS);
  const astParseError = useEditStore((s) => s.tabs.get(tabId)?.astParseError ?? null);
  const lastChangeBy = useEditStore((s) => s.tabs.get(tabId)?.lastChangeBy ?? null);
  const replaceOpsFromAst = useEditStore((s) => s.replaceOpsFromAst);
  const setAstParseError = useEditStore((s) => s.setAstParseError);
  const isEmpty = ddl.statements.length === 0;

  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  // Tracks whether the next `onChange` is the synthetic flush from a forward
  // re-projection. `setValue()` triggers `onDidChangeModelContent`; we want to
  // skip parsing for that one tick (it would re-parse what we just generated).
  const suppressNextChange = useRef(false);

  const [monacoTheme, setMonacoTheme] = useState<QuietThemeId>(() => readResolvedQuietTheme());

  // Theme observer (mirrors MonacoEditor.tsx)
  useEffect(() => {
    if (typeof document === "undefined") return;
    const apply = () => {
      const next = readResolvedQuietTheme();
      setMonacoTheme(next);
      monacoRef.current?.editor.setTheme(next);
    };
    apply();
    const obs = new MutationObserver(apply);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);

  const handleMount: OnMount = useCallback((ed, monaco) => {
    editorRef.current = ed;
    monacoRef.current = monaco;
  }, []);

  // Forward direction: ops mutate (via canvas / undo / pushOp) → text regenerates.
  // Apply only when normalized text differs to avoid disrupting the user's caret.
  //
  // S20 fix: when the most recent change came from the user typing in
  // Monaco (`lastChangeBy === "text"`), the regenerated DDL is intentionally
  // lossy (drops `Unrepresentable` statements like `CREATE INDEX`, may reorder
  // statements). Echoing it back into Monaco would erase the user's text and
  // create the disappearing-DDL bug. Skip the forward write entirely in that
  // mode — the text is already canonical for the current ops.
  useEffect(() => {
    const ed = editorRef.current;
    if (!ed) return;
    if (lastChangeBy === "text") return;
    const current = ed.getValue();
    if (normalizeSql(current) === normalizeSql(ddl.sql)) return;
    suppressNextChange.current = true;
    ed.setValue(ddl.sql);
  }, [ddl.sql, lastChangeBy]);

  // Reverse direction: user typing → debounced parse → reproject ops.
  const onContentChanged = useDebouncedCallback((text: unknown) => {
    void (async () => {
      const sourceText = text as string;
      const result = await parseDdl(sourceText);
      const ed = editorRef.current;
      const monaco = monacoRef.current;
      const model = ed?.getModel();
      if (!result.ok) {
        setAstParseError(tabId, result.error);
        if (monaco && model) {
          monaco.editor.setModelMarkers(model, "ddl-parser", [
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
      setAstParseError(tabId, null);
      if (monaco && model) monaco.editor.setModelMarkers(model, "ddl-parser", []);
      const { ops, warnings } = deriveOpsFromAst(baseGraph, result.value.changes);
      // S20 pass the verbatim text so Apply can use it instead of
      // regenerating from ops (which loses `CREATE INDEX` etc.).
      replaceOpsFromAst(tabId, ops, warnings, sourceText);
    })();
  }, 200);

  const handleChange = useCallback(
    (value: string | undefined) => {
      if (suppressNextChange.current) {
        suppressNextChange.current = false;
        return;
      }
      onContentChanged((value ?? "") as unknown);
    },
    [onContentChanged],
  );

  return (
    <div
      data-testid="ddl-preview-panel"
      style={{
        display: "flex",
        flexDirection: "column",
        borderTop: "1px solid var(--border)",
        background: "var(--bg-2)",
        color: "var(--ink-2)",
        fontSize: 12,
      }}
    >
      <header style={{ display: "flex", alignItems: "center", padding: "6px 10px", gap: 12 }}>
        <strong>{t("erd.edit.preview.title")}</strong>
        {!isEmpty && (
          <span data-testid="ddl-preview-count">
            {t("erd.edit.preview.statement_count", { n: ddl.statements.length })}
          </span>
        )}
        {warnings.length > 0 && (
          <span data-testid="ddl-preview-warnings" style={{ color: "var(--warn, #d49b1c)" }}>
            {t("erd.edit.preview.warning_count", { n: warnings.length })}
          </span>
        )}
        {astWarnings.length > 0 && (
          <span data-testid="ddl-preview-ast-warnings" style={{ color: "var(--warn, #d49b1c)" }}>
            {t("parser.ddl.warningTitle", {
              defaultValue: "Some statements not yet representable in ERD",
            })}{" "}
            ({astWarnings.length})
          </span>
        )}
      </header>
      {astParseError && (
        <div
          data-testid="ddl-preview-parse-error"
          role="alert"
          style={{
            padding: "6px 10px",
            background: "var(--err-bg, #5a1f1f)",
            color: "var(--err-fg, #ffdcdc)",
          }}
        >
          {t("parser.ddl.error", { defaultValue: "Parse error" })}: line {astParseError.line}:
          {astParseError.column} — {astParseError.message}
        </div>
      )}
      {errors.length > 0 && (
        <div
          data-testid="ddl-preview-errors"
          role="alert"
          style={{
            padding: "6px 10px",
            background: "var(--err-bg, #5a1f1f)",
            color: "var(--err-fg, #ffdcdc)",
          }}
        >
          <strong>{t("erd.edit.preview.error.title")}</strong>
          <ul
            data-testid="ddl-preview-errors-list"
            style={{ margin: 0, paddingLeft: 18, listStyle: "disc" }}
          >
            {errors.map((issue, idx) => (
              <li key={`${issue.kind}-${issue.opId}-${idx}`}>{formatIssue(t, issue)}</li>
            ))}
          </ul>
        </div>
      )}
      {applyError && (
        <div
          data-testid="ddl-preview-error"
          role="alert"
          style={{
            padding: "6px 10px",
            background: "var(--err-bg, #5a1f1f)",
            color: "var(--err-fg, #ffdcdc)",
          }}
        >
          <strong>{t("erd.edit.preview.error.title")}</strong>
          <div>
            [{applyError.pgErrorCode}] {applyError.pgMessage}
            {applyError.failingStatementIndex !== null && (
              <span> · stmt #{applyError.failingStatementIndex + 1}</span>
            )}
          </div>
          {applyError.pgHint && <div style={{ opacity: 0.85 }}>{applyError.pgHint}</div>}
        </div>
      )}
      {astWarnings.length > 0 && (
        <ul
          data-testid="ddl-preview-ast-warnings-list"
          style={{
            margin: 0,
            padding: "6px 10px",
            listStyle: "disc",
            color: "var(--warn, #d49b1c)",
          }}
        >
          {astWarnings.map(
            (
              w,
              idx, // biome-ignore lint/suspicious/noArrayIndexKey: warnings are append-only and never re-ordered; index is stable per render.
            ) => (
              <li key={`ast-warn-${idx}`}>
                ⚠ {w.message}
                {w.sqlSnippet ? <span style={{ opacity: 0.7 }}> — {w.sqlSnippet}</span> : null}
              </li>
            ),
          )}
        </ul>
      )}
      <div data-testid="ddl-preview-monaco-host" style={{ height: 240 }}>
        <Editor
          height="240px"
          defaultLanguage="sql"
          value={ddl.sql}
          theme={monacoTheme}
          onMount={handleMount}
          onChange={handleChange}
          options={{
            minimap: { enabled: false },
            fontSize: 12,
            scrollBeyondLastLine: false,
            automaticLayout: true,
          }}
        />
      </div>
      {/*
        S19 callers (`ErdPane.edit.test`, `bugfixes-s19.test`) assert against
        this testid; keeping a hidden text mirror preserves them through the
        S20 Monaco rewrite without changing assertion intent.
      */}
      <span data-testid="ddl-preview-sql" style={{ display: "none" }}>
        {isEmpty ? t("erd.edit.preview.empty") : ddl.sql}
      </span>
    </div>
  );
}
