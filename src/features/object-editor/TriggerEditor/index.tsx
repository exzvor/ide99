// — TriggerEditor (B3.T3).
//
// Layout: schema/name + table picker (text inputs) + timing radio
// (BEFORE/AFTER/INSTEAD OF) + events checkboxes + UPDATE OF columns CSV +
// FOR EACH radio (ROW/STATEMENT) + WHEN textarea + functionRef picker +
// enabled checkbox. Sticky right pane: DDL preview + Apply/Cancel.

import { type JSX, useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { schemaGetTriggerDefinition } from "../../../lib/tauri";
import type { TriggerDefinition } from "../../../lib/tauri";
import type { ObjectEditorTab } from "../../editor/store";
import { DdlPreviewPanel } from "../TableEditor/DdlPreviewPanel";
import { HelpLink } from "../TableEditor/HelpLink";
import { formStateDirty } from "../TableEditor/dirty";
import { generateTriggerDdl } from "../ddl/triggerDdl";
import type { TriggerForm } from "../ddl/types";
import { ObjectEditorApplyConfirm } from "../shared/ObjectEditorApplyConfirm";
import { applyAndRefresh } from "../shared/applyAndRefresh";
import { useTouched } from "../shared/useTouched";
import { useObjectEditorStore } from "../store";
import { FunctionPicker } from "./FunctionPicker";

export interface TriggerEditorProps {
  tab: ObjectEditorTab;
}

function blankTriggerForm(schema: string): TriggerForm {
  return {
    schema,
    name: "",
    table: { schema, name: "" },
    timing: "before",
    events: { insert: false, update: false, delete: false, truncate: false },
    updateColumns: [],
    forEach: "row",
    whenClause: null,
    functionRef: { schema, name: "" },
    enabled: true,
  };
}

// Local fallback transform — kept as a graceful fallback for the
// `import("../introspect/triggerState")` path below in case B4 hasn't shipped
// at runtime in some test environment. Both produce identical shapes.
function localTriggerFromDefinition(def: TriggerDefinition): TriggerForm {
  return {
    schema: def.schema,
    name: def.name,
    table: { schema: def.tableSchema, name: def.tableName },
    timing: def.timing,
    events: def.events,
    updateColumns: def.updateColumns,
    forEach: def.forEach,
    whenClause: def.whenClause,
    functionRef: { schema: def.functionSchema, name: def.functionName },
    enabled: def.enabled,
  };
}

export function TriggerEditor({ tab }: TriggerEditorProps): JSX.Element {
  const { t } = useTranslation();
  const formState = useObjectEditorStore((s) => s.formByTab[tab.id]);
  const apply = useObjectEditorStore((s) => s.applyByTab[tab.id]);
  const setForm = useObjectEditorStore((s) => s.setForm);
  const updateForm = useObjectEditorStore((s) => s.updateForm);
  const setApply = useObjectEditorStore((s) => s.setApply);
  const clearTab = useObjectEditorStore((s) => s.clearTab);

  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const existing = useObjectEditorStore.getState().formByTab[tab.id];
    if (existing) return;
    if (tab.target.mode === "create") {
      setForm(tab.id, {
        kind: "trigger",
        form: blankTriggerForm(tab.target.schema),
        initial: null,
      });
      return;
    }
    void (async () => {
      try {
        // For triggers, `parentTable` carries the table the trigger lives on.
        const tableName = tab.target.parentTable ?? "";
        const def = await schemaGetTriggerDefinition(          tab.connectionId,
          tab.target.schema,
          tableName,
          tab.target.name ?? "",
);
        if (cancelled) return;
        let form: TriggerForm;
        try {
          const mod = (await import("../introspect/triggerState").catch(() => null)) as {
            fromDefinition?: (d: TriggerDefinition) => TriggerForm;
          } | null;
          form = mod?.fromDefinition ? mod.fromDefinition(def) : localTriggerFromDefinition(def);
        } catch {
          form = localTriggerFromDefinition(def);
        }
        if (cancelled) return;
        setForm(tab.id, { kind: "trigger", form, initial: form });
      } catch (err) {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    tab.id,
    tab.connectionId,
    tab.target.mode,
    tab.target.schema,
    tab.target.name,
    tab.target.parentTable,
    setForm,
  ]);

  useEffect(() => {
    return () => {
      clearTab(tab.id);
    };
  }, [tab.id, clearTab]);

  const onChange = useCallback(    (mutator: (f: TriggerForm) => TriggerForm): void => {
      updateForm(tab.id, (s) => (s.kind === "trigger" ? { ...s, form: mutator(s.form) } : s));
    },
    [tab.id, updateForm],
);

  const stableFormState = formState && formState.kind === "trigger" ? formState : null;
  const deferredCurrent = useDeferredValue(stableFormState?.form ?? null);
  const deferredInitial = useDeferredValue(stableFormState?.initial ?? null);
  const ddl = useMemo(() => {
    if (!deferredCurrent) return null;
    return generateTriggerDdl(deferredInitial ?? null, deferredCurrent);
  }, [deferredCurrent, deferredInitial]);
  const dirty = stableFormState
    ? formStateDirty(stableFormState.initial, stableFormState.form)
    : false;
  const touched = useTouched(stableFormState?.form, stableFormState?.initial);

  if (loadError) {
    return (      <div data-testid="trigger-editor-load-error" role="alert" style={{ padding: 16 }}>
        {t("object_editor.common.load_error")}: {loadError}
      </div>
);
  }
  if (!stableFormState || !ddl) {
    return (      <div data-testid="trigger-editor-loading" style={{ padding: 16 }}>
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
    // reset form, keep tab open.
    if (stableFormState.initial !== null) {
      setForm(tab.id, {
        kind: "trigger",
        form: stableFormState.initial,
        initial: stableFormState.initial,
      });
    } else {
      setForm(tab.id, {
        kind: "trigger",
        form: blankTriggerForm(tab.target.schema),
        initial: null,
      });
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
      } catch (err) {
        setApply(tab.id, {
          phase: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    })();
  };
  const banner =
    apply && apply.phase === "error" ? { kind: "error" as const, message: apply.message } : null;

  const updateColumnsText = form.updateColumns.join(", ");

  return (    <div
      data-testid="trigger-editor"
      style={{
        display: "grid",
        gridTemplateRows: "auto 1fr",
        gridTemplateColumns: "1fr 380px",
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
          <label htmlFor={`trigger-schema-${tab.id}`}>
            {t("object_editor.trigger.schema_label")}
          </label>
          <input
            id={`trigger-schema-${tab.id}`}
            data-testid="trigger-schema"
            className="q-input"
            value={form.schema}
            onChange={(e) => onChange((f) => ({ ...f, schema: e.target.value }))}
          />
        </div>
        <div className="q-field" style={{ width: 260 }}>
          <label htmlFor={`trigger-name-${tab.id}`}>{t("object_editor.trigger.name_label")}</label>
          <input
            id={`trigger-name-${tab.id}`}
            data-testid="trigger-name"
            className="q-input"
            value={form.name}
            onChange={(e) => onChange((f) => ({ ...f, name: e.target.value }))}
          />
        </div>
        {dirty ? (          <span
            data-testid="trigger-dirty-badge"
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
          <HelpLink topic="trigger" />
        </div>
      </div>

      <div style={{ overflow: "auto", padding: 16, display: "grid", gap: 18, minWidth: 0 }}>
        {/* Table picker */}
        <section data-testid="trigger-section-table" style={{ display: "grid", gap: 8 }}>
          <h4 style={{ margin: 0, fontSize: 13 }}>{t("object_editor.trigger.table_section")}</h4>
          <div style={{ display: "flex", gap: 12 }}>
            <div className="q-field" style={{ width: 160 }}>
              <label htmlFor={`trigger-table-schema-${tab.id}`}>
                {t("object_editor.trigger.table_schema")}
              </label>
              <input
                id={`trigger-table-schema-${tab.id}`}
                data-testid="trigger-table-schema"
                className="q-input"
                value={form.table.schema}
                onChange={(e) =>
                  onChange((f) => ({ ...f, table: { ...f.table, schema: e.target.value } }))
                }
              />
            </div>
            <div className="q-field" style={{ width: 240 }}>
              <label htmlFor={`trigger-table-name-${tab.id}`}>
                {t("object_editor.trigger.table_name")}
              </label>
              <input
                id={`trigger-table-name-${tab.id}`}
                data-testid="trigger-table-name"
                className="q-input"
                value={form.table.name}
                onChange={(e) =>
                  onChange((f) => ({ ...f, table: { ...f.table, name: e.target.value } }))
                }
              />
            </div>
          </div>
        </section>

        {/* Timing */}
        <section data-testid="trigger-section-timing" style={{ display: "grid", gap: 8 }}>
          <h4 style={{ margin: 0, fontSize: 13 }}>{t("object_editor.trigger.timing_section")}</h4>
          <div
            role="radiogroup"
            aria-label={t("object_editor.trigger.timing_section")}
            style={{ display: "flex", flexWrap: "wrap", gap: 6 }}
          >
            {(["before", "after", "instead_of"] as const).map((tm) => {
              const checked = form.timing === tm;
              return (                <label
                  key={tm}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    padding: "4px 12px",
                    fontSize: 12,
                    color: checked ? "var(--accent)" : "var(--ink-3)",
                    background: checked ? "var(--accent-soft)" : "var(--bg-elev)",
                    border: `1px solid ${checked ? "var(--accent)" : "var(--border-strong-q)"}`,
                    borderRadius: "var(--r-md)",
                    cursor: "default",
                  }}
                >
                  <input
                    data-testid={`trigger-timing-${tm}`}
                    type="radio"
                    name="trigger-timing"
                    value={tm}
                    checked={checked}
                    onChange={() => onChange((f) => ({ ...f, timing: tm }))}
                    style={{
                      position: "absolute",
                      width: 1,
                      height: 1,
                      opacity: 0,
                      pointerEvents: "none",
                    }}
                  />
                  {t(`object_editor.trigger.timing_${tm}`)}
                </label>
);
            })}
          </div>
          {form.timing === "instead_of" ? (            <div
              // biome-ignore lint/a11y/useSemanticElements: passive banner.
              role="status"
              data-testid="trigger-instead-of-warning"
              style={{
                padding: "6px 10px",
                background: "var(--warn-q-soft)",
                border: "1px solid var(--warn-q)",
                color: "var(--warn-q)",
                borderRadius: "var(--r-md)",
                fontSize: 12,
              }}
            >
              {t("object_editor.trigger.instead_of_warning")}
            </div>
) : null}
        </section>

        {/* Events */}
        <section data-testid="trigger-section-events" style={{ display: "grid", gap: 8 }}>
          <h4 style={{ margin: 0, fontSize: 13 }}>{t("object_editor.trigger.events_section")}</h4>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
            {(["insert", "update", "delete", "truncate"] as const).map((ev) => (              <label key={ev} className="q-checkbox" data-testid={`trigger-event-${ev}-label`}>
                <input
                  data-testid={`trigger-event-${ev}`}
                  type="checkbox"
                  checked={form.events[ev]}
                  onChange={(e) =>
                    onChange((f) => ({
                      ...f,
                      events: { ...f.events, [ev]: e.target.checked },
                    }))
                  }
                />
                {t(`object_editor.trigger.event_${ev}`)}
              </label>
))}
          </div>
          <div className="q-field">
            <label htmlFor={`trigger-update-columns-${tab.id}`}>
              {t("object_editor.trigger.update_columns_label")}
            </label>
            <input
              id={`trigger-update-columns-${tab.id}`}
              data-testid="trigger-update-columns"
              className="q-input mono"
              value={updateColumnsText}
              disabled={!form.events.update}
              placeholder={t("object_editor.trigger.update_columns_placeholder")}
              onChange={(e) =>
                onChange((f) => ({
                  ...f,
                  updateColumns: e.target.value
                    .split(",")
                    .map((s) => s.trim())
                    .filter((s) => s.length > 0),
                }))
              }
            />
          </div>
        </section>

        {/* For each */}
        <section data-testid="trigger-section-for-each" style={{ display: "grid", gap: 8 }}>
          <h4 style={{ margin: 0, fontSize: 13 }}>{t("object_editor.trigger.for_each_section")}</h4>
          <div
            role="radiogroup"
            aria-label={t("object_editor.trigger.for_each_section")}
            style={{ display: "flex", flexWrap: "wrap", gap: 6 }}
          >
            {(["row", "statement"] as const).map((fe) => {
              const checked = form.forEach === fe;
              return (                <label
                  key={fe}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    padding: "4px 12px",
                    fontSize: 12,
                    color: checked ? "var(--accent)" : "var(--ink-3)",
                    background: checked ? "var(--accent-soft)" : "var(--bg-elev)",
                    border: `1px solid ${checked ? "var(--accent)" : "var(--border-strong-q)"}`,
                    borderRadius: "var(--r-md)",
                    cursor: "default",
                  }}
                >
                  <input
                    data-testid={`trigger-for-each-${fe}`}
                    type="radio"
                    name="trigger-for-each"
                    value={fe}
                    checked={checked}
                    onChange={() => onChange((f) => ({ ...f, forEach: fe }))}
                    style={{
                      position: "absolute",
                      width: 1,
                      height: 1,
                      opacity: 0,
                      pointerEvents: "none",
                    }}
                  />
                  {t(`object_editor.trigger.for_each_${fe}`)}
                </label>
);
            })}
          </div>
        </section>

        {/* WHEN */}
        <section data-testid="trigger-section-when" style={{ display: "grid", gap: 8 }}>
          <div className="q-field">
            <label htmlFor={`trigger-when-${tab.id}`}>
              {t("object_editor.trigger.when_label")}
            </label>
            <textarea
              id={`trigger-when-${tab.id}`}
              data-testid="trigger-when"
              className="q-input mono"
              value={form.whenClause ?? ""}
              placeholder={t("object_editor.trigger.when_placeholder")}
              onChange={(e) =>
                onChange((f) => ({
                  ...f,
                  whenClause: e.target.value.trim() === "" ? null : e.target.value,
                }))
              }
              rows={2}
              style={{ resize: "vertical", paddingTop: 6, paddingBottom: 6, height: "auto" }}
            />
          </div>
        </section>

        {/* Function picker */}
        <section data-testid="trigger-section-function" style={{ display: "grid", gap: 8 }}>
          <h4 style={{ margin: 0, fontSize: 13 }}>{t("object_editor.trigger.function_section")}</h4>
          <FunctionPicker
            value={form.functionRef}
            onChange={(functionRef) => onChange((f) => ({ ...f, functionRef }))}
            connId={tab.connectionId}
            schema={form.schema}
          />
        </section>

        {/* Enabled */}
        <section data-testid="trigger-section-enabled" style={{ display: "grid", gap: 6 }}>
          <label className="q-checkbox" data-testid="trigger-enabled-label">
            <input
              data-testid="trigger-enabled"
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => onChange((f) => ({ ...f, enabled: e.target.checked }))}
            />
            {t("object_editor.trigger.enabled")}
          </label>
        </section>
      </div>

      <div style={{ gridColumn: 2, gridRow: 2, minHeight: 0 }}>
        <DdlPreviewPanel
          result={ddl}
          onApply={onApplyClick}
          onCancel={onCancel}
          canApply={canApply}
          banner={banner}
          showErrors={touched}
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

export { FunctionPicker } from "./FunctionPicker";
