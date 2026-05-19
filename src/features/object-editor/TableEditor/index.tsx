// — TableEditor (B3.T1). Tab-based form for create/edit table.
//
// Layout: header (schema/name + dirty badge + HelpLink) — body (left tab list,
// right tab content) — sticky right pane (DDL preview + Apply/Cancel footer).
//
// On mount: edit-mode → schemaGetTableDefinition + tableFormFromDefinition;
// create-mode → blankTableForm. On unmount: clearTab.

import { type JSX, useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { schemaGetTableDefinition } from "../../../lib/tauri";
import type { ObjectEditorTab } from "../../editor/store";
import { generateTableDdl } from "../ddl/tableDdl";
import type { TableForm } from "../ddl/types";
import { ObjectEditorApplyConfirm } from "../shared/ObjectEditorApplyConfirm";
import { applyAndRefresh } from "../shared/applyAndRefresh";
import { useObjectEditorStore } from "../store";
import { ColumnsTab } from "./ColumnsTab";
import { ConstraintsTab } from "./ConstraintsTab";
import { DdlPreviewPanel } from "./DdlPreviewPanel";
import { HelpLink } from "./HelpLink";
import { IndexesTab } from "./IndexesTab";
import { PartitionStubTab } from "./PartitionStubTab";
import { RlsStubTab } from "./RlsStubTab";
import { blankTableForm } from "./blank";
import { formStateDirty } from "./dirty";
import { tableFormFromDefinition } from "./fromDefinition";

export interface TableEditorProps {
  tab: ObjectEditorTab;
}

type TabKey = "columns" | "constraints" | "indexes" | "rls" | "partition";

export function TableEditor({ tab }: TableEditorProps): JSX.Element {
  const { t } = useTranslation();
  const formState = useObjectEditorStore((s) => s.formByTab[tab.id]);
  const apply = useObjectEditorStore((s) => s.applyByTab[tab.id]);
  const setForm = useObjectEditorStore((s) => s.setForm);
  const updateForm = useObjectEditorStore((s) => s.updateForm);
  const setApply = useObjectEditorStore((s) => s.setApply);
  const clearTab = useObjectEditorStore((s) => s.clearTab);

  const [activeTab, setActiveTab] = useState<TabKey>("columns");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Mount: hydrate form state.
  useEffect(() => {
    let cancelled = false;
    const existing = useObjectEditorStore.getState().formByTab[tab.id];
    if (existing) return;
    if (tab.target.mode === "create") {
      setForm(tab.id, {
        kind: "table",
        form: blankTableForm(tab.target.schema),
        initial: null,
      });
      return;
    }
    void (async () => {
      try {
        const def = await schemaGetTableDefinition(
          tab.connectionId,
          tab.target.schema,
          tab.target.name ?? "",
        );
        if (cancelled) return;
        const form = tableFormFromDefinition(def);
        setForm(tab.id, { kind: "table", form, initial: form });
      } catch (err) {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab.id, tab.connectionId, tab.target.mode, tab.target.schema, tab.target.name, setForm]);

  // Unmount: clear store.
  useEffect(() => {
    return () => {
      clearTab(tab.id);
    };
  }, [tab.id, clearTab]);

  const onChange = useCallback(
    (mutator: (f: TableForm) => TableForm): void => {
      updateForm(tab.id, (s) => (s.kind === "table" ? { ...s, form: mutator(s.form) } : s));
    },
    [tab.id, updateForm],
  );

  // Compute DDL with debounced (deferred) inputs to avoid recompute on every keystroke.
  const stableFormState = formState && formState.kind === "table" ? formState : null;
  const deferredCurrent = useDeferredValue(stableFormState?.form ?? null);
  const deferredInitial = useDeferredValue(stableFormState?.initial ?? null);
  const ddl = useMemo(() => {
    if (!deferredCurrent) return null;
    return generateTableDdl(deferredInitial ?? null, deferredCurrent);
  }, [deferredCurrent, deferredInitial]);

  const dirty = stableFormState
    ? formStateDirty(stableFormState.initial, stableFormState.form)
    : false;

  if (loadError) {
    return (
      <div
        data-testid="table-editor-load-error"
        role="alert"
        style={{ padding: 16, color: "var(--danger, #c0392b)" }}
      >
        {t("object_editor.common.load_error")}: {loadError}
      </div>
    );
  }

  if (!stableFormState || !ddl) {
    return (
      <div data-testid="table-editor-loading" style={{ padding: 16 }}>
        {t("object_editor.common.loading")}
      </div>
    );
  }

  const form = stableFormState.form;
  const canApply = ddl.errors.length === 0 && ddl.sql.trim().length > 0;
  const statementCount = ddl.sql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0).length;

  const onCancel = (): void => {
    // Cancel resets the form to its initial state and
    // keeps the editor tab open. Closure goes through the tab × button +
    // dirty-confirm dialog () instead.
    if (stableFormState.initial !== null) {
      setForm(tab.id, {
        kind: "table",
        form: stableFormState.initial,
        initial: stableFormState.initial,
      });
    } else {
      // Create-mode: reset to a blank form so the user keeps the tab.
      const blank = blankTableForm(tab.target.schema);
      setForm(tab.id, { kind: "table", form: blank, initial: null });
    }
  };

  const onApplyClick = (): void => {
    if (!canApply) return;
    setConfirmOpen(true);
  };

  const doApply = (): void => {
    setConfirmOpen(false);
    setApply(tab.id, { phase: "applying" });
    void (async () => {
      try {
        await applyAndRefresh(tab.id, tab.connectionId, ddl.sql);
        setApply(tab.id, { phase: "success" });
        // Re-fetch initial state so subsequent edits diff against the new world.
        if (tab.target.mode === "edit") {
          try {
            const def = await schemaGetTableDefinition(
              tab.connectionId,
              tab.target.schema,
              form.name,
            );
            const newForm = tableFormFromDefinition(def);
            setForm(tab.id, { kind: "table", form: newForm, initial: newForm });
          } catch {
            // refetch best-effort
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setApply(tab.id, { phase: "error", message });
      }
    })();
  };

  const banner =
    apply && apply.phase === "error" ? { kind: "error" as const, message: apply.message } : null;

  const tabs: { key: TabKey; label: string }[] = [
    { key: "columns", label: t("object_editor.table.tab_columns") },
    { key: "constraints", label: t("object_editor.table.tab_constraints") },
    { key: "indexes", label: t("object_editor.table.tab_indexes") },
    { key: "rls", label: t("object_editor.table.tab_rls") },
    { key: "partition", label: t("object_editor.table.tab_partition") },
  ];

  return (
    <div
      data-testid="table-editor"
      style={{
        display: "grid",
        gridTemplateRows: "auto 1fr",
        gridTemplateColumns: "1fr 380px",
        gap: 0,
        height: "100%",
      }}
    >
      <div
        style={{
          gridColumn: "1 / -1",
          display: "flex",
          gap: 16,
          alignItems: "flex-end",
          padding: 12,
          borderBottom: "1px solid var(--hairline)",
        }}
      >
        <div className="q-field" style={{ width: 160 }}>
          <label htmlFor={`table-schema-${tab.id}`}>{t("object_editor.common.schema")}</label>
          <input
            id={`table-schema-${tab.id}`}
            data-testid="table-schema"
            className="q-input"
            value={form.schema}
            onChange={(e) => onChange((f) => ({ ...f, schema: e.target.value }))}
          />
        </div>
        <div className="q-field" style={{ width: 240 }}>
          <label htmlFor={`table-name-${tab.id}`}>{t("object_editor.common.name")}</label>
          <input
            id={`table-name-${tab.id}`}
            data-testid="table-name"
            className="q-input"
            value={form.name}
            onChange={(e) => onChange((f) => ({ ...f, name: e.target.value }))}
          />
        </div>
        {dirty ? (
          <span
            data-testid="table-dirty-badge"
            aria-label={t("object_editor.common.dirty")}
            style={{
              fontSize: 11,
              color: "var(--accent)",
              paddingBottom: 8,
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            ● {t("object_editor.common.dirty")}
          </span>
        ) : null}
        <div style={{ flex: 1 }} />
        <div style={{ paddingBottom: 4 }}>
          <HelpLink topic="table" />
        </div>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "180px 1fr",
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        <nav
          aria-label={t("object_editor.table.tab_columns")}
          style={{ borderRight: "1px solid var(--hairline)", padding: 8 }}
        >
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {tabs.map((entry) => (
              <li key={entry.key}>
                <button
                  type="button"
                  data-testid={`tab-${entry.key}`}
                  aria-pressed={activeTab === entry.key}
                  onClick={() => setActiveTab(entry.key)}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "6px 10px",
                    background: activeTab === entry.key ? "var(--accent-soft)" : "transparent",
                    border: "none",
                    cursor: "pointer",
                    borderRadius: 4,
                    fontSize: 13,
                  }}
                >
                  {entry.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <div style={{ overflow: "auto", minWidth: 0 }}>
          {activeTab === "columns" && <ColumnsTab form={form} onChange={onChange} />}
          {activeTab === "constraints" && <ConstraintsTab form={form} onChange={onChange} />}
          {activeTab === "indexes" && <IndexesTab form={form} onChange={onChange} />}
          {activeTab === "rls" && <RlsStubTab form={form} onChange={onChange} />}
          {activeTab === "partition" && <PartitionStubTab form={form} />}
        </div>
      </div>
      <div style={{ gridColumn: 2, gridRow: 2, minHeight: 0 }}>
        <DdlPreviewPanel
          result={ddl}
          onApply={onApplyClick}
          onCancel={onCancel}
          canApply={canApply}
          banner={banner}
        />
      </div>
      <ObjectEditorApplyConfirm
        open={confirmOpen}
        statementCount={statementCount}
        connId={tab.connectionId}
        ddl={ddl.sql}
        onConfirm={doApply}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
