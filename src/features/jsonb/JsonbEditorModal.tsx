/**
 * — JSONB Tree Editor modal shell.
 *
 * Mounted unconditionally at workspace level. Opens when
 * `useJsonbEditor.open === true`. Hosts the Text/Tree/Table view toggle, the
 * live diff preview pane, and the Save flow (with TypingConfirmModal in
 * prod). See spec §5.1 for the layout decisions and §5.7 for the prod
 * confirm flow.
 */

import { type JSX, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog } from "../../components/Dialog";
import { TypingConfirmModal } from "../../components/TypingConfirmModal";
import { useEditor } from "../editor/store";
import { JsonbQueryBuilderModal } from "./builder/JsonbQueryBuilderModal";
import { previewSql } from "./diff/previewSql";
import { InferredSchemaPanel } from "./panels/InferredSchemaPanel";
import { useJsonbEditor } from "./state/store";
import { TableView, isTabularValue } from "./table/TableView";
import { TextView } from "./text/TextView";
import { TreeView } from "./tree/TreeView";

export function JsonbEditorModal(): JSX.Element | null {
  const { t } = useTranslation();
  const open = useJsonbEditor((s) => s.open);
  const args = useJsonbEditor((s) => s.args);
  const draft = useJsonbEditor((s) => s.draft);
  const original = useJsonbEditor((s) => s.original);
  const draftParsed = useJsonbEditor((s) => s.draftParsed);
  const draftParseError = useJsonbEditor((s) => s.draftParseError);
  const mode = useJsonbEditor((s) => s.mode);
  const setMode = useJsonbEditor((s) => s.setMode);
  const setDraft = useJsonbEditor((s) => s.setDraft);
  const rowKey = useJsonbEditor((s) => s.rowKey);
  const envIsProd = useJsonbEditor((s) => s.envIsProd);
  const fqTableName = useJsonbEditor((s) => s.fqTableName);
  const diff = useJsonbEditor((s) => s.diff);
  const status = useJsonbEditor((s) => s.status);
  const close = useJsonbEditor((s) => s.close);
  const save = useJsonbEditor((s) => s.save);

  // Resolve the source column name from the live editor run. Stable
  // selector — react re-renders if the column changes.
  const columnName = useEditor((s) => {
    if (!args) return "";
    const run = s.runStates.get(args.tabId);
    if (!run || run.status !== "streaming") return "";
    return run.columns[args.srcColIdx]?.name ?? "";
  });
  const columnTypeName = useEditor((s) => {
    if (!args) return "";
    const run = s.runStates.get(args.tabId);
    if (!run || run.status !== "streaming") return "";
    return run.columns[args.srcColIdx]?.typeName ?? "";
  });
  const connId = useEditor((s) => {
    if (!args) return "";
    const tab = s.tabs.find((t) => t.id === args.tabId);
    if (!tab || tab.kind !== "editor") return "";
    return tab.connectionId ?? "";
  });

  const [showProdConfirm, setShowProdConfirm] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(false);

  const dirty = draft !== original;
  const isReadOnly = rowKey?.kind === "readOnly";
  const tabularEnabled = !isReadOnly && draftParsed !== null && isTabularValue(draftParsed);

  const previewBody = useMemo(() => {
    if (!rowKey || isReadOnly) return "";
    if (!dirty) return "";
    return previewSql({ rowKey, column: columnName || "data", diff });
  }, [rowKey, isReadOnly, dirty, columnName, diff]);

  const beginSave = useCallback(() => {
    if (isReadOnly || draftParseError || !dirty) return;
    if (envIsProd && fqTableName) {
      setShowProdConfirm(true);
      return;
    }
    void save(null);
  }, [isReadOnly, draftParseError, dirty, envIsProd, fqTableName, save]);

  // Cmd+S / Ctrl+S keyboard shortcut.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        beginSave();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, beginSave]);

  function tryClose() {
    if (dirty && !window.confirm(t("jsonb.modal.discardConfirm"))) return;
    close();
  }

  function copyTemplate() {
    if (!fqTableName) return;
    const tmpl = `UPDATE ${fqTableName} SET ${columnName || "data"} = '<your-jsonb>'::jsonb WHERE <pk> = <value>;`;
    void navigator.clipboard?.writeText(tmpl);
  }

  if (!open || !args) return null;

  // Title shape:
  // "Edit JSONB: <table>.<column> · row <N>"  when table is known
  // "Edit JSONB: <column> · row <N>"          when read-only / unresolved
  // Row index is 1-based for display (matches grid/editor row numbering
  // conventions everywhere else in the IDE).
  const colLabel = columnName || "data";
  const target = fqTableName ? `${fqTableName}.${colLabel}` : colLabel;
  const rowLabel = String(args.rowIdx + 1);
  const dialogTitle = t("jsonb.modal.titleV2", { target, row: rowLabel });

  return (    <>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!v) tryClose();
        }}
        title={dialogTitle}
        size="xl"
        closeAriaLabel={t("jsonb.modal.close")}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            minHeight: "60vh",
            maxHeight: "calc(88vh - 64px)",
            width: "100%",
            padding: "12px 20px 16px",
            boxSizing: "border-box",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              padding: "4px 0 8px",
              gap: 12,
            }}
          >
            {!tabularEnabled && !isReadOnly ? (              <span
                style={{
                  fontSize: 11,
                  color: "var(--ink-3)",
                  fontFamily: "var(--font-sans-q, sans-serif)",
                }}
                data-testid="jsonb-table-mode-hint"
              >
                {t("jsonb.mode.tableDisabledTooltip")}
              </span>
) : null}
            {connId && rowKey && rowKey.kind !== "readOnly" ? (              <button
                type="button"
                className="btn btn-ghost"
                style={{ fontSize: 12 }}
                data-testid="jsonb-editor-build-query-btn"
                onClick={() => setBuilderOpen(true)}
              >
                🔧 {t("jsonb.builder.buildFromCellTitle")}
              </button>
) : null}
            <ModeToggle mode={mode} setMode={setMode} tabularEnabled={tabularEnabled} t={t} />
          </div>
          <div
            style={{
              flex: 1,
              display: "grid",
              gridTemplateRows: "70% 30%",
              minHeight: 0,
              border: "1px solid var(--hairline)",
              borderRadius: 6,
            }}
          >
            <div style={{ overflow: "auto", padding: "8px 12px", minHeight: 0 }}>
              {mode === "text" && (                <TextView
                  value={draft}
                  onChange={setDraft}
                  readOnly={!!isReadOnly}
                  parseError={draftParseError}
                />
)}
              {mode === "tree" && (                // The canonical-key-order note is rendered inside TreeView
                // itself when `isJsonbType=true`, so the modal does NOT
                // render its own (would surface as a duplicate banner).
                <TreeView
                  value={draftParsed}
                  onChange={(next) => setDraft(JSON.stringify(next))}
                  readOnly={!!isReadOnly}
                  isJsonbType={columnTypeName === "jsonb"}
                />
)}
              {mode === "table" && tabularEnabled && (                <TableView
                  value={draftParsed}
                  onChange={(next) => setDraft(JSON.stringify(next))}
                  readOnly={!!isReadOnly}
                />
)}
            </div>
            <div
              aria-live="polite"
              style={{
                borderTop: "1px solid var(--hairline)",
                padding: "8px 12px",
                background: "var(--bg-sunken)",
                fontFamily: "var(--font-mono-q)",
                fontSize: 12,
                overflow: "auto",
                minHeight: 0,
              }}
            >
              {isReadOnly ? (                <div>
                  <div style={{ color: "var(--ink-3)", marginBottom: 6 }}>
                    {t("jsonb.readonly.banner")}
                  </div>
                  <div style={{ color: "var(--ink-3)", fontSize: 11, marginBottom: 6 }}>
                    {rowKey
                      ? t(`jsonb.readonly.reason.${(rowKey as { reason: string }).reason}`)
                      : ""}
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={copyTemplate}
                    disabled={!fqTableName}
                  >
                    {t("jsonb.readonly.copyTemplate")}
                  </button>
                </div>
) : (                <>
                  <div style={{ color: "var(--ink-3)", marginBottom: 4 }}>
                    {t("jsonb.diff.willSaveAs")} —{" "}
                    {!dirty
                      ? t("jsonb.diff.noChanges")
                      : diff.fullReplace
                        ? t("jsonb.diff.fullReplace")
                        : t("jsonb.diff.setOps", { count: diff.ops.length })}
                  </div>
                  <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{previewBody}</pre>
                </>
)}
            </div>
          </div>
          {args && rowKey && rowKey.kind !== "readOnly" && columnName && connId ? (            <InferredSchemaPanelSection
              connId={connId}
              schemaName={rowKey.schema}
              tableName={rowKey.table}
              columnName={columnName}
            />
) : null}
          {draftParseError ? (            <div
              role="alert"
              style={{
                marginTop: 8,
                padding: "6px 10px",
                color: "var(--accent-strong-danger)",
                fontSize: 12,
              }}
            >
              {t("jsonb.text.invalidJson", { message: draftParseError })}
            </div>
) : null}
          {status.kind === "error" ? (            <div
              role="alert"
              style={{
                marginTop: 8,
                padding: "6px 10px",
                color: "var(--accent-strong-danger)",
                fontSize: 12,
              }}
            >
              {t("jsonb.toast.saveFailed", { message: status.message })}
            </div>
) : null}
          <div
            style={{
              padding: "12px 0 0",
              display: "flex",
              justifyContent: "flex-end",
              gap: 8,
            }}
          >
            <button type="button" className="btn btn-ghost" onClick={tryClose}>
              {t("jsonb.modal.cancel")}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={beginSave}
              disabled={!dirty || !!isReadOnly || !!draftParseError || status.kind === "saving"}
            >
              {t("jsonb.modal.save")}
            </button>
          </div>
        </div>
      </Dialog>
      {showProdConfirm && fqTableName ? (        <TypingConfirmModal
          title={t("jsonb.prod.confirmTitle")}
          description={t("jsonb.prod.confirmBody", { table: fqTableName })}
          expectedToken={fqTableName}
          inputLabel={t("jsonb.prod.confirmInputLabel", { table: fqTableName })}
          confirmLabel={t("jsonb.prod.apply")}
          cancelLabel={t("jsonb.modal.cancel")}
          dangerSqlPreview={typeof previewBody === "string" ? previewBody : undefined}
          onCancel={() => setShowProdConfirm(false)}
          onConfirm={(token) => {
            setShowProdConfirm(false);
            void save(token);
          }}
        />
) : null}
      {builderOpen && connId && rowKey && rowKey.kind !== "readOnly" ? (        <JsonbQueryBuilderModal
          open={builderOpen}
          connId={connId}
          fqn={{
            schema: rowKey.schema,
            table: rowKey.table,
            column: columnName || "data",
          }}
          onClose={() => setBuilderOpen(false)}
        />
) : null}
    </>
);
}

