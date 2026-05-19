// — RangeTypeEditor (B3.8).

import { type JSX, useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { schemaGetCustomTypeDefinition } from "../../../lib/tauri";
import type { ObjectEditorTab } from "../../editor/store";
import { DdlPreviewPanel } from "../TableEditor/DdlPreviewPanel";
import { HelpLink } from "../TableEditor/HelpLink";
import { formStateDirty } from "../TableEditor/dirty";
import { generateTypeDdl } from "../ddl/typeDdl";
import type { RangeTypeForm } from "../ddl/types";
import { fromDefinition } from "../introspect/typeState";
import { ObjectEditorApplyConfirm } from "../shared/ObjectEditorApplyConfirm";
import { applyAndRefresh } from "../shared/applyAndRefresh";
import { useTouched } from "../shared/useTouched";
import { useObjectEditorStore } from "../store";

export interface RangeTypeEditorProps {
  tab: ObjectEditorTab;
}

function blankForm(schema: string): RangeTypeForm {
  return { schema, name: "", subtype: "", comment: null };
}

export function RangeTypeEditor({ tab }: RangeTypeEditorProps): JSX.Element {
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
        kind: "range_type",
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
        if (union.kind !== "range") {
          setLoadError(`Expected range type, got ${union.kind}`);
          return;
        }
        setForm(tab.id, { kind: "range_type", form: union.form, initial: union.form });
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
    (mutator: (f: RangeTypeForm) => RangeTypeForm): void => {
      updateForm(tab.id, (s) => (s.kind === "range_type" ? { ...s, form: mutator(s.form) } : s));
    },
    [tab.id, updateForm],
  );

  const stableFormState = formState && formState.kind === "range_type" ? formState : null;
  const deferredCurrent = useDeferredValue(stableFormState?.form ?? null);
  const deferredInitial = useDeferredValue(stableFormState?.initial ?? null);
  const ddl = useMemo(() => {
    if (!deferredCurrent) return null;
    return generateTypeDdl({
      kind: "range",
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
      <div data-testid="range-type-editor-load-error" role="alert" style={{ padding: 16 }}>
        {t("object_editor.common.load_error")}: {loadError}
      </div>
    );
  }
  if (!stableFormState || !ddl) {
    return (
      <div data-testid="range-type-editor-loading" style={{ padding: 16 }}>
        {t("object_editor.common.loading")}
      </div>
    );
  }

  const form = stableFormState.form;
  const canApply =
    ddl.errors.length === 0 &&
    ddl.sql.trim().length > 0 &&
    form.name.trim().length > 0 &&
    form.subtype.trim().length > 0;
  const statementCount = ddl.sql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0).length;

  const onCancel = (): void => {
    // reset form, keep tab open.
    if (stableFormState.initial !== null) {
      setForm(tab.id, {
        kind: "range_type",
        form: stableFormState.initial,
        initial: stableFormState.initial,
      });
    } else {
      setForm(tab.id, {
        kind: "range_type",
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
      data-testid="range-type-editor"
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
            ? t("object_editor.type.range_title_new")
            : t("object_editor.type.range_title_edit")}
        </h2>
        {dirty ? (
          <span
            data-testid="range-dirty-badge"
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
        <HelpLink topic="range_type" />
      </div>

      <div style={{ overflow: "auto", padding: 16, display: "grid", gap: 14, minWidth: 0 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12 }}>
          <div className="q-field">
            <label htmlFor={`range-schema-${tab.id}`}>{t("object_editor.common.schema")}</label>
            <input
              id={`range-schema-${tab.id}`}
              data-testid="range-schema"
              className="q-input"
              value={form.schema}
              onChange={(e) => onChange((f) => ({ ...f, schema: e.target.value }))}
            />
          </div>
          <div className="q-field">
            <label htmlFor={`range-name-${tab.id}`}>{t("object_editor.common.name")}</label>
            <input
              id={`range-name-${tab.id}`}
              data-testid="range-name"
              className="q-input"
              value={form.name}
              onChange={(e) => onChange((f) => ({ ...f, name: e.target.value }))}
            />
          </div>
        </div>

        <div className="q-field">
          <label htmlFor={`range-subtype-${tab.id}`}>
            {t("object_editor.type.range_subtype_label")}
          </label>
          <input
            id={`range-subtype-${tab.id}`}
            data-testid="range-subtype"
            className="q-input mono"
            value={form.subtype}
            onChange={(e) => onChange((f) => ({ ...f, subtype: e.target.value }))}
          />
        </div>
        <div className="q-field">
          <label htmlFor={`range-subtype-opclass-${tab.id}`}>
            {t("object_editor.type.range_subtype_opclass_label")}
          </label>
          <input
            id={`range-subtype-opclass-${tab.id}`}
            data-testid="range-subtype-opclass"
            className="q-input mono"
            value={form.subtypeOpclass ?? ""}
            onChange={(e) =>
              onChange((f) => ({
                ...f,
                subtypeOpclass: e.target.value === "" ? undefined : e.target.value,
              }))
            }
          />
        </div>
        <div className="q-field">
          <label htmlFor={`range-collation-${tab.id}`}>
            {t("object_editor.type.range_collation_label")}
          </label>
          <input
            id={`range-collation-${tab.id}`}
            data-testid="range-collation"
            className="q-input"
            value={form.collation ?? ""}
            onChange={(e) =>
              onChange((f) => ({
                ...f,
                collation: e.target.value === "" ? undefined : e.target.value,
              }))
            }
          />
        </div>
        <div className="q-field">
          <label htmlFor={`range-canonical-${tab.id}`}>
            {t("object_editor.type.range_canonical_label")}
          </label>
          <input
            id={`range-canonical-${tab.id}`}
            data-testid="range-canonical"
            className="q-input mono"
            value={form.canonical ?? ""}
            onChange={(e) =>
              onChange((f) => ({
                ...f,
                canonical: e.target.value === "" ? undefined : e.target.value,
              }))
            }
          />
        </div>
        <div className="q-field">
          <label htmlFor={`range-subtype-diff-${tab.id}`}>
            {t("object_editor.type.range_subtype_diff_label")}
          </label>
          <input
            id={`range-subtype-diff-${tab.id}`}
            data-testid="range-subtype-diff"
            className="q-input mono"
            value={form.subtypeDiff ?? ""}
            onChange={(e) =>
              onChange((f) => ({
                ...f,
                subtypeDiff: e.target.value === "" ? undefined : e.target.value,
              }))
            }
          />
        </div>
        <div className="q-field">
          <label htmlFor={`range-multirange-${tab.id}`}>
            {t("object_editor.type.range_multirange_type_name_label")}
          </label>
          <input
            id={`range-multirange-${tab.id}`}
            data-testid="range-multirange"
            className="q-input mono"
            value={form.multirangeTypeName ?? ""}
            onChange={(e) =>
              onChange((f) => ({
                ...f,
                multirangeTypeName: e.target.value === "" ? undefined : e.target.value,
              }))
            }
          />
        </div>
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
