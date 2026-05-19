// — ProcedureEditor (B3.T2).
//
// Same shape as FunctionEditor minus return type form, no cost/rows fields,
// no volatility/parallel safety. SECURITY DEFINER toggle still present.

import { type JSX, useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { schemaGetProcedureDefinition } from "../../../lib/tauri";
import type { ProcedureDefinition } from "../../../lib/tauri";
import type { ObjectEditorTab } from "../../editor/store";
import { BodyEditor } from "../FunctionEditor/BodyEditor";
import { ParametersList } from "../FunctionEditor/ParametersList";
import { DdlPreviewPanel } from "../TableEditor/DdlPreviewPanel";
import { HelpLink } from "../TableEditor/HelpLink";
import { formStateDirty } from "../TableEditor/dirty";
import { generateProcedureDdl } from "../ddl/procedureDdl";
import type { FunctionLanguage, ProcedureForm } from "../ddl/types";
import { ObjectEditorApplyConfirm } from "../shared/ObjectEditorApplyConfirm";
import { applyAndRefresh } from "../shared/applyAndRefresh";
import { useTouched } from "../shared/useTouched";
import { useObjectEditorStore } from "../store";

export interface ProcedureEditorProps {
  tab: ObjectEditorTab;
}

function blankProcedureForm(schema: string): ProcedureForm {
  return {
    schema,
    name: "",
    language: "plpgsql",
    parameters: [],
    body: "",
    securityDefiner: false,
    comment: null,
  };
}

// TODO(B3->B4 integrate): swap for `fromDefinition` from
// `../introspect/procedureState.ts` once B4 lands.
function localProcedureFromDefinition(def: ProcedureDefinition): ProcedureForm {
  const lang = def.language === "sql" || def.language === "plpgsql" ? def.language : "other";
  return {
    schema: def.schema,
    name: def.name,
    language: lang as FunctionLanguage,
    languageOther: lang === "other" ? def.language : undefined,
    parameters: def.parameters.map((p) => ({
      id: crypto.randomUUID(),
      name: p.name,
      mode: p.mode,
      type: p.typeText,
      default: p.default,
    })),
    body: def.body,
    securityDefiner: def.securityDefiner,
    comment: def.comment,
  };
}

export function ProcedureEditor({ tab }: ProcedureEditorProps): JSX.Element {
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
        kind: "procedure",
        form: blankProcedureForm(tab.target.schema),
        initial: null,
      });
      return;
    }
    void (async () => {
      try {
        const procArgs = tab.target.parentTable ?? "";
        const def = await schemaGetProcedureDefinition(
          tab.connectionId,
          tab.target.schema,
          tab.target.name ?? "",
          procArgs,
        );
        if (cancelled) return;
        let form: ProcedureForm;
        try {
          const mod = (await import("../introspect/procedureState").catch(() => null)) as {
            fromDefinition?: (d: ProcedureDefinition) => ProcedureForm;
          } | null;
          form = mod?.fromDefinition ? mod.fromDefinition(def) : localProcedureFromDefinition(def);
        } catch {
          form = localProcedureFromDefinition(def);
        }
        if (cancelled) return;
        setForm(tab.id, { kind: "procedure", form, initial: form });
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

  const onChange = useCallback(
    (mutator: (f: ProcedureForm) => ProcedureForm): void => {
      updateForm(tab.id, (s) => (s.kind === "procedure" ? { ...s, form: mutator(s.form) } : s));
    },
    [tab.id, updateForm],
  );

  const stableFormState = formState && formState.kind === "procedure" ? formState : null;
  const deferredCurrent = useDeferredValue(stableFormState?.form ?? null);
  const deferredInitial = useDeferredValue(stableFormState?.initial ?? null);
  const ddl = useMemo(() => {
    if (!deferredCurrent) return null;
    return generateProcedureDdl(deferredInitial ?? null, deferredCurrent);
  }, [deferredCurrent, deferredInitial]);
  const dirty = stableFormState
    ? formStateDirty(stableFormState.initial, stableFormState.form)
    : false;
  const touched = useTouched(stableFormState?.form, stableFormState?.initial);

  if (loadError) {
    return (
      <div data-testid="procedure-editor-load-error" role="alert" style={{ padding: 16 }}>
        {t("object_editor.common.load_error")}: {loadError}
      </div>
    );
  }
  if (!stableFormState || !ddl) {
    return (
      <div data-testid="procedure-editor-loading" style={{ padding: 16 }}>
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
        kind: "procedure",
        form: stableFormState.initial,
        initial: stableFormState.initial,
      });
    } else {
      setForm(tab.id, {
        kind: "procedure",
        form: blankProcedureForm(tab.target.schema),
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
      data-testid="procedure-editor"
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
          <label htmlFor={`proc-schema-${tab.id}`}>
            {t("object_editor.procedure.schema_label")}
          </label>
          <input
            id={`proc-schema-${tab.id}`}
            data-testid="proc-schema"
            className="q-input"
            value={form.schema}
            onChange={(e) => onChange((f) => ({ ...f, schema: e.target.value }))}
          />
        </div>
        <div className="q-field" style={{ width: 260 }}>
          <label htmlFor={`proc-name-${tab.id}`}>{t("object_editor.procedure.name_label")}</label>
          <input
            id={`proc-name-${tab.id}`}
            data-testid="proc-name"
            className="q-input"
            value={form.name}
            onChange={(e) => onChange((f) => ({ ...f, name: e.target.value }))}
          />
        </div>
        {dirty ? (
          <span
            data-testid="proc-dirty-badge"
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
          <HelpLink topic="procedure" />
        </div>
      </div>

      <div style={{ overflow: "auto", padding: 12, display: "grid", gap: 16, minWidth: 0 }}>
        <section data-testid="proc-section-language" style={{ display: "grid", gap: 6 }}>
          <label style={{ fontSize: 12, display: "flex", gap: 8, alignItems: "center" }}>
            {t("object_editor.procedure.language_label")}
            <select
              data-testid="proc-language"
              value={form.language}
              onChange={(e) =>
                onChange((f) => ({ ...f, language: e.target.value as FunctionLanguage }))
              }
              style={{ padding: "4px 6px", fontSize: 12 }}
            >
              <option value="sql">{t("object_editor.procedure.languages_sql")}</option>
              <option value="plpgsql">{t("object_editor.procedure.languages_plpgsql")}</option>
              <option value="other">{t("object_editor.procedure.languages_other")}</option>
            </select>
            {form.language === "other" ? (
              <input
                data-testid="proc-language-other"
                value={form.languageOther ?? ""}
                placeholder={t("object_editor.procedure.language_other_placeholder")}
                onChange={(e) => onChange((f) => ({ ...f, languageOther: e.target.value }))}
                style={{ padding: "4px 6px", fontSize: 12 }}
              />
            ) : null}
          </label>
        </section>

        <section data-testid="proc-section-parameters" style={{ display: "grid", gap: 6 }}>
          <h4 style={{ margin: 0, fontSize: 13 }}>
            {t("object_editor.procedure.parameters_section")}
          </h4>
          <ParametersList
            parameters={form.parameters}
            onChange={(parameters) => onChange((f) => ({ ...f, parameters }))}
            testIdPrefix="proc-param"
          />
        </section>

        <section data-testid="proc-section-body" style={{ display: "grid", gap: 6 }}>
          <h4 style={{ margin: 0, fontSize: 13 }}>{t("object_editor.procedure.body_section")}</h4>
          <BodyEditor
            value={form.body}
            onChange={(body) => onChange((f) => ({ ...f, body }))}
            language={form.language}
            languageOther={form.languageOther}
          />
        </section>

        <section data-testid="proc-section-attributes" style={{ display: "grid", gap: 8 }}>
          <h4 style={{ margin: 0, fontSize: 13 }}>
            {t("object_editor.procedure.attributes_section")}
          </h4>
          <label style={{ fontSize: 12 }}>
            <input
              data-testid="proc-security-definer"
              type="checkbox"
              checked={form.securityDefiner}
              onChange={(e) => onChange((f) => ({ ...f, securityDefiner: e.target.checked }))}
            />{" "}
            {t("object_editor.procedure.security_definer")}
          </label>
          <label style={{ fontSize: 12, display: "flex", flexDirection: "column" }}>
            {t("object_editor.procedure.comment_label")}
            <textarea
              data-testid="proc-comment"
              value={form.comment ?? ""}
              onChange={(e) =>
                onChange((f) => ({
                  ...f,
                  comment: e.target.value.trim() === "" ? null : e.target.value,
                }))
              }
              rows={2}
              style={{ padding: "4px 6px", fontSize: 12 }}
            />
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