function ModeToggle({
  mode,
  setMode,
  tabularEnabled,
  t,
}: {
  mode: "text" | "tree" | "table";
  setMode: (m: "text" | "tree" | "table") => void;
  tabularEnabled: boolean;
  t: (key: string, vars?: Record<string, unknown>) => string;
}): JSX.Element {
  const opts: Array<{ id: "text" | "tree" | "table"; enabled: boolean; tipKey?: string }> = [
    { id: "text", enabled: true },
    { id: "tree", enabled: true },
    { id: "table", enabled: tabularEnabled, tipKey: "jsonb.mode.tableDisabledTooltip" },
  ];
  return (    <div role="tablist" aria-label={t("jsonb.mode.tablistLabel")} className="jsonb-mode-toggle">
      {opts.map((o) => (        <button
          key={o.id}
          type="button"
          role="tab"
          aria-selected={mode === o.id}
          aria-disabled={!o.enabled}
          disabled={!o.enabled}
          title={!o.enabled && o.tipKey ? t(o.tipKey) : undefined}
          onClick={() => o.enabled && setMode(o.id)}
          className="jsonb-mode-toggle__btn"
        >
          {t(`jsonb.mode.${o.id}`)}
        </button>
))}
    </div>
);
}

interface InferredSchemaPanelSectionProps {
  connId: string;
  schemaName: string;
  tableName: string;
  columnName: string;
}

