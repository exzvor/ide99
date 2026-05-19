// — EnumTypeEditor (B3.5).
//
// Form body: schema + name + values list (one input per row + delete) +
// "+ Add value" button + DDL preview + Apply/Cancel footer. The DDL
// generator detects reorder/rename and surfaces a DROP+CREATE warning;
// the editor itself just edits the form.

import { type JSX, useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { schemaGetCustomTypeDefinition } from "../../../lib/tauri";
import type { ObjectEditorTab } from "../../editor/store";
import { DdlPreviewPanel } from "../TableEditor/DdlPreviewPanel";
import { HelpLink } from "../TableEditor/HelpLink";
import { formStateDirty } from "../TableEditor/dirty";
import { generateTypeDdl } from "../ddl/typeDdl";
import type { EnumTypeForm } from "../ddl/types";
import { fromDefinition } from "../introspect/typeState";
import { ObjectEditorApplyConfirm } from "../shared/ObjectEditorApplyConfirm";
import { applyAndRefresh } from "../shared/applyAndRefresh";
import { useTouched } from "../shared/useTouched";
import { useObjectEditorStore } from "../store";

export interface EnumTypeEditorProps {
  tab: ObjectEditorTab;
}

let counter = 0;
const newId = (): string => `s25-enum-val-${Date.now()}-${++counter}`;

function blankForm(schema: string): EnumTypeForm {
  return { schema, name: "", values: [], comment: null };
}

export function EnumTypeEditor({ tab }: EnumTypeEditorProps): JSX.Element {
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
        kind: "enum_type",
        form: blankForm(tab.target.schema),
        initial: null,
      });
      return;
    }
    void (async () => {
      try {
        const def = await schemaGetCustomTypeDefinition(
          tab.connectionId,
          tab.target.schema,
          tab.target.name ?? "",
        );
        if (cancelled) return;
        const union = fromDefinition(def);
        if (union.kind !== "enum") {
          setLoadError(`Expected enum type, got ${union.kind}`);
          return;
        }
        setForm(tab.id, { kind: "enum_type", form: union.form, initial: union.form });
      } catch (err) {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab.id, tab.connectionId, tab.target.mode, tab.target.schema, tab.target.name, setForm]);

  useEffect(() => {
    return () => {
      clearTab(tab.id);
    };
  }, [tab.id, clearTab]);

  const onChange = useCallback(
    (mutator: (f: EnumTypeForm) => EnumTypeForm): void => {
      updateForm(tab.id, (s) => (s.kind === "enum_type" ? { ...s, form: mutator(s.form) } : s));
    },
    [tab.id, updateForm],
  );

  const stableFormState = formState && formState.kind === "enum_type" ? formState : null;
  const deferredCurrent = useDeferredValue(stableFormState?.form ?? null);
  const deferredInitial = useDeferredValue(stableFormState?.initial ?? null);
  const ddl = useMemo(() => {
    if (!deferredCurrent) return null;
    return generateTypeDdl({
      kind: "enum",
      form: deferredCurrent,
      initial: deferredInitial ?? null,
    });
  }, [deferredCurrent, deferredInitial]);
  const dirty = stableFormState
    ? formStateDirty(stableFormState.initial, stableFormState.form)
    : false;
  const touched = useTouched(stableFormState?.form, stableFormState?.initial);

  if (loadError) {
    return (
      <div data-testid="enum-type-editor-load-error" role="alert" style={{ padding: 16 }}>
        {t("object_editor.common.load_error")}: {loadError}
      </div>
    );
  }
  if (!stableFormState || !ddl) {
    return (
      <div data-testid="enum-type-editor-loading" style={{ padding: 16 }}>
        {t("object_editor.common.loading")}
      </div>
    );
  }

  const form = stableFormState.form;
  const canApply =
    ddl.errors.length === 0 && ddl.sql.trim().length > 0 && form.name.trim().length > 0;
  const statementCount = ddl.sql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0).length;

  const onCancel = (): void => {
    // reset form, keep tab open.
    if (stableFormState.initial !== null) {
      setForm(tab.id, {
        kind: "enum_type",
        form: stableFormState.initial,
        initial: stableFormState.initial,
      });
    } else {
      setForm(tab.id, {
        kind: "enum_type",
        form: blankForm(tab.target.schema),
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

  return (
    <div
      data-testid="enum-type-editor"
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
          alignItems: "center",
          padding: 12,
          borderBottom: "1px solid var(--hairline)",
        }}
      >
        <h2 style={{ fontSize: 14, margin: 0 }}>
          {tab.target.mode === "create"
            ? t("object_editor.type.enum_title_new")
            : t("object_editor.type.enum_title_edit")}
        </h2>
        {dirty ? (
          <span
            data-testid="enum-dirty-badge"
            style={{
              fontSize: 11,
              color: "var(--accent)",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            ● {t("object_editor.common.dirty")}
          </span>
        ) : null}
        <div style={{ flex: 1 }} />
        <HelpLink topic="enum_type" />
      </div>

      <div style={{ overflow: "auto", padding: 16, display: "grid", gap: 14, minWidth: 0 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12 }}>
          <div className="q-field">
            <label htmlFor={`enum-schema-${tab.id}`}>{t("object_editor.common.schema")}</label>
            <input
              id={`enum-schema-${tab.id}`}
              data-testid="enum-schema"
              className="q-input"
              value={form.schema}
              onChange={(e) => onChange((f) => ({ ...f, schema: e.target.value }))}
            />
          </div>
          <div className="q-field">
            <label htmlFor={`enum-name-${tab.id}`}>{t("object_editor.common.name")}</label>
            <input
              id={`enum-name-${tab.id}`}
              data-testid="enum-name"
              className="q-input"
              value={form.name}
              onChange={(e) => onChange((f) => ({ ...f, name: e.target.value }))}
            />
          </div>
        </div>

        <fieldset
          data-testid="enum-values-fieldset"
          style={{
            border: "1px solid var(--border-strong-q)",
            borderRadius: "var(--r-md)",
            padding: 12,
            margin: 0,
            display: "grid",
            gap: 8,
          }}
        >
          <legend
            style={{ fontSize: 11.5, fontWeight: 500, color: "var(--ink-3)", padding: "0 6px" }}
          >
            {t("object_editor.type.enum_values_section")}
          </legend>
          {form.values.map((v, i) => (
            <div
              key={v.id}
              data-testid={`enum-value-${i}`}
              style={{ display: "flex", gap: 8, alignItems: "center" }}
            >
              <input
                value={v.value}
                className="q-input mono"
                placeholder={t("object_editor.type.enum_value_label")}
                data-testid={`enum-value-${i}-input`}
                onChange={(e) =>
                  onChange((f) => ({
                    ...f,
                    values: f.values.map((it) =>
                      it.id === v.id ? { ...it, value: e.target.value } : it,
                    ),
                  }))
                }
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className="btn-ghost"
                data-testid={`enum-value-${i}-remove`}
                onClick={() =>
                  onChange((f) => ({ ...f, values: f.values.filter((it) => it.id !== v.id) }))
                }
                aria-label="Remove value"
                style={{ width: 28, height: 28, padding: 0, fontSize: 16 }}
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            data-testid="enum-values-add"
            className="btn"
            onClick={() =>
              onChange((f) => ({ ...f, values: [...f.values, { id: newId(), value: "" }] }))
            }
            style={{ alignSelf: "start" }}
          >
            + {t("object_editor.type.enum_add_value")}
          </button>
        </fieldset>
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
