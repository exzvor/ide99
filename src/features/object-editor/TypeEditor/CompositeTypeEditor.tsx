// — CompositeTypeEditor (B3.6).
//
// Form body: schema + name + fields list (each row: fieldName + typeText +
// optional collation + delete button) + "+ Add field" + DDL preview +
// Apply/Cancel. The DDL generator emits `ALTER TYPE … ADD/DROP/RENAME/ALTER
// ATTRIBUTE` per id-keyed diff.

import { type JSX, useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { schemaGetCustomTypeDefinition } from "../../../lib/tauri";
import type { ObjectEditorTab } from "../../editor/store";
import { DdlPreviewPanel } from "../TableEditor/DdlPreviewPanel";
import { HelpLink } from "../TableEditor/HelpLink";
import { formStateDirty } from "../TableEditor/dirty";
import { generateTypeDdl } from "../ddl/typeDdl";
import type { CompositeTypeForm } from "../ddl/types";
import { fromDefinition } from "../introspect/typeState";
import { ObjectEditorApplyConfirm } from "../shared/ObjectEditorApplyConfirm";
import { applyAndRefresh } from "../shared/applyAndRefresh";
import { useTouched } from "../shared/useTouched";
import { useObjectEditorStore } from "../store";

export interface CompositeTypeEditorProps {
  tab: ObjectEditorTab;
}

let counter = 0;
const newId = (): string => `s25-comp-fld-${Date.now()}-${++counter}`;

function blankForm(schema: string): CompositeTypeForm {
  return { schema, name: "", fields: [], comment: null };
}

export function CompositeTypeEditor({ tab }: CompositeTypeEditorProps): JSX.Element {
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
        kind: "composite_type",
        form: blankForm(tab.target.schema),
        initial: null,
      });
      return;
    }
    void (async () => {
      try {
        const def = await schemaGetCustomTypeDefinition(          tab.connectionId,
          tab.target.schema,
          tab.target.name ?? "",
);
        if (cancelled) return;
        const union = fromDefinition(def);
        if (union.kind !== "composite") {
          setLoadError(`Expected composite type, got ${union.kind}`);
          return;
        }
        setForm(tab.id, { kind: "composite_type", form: union.form, initial: union.form });
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

  const onChange = useCallback(    (mutator: (f: CompositeTypeForm) => CompositeTypeForm): void => {
      updateForm(tab.id, (s) =>
        s.kind === "composite_type" ? { ...s, form: mutator(s.form) } : s,
);
    },
    [tab.id, updateForm],
);

  const stableFormState = formState && formState.kind === "composite_type" ? formState : null;
  const deferredCurrent = useDeferredValue(stableFormState?.form ?? null);
  const deferredInitial = useDeferredValue(stableFormState?.initial ?? null);
  const ddl = useMemo(() => {
    if (!deferredCurrent) return null;
    return generateTypeDdl({
      kind: "composite",
      form: deferredCurrent,
      initial: deferredInitial ?? null,
    });
  }, [deferredCurrent, deferredInitial]);
  const dirty = stableFormState
    ? formStateDirty(stableFormState.initial, stableFormState.form)
    : false;
  const touched = useTouched(stableFormState?.form, stableFormState?.initial);

  if (loadError) {
    return (      <div data-testid="composite-type-editor-load-error" role="alert" style={{ padding: 16 }}>
        {t("object_editor.common.load_error")}: {loadError}
      </div>
);
  }
  if (!stableFormState || !ddl) {
    return (      <div data-testid="composite-type-editor-loading" style={{ padding: 16 }}>
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
        kind: "composite_type",
        form: stableFormState.initial,
        initial: stableFormState.initial,
      });
    } else {
      setForm(tab.id, {
        kind: "composite_type",
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

  return (    <div
      data-testid="composite-type-editor"
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
            ? t("object_editor.type.composite_title_new")
            : t("object_editor.type.composite_title_edit")}
        </h2>
        {dirty ? (          <span
            data-testid="composite-dirty-badge"
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
        <HelpLink topic="composite_type" />
      </div>

      <div style={{ overflow: "auto", padding: 16, display: "grid", gap: 14, minWidth: 0 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12 }}>
          <div className="q-field">
            <label htmlFor={`composite-schema-${tab.id}`}>{t("object_editor.common.schema")}</label>
            <input
              id={`composite-schema-${tab.id}`}
              data-testid="composite-schema"
              className="q-input"
              value={form.schema}
              onChange={(e) => onChange((f) => ({ ...f, schema: e.target.value }))}
            />
          </div>
          <div className="q-field">
            <label htmlFor={`composite-name-${tab.id}`}>{t("object_editor.common.name")}</label>
            <input
              id={`composite-name-${tab.id}`}
              data-testid="composite-name"
              className="q-input"
              value={form.name}
              onChange={(e) => onChange((f) => ({ ...f, name: e.target.value }))}
            />
          </div>
        </div>

        <fieldset
          data-testid="composite-fields-fieldset"
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
            {t("object_editor.type.composite_fields_section")}
          </legend>
          {form.fields.map((field, i) => (            <div
              key={field.id}
              data-testid={`composite-field-${i}`}
              style={{ display: "flex", gap: 8, alignItems: "center" }}
            >
              <input
                value={field.fieldName}
                className="q-input"
                placeholder={t("object_editor.type.composite_field_name")}
                data-testid={`composite-field-${i}-name`}
                onChange={(e) =>
                  onChange((f) => ({
                    ...f,
                    fields: f.fields.map((it) =>
                      it.id === field.id ? { ...it, fieldName: e.target.value } : it,
),
                  }))
                }
                style={{ flex: 1 }}
              />
              <input
                value={field.typeText}
                className="q-input mono"
                placeholder={t("object_editor.type.composite_field_type")}
                data-testid={`composite-field-${i}-type`}
                onChange={(e) =>
                  onChange((f) => ({
                    ...f,
                    fields: f.fields.map((it) =>
                      it.id === field.id ? { ...it, typeText: e.target.value } : it,
),
                  }))
                }
                style={{ flex: 1 }}
              />
              <input
                value={field.collation ?? ""}
                className="q-input mono"
                placeholder={t("object_editor.type.composite_field_collation")}
                data-testid={`composite-field-${i}-collation`}
                onChange={(e) =>
                  onChange((f) => ({
                    ...f,
                    fields: f.fields.map((it) =>
                      it.id === field.id
                        ? { ...it, collation: e.target.value === "" ? undefined : e.target.value }
                        : it,
),
                  }))
                }
                style={{ width: 160 }}
              />
              <button
                type="button"
                className="btn-ghost"
                data-testid={`composite-field-${i}-remove`}
                onClick={() =>
                  onChange((f) => ({
                    ...f,
                    fields: f.fields.filter((it) => it.id !== field.id),
                  }))
                }
                aria-label="Remove field"
                style={{ width: 28, height: 28, padding: 0, fontSize: 16 }}
              >
                ×
              </button>
            </div>
))}
          <button
            type="button"
            data-testid="composite-fields-add"
            className="btn"
            onClick={() =>
              onChange((f) => ({
                ...f,
                fields: [
                  ...f.fields,
                  { id: newId(), fieldName: "", typeText: "", collation: undefined },
                ],
              }))
            }
            style={{ alignSelf: "start" }}
          >
            + {t("object_editor.type.composite_add_field")}
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