function InferredSchemaPanelSection({
  connId,
  schemaName,
  tableName,
  columnName,
}: InferredSchemaPanelSectionProps): JSX.Element {
  const { t } = useTranslation();
  const lsKey = useMemo(    () => `ide99.jsonb.inference.modal.expanded.${connId}.${schemaName}.${tableName}.${columnName}`,
    [connId, schemaName, tableName, columnName],
);

  // fix: persistence semantics are
  // localStorage = "have user expressed an explicit preference?"
  // First-time open (lsKey absent in localStorage): auto-expand ONCE so the
  // user discovers the feature, but immediately persist `"false"` so the
  // next open is collapsed by default. Subsequent opens read whatever the
  // user's last toggle was.
  const [expanded, setExpanded] = useState<boolean>(() => {
    try {
      const raw = window.localStorage.getItem(lsKey);
      if (raw === null) {
        // First time — auto-expand once, persist "false" so subsequent
        // opens are collapsed unless the user explicitly toggles.
        window.localStorage.setItem(lsKey, "false");
        return true;
      }
      return raw === "true";
    } catch {
      return false;
    }
  });

  const toggle = useCallback(() => {
    setExpanded((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(lsKey, String(next));
      } catch {
        // localStorage unavailable (private mode, quotas) — silently fall back.
      }
      return next;
    });
  }, [lsKey]);

  return (    <div className="jsonb-modal-inference" style={{ marginTop: 8 }}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={expanded}
        className="jsonb-modal-inference-toggle"
      >
        {expanded ? "▾" : "▸"}{" "}
        {expanded
          ? t("jsonb.inference.panel.modalSection.collapse")
          : t("jsonb.inference.panel.modalSection.expand")}
      </button>
      {expanded && (        <InferredSchemaPanel
          connId={connId}
          fqn={{
            schema: schemaName,
            table: tableName,
            column: columnName,
          }}
          variant="modal"
        />
)}
    </div>
);
}
