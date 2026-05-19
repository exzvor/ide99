// — FunctionEditor (B3.T1).
//
// Layout (mirrors TableEditor): header (schema/name + dirty + HelpLink) — body
// (form sections: language, parameters, return, body, attributes) — sticky
// right pane (DDL preview + Apply/Cancel footer).
//
// On mount: edit-mode → schemaGetFunctionDefinition + fromDefinition (B4
// sibling — falls back to a local minimal transform when the module hasn't
// shipped yet). create-mode → blank form. Unmount: clearTab.

import { type JSX, useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { schemaGetFunctionDefinition } from "../../../lib/tauri";
import type { FunctionDefinition } from "../../../lib/tauri";
import type { ObjectEditorTab } from "../../editor/store";
import { DdlPreviewPanel } from "../TableEditor/DdlPreviewPanel";
import { HelpLink } from "../TableEditor/HelpLink";
import { formStateDirty } from "../TableEditor/dirty";
import { generateFunctionDdl } from "../ddl/functionDdl";
import type { FunctionForm, FunctionLanguage, ParallelSafety, Volatility } from "../ddl/types";
import { ObjectEditorApplyConfirm } from "../shared/ObjectEditorApplyConfirm";
import { applyAndRefresh } from "../shared/applyAndRefresh";
import { useTouched } from "../shared/useTouched";
import { useObjectEditorStore } from "../store";
import { BodyEditor } from "./BodyEditor";
import { ParametersList } from "./ParametersList";
import { ReturnTypeForm } from "./ReturnTypeForm";

export interface FunctionEditorProps {
  tab: ObjectEditorTab;
}

function blankFunctionForm(schema: string): FunctionForm {
  return {
    schema,
    name: "",
    language: "plpgsql",
    parameters: [],
    returnKind: "scalar",
    returnType: "integer",
    body: "",
    volatility: "volatile",
    parallelSafety: "unsafe",
    securityDefiner: false,
    cost: null,
    estimatedRows: null,
    comment: null,
  };
}

// TODO(B3->B4 integrate): swap for `fromDefinition` from
// `../introspect/functionState.ts` once B4 lands. This minimal local
// transform keeps the editor self-contained meanwhile.
function localFunctionFromDefinition(def: FunctionDefinition): FunctionForm {
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
    returnKind: def.returnKind,
    returnType: def.returnType ?? undefined,
    body: def.body,
    volatility: def.volatility,
    parallelSafety: def.parallelSafety,
    securityDefiner: def.securityDefiner,
    cost: def.cost,
    estimatedRows: def.estimatedRows,
    comment: def.comment,
  };
}

function parseNullableInt(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function FunctionEditor({ tab }: FunctionEditorProps): JSX.Element {
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
        kind: "function",
        form: blankFunctionForm(tab.target.schema),
        initial: null,
      });
      return;
    }
    void (async () => {
      try {
        // Overload signature is stuffed into `parentTable` by the toolbar;
        // empty string ⇒ zero-arg lookup.
        const fnArgs = tab.target.parentTable ?? "";
        const def = await schemaGetFunctionDefinition(          tab.connectionId,
          tab.target.schema,
          tab.target.name ?? "",
          fnArgs,
);
        if (cancelled) return;
        let form: FunctionForm;
        try {
          // Prefer B4 transform when present.
          const mod = (await import("../introspect/functionState").catch(() => null)) as {
            fromDefinition?: (d: FunctionDefinition) => FunctionForm;
          } | null;
          form = mod?.fromDefinition ? mod.fromDefinition(def) : localFunctionFromDefinition(def);
        } catch {
          form = localFunctionFromDefinition(def);
        }
        if (cancelled) return;
        setForm(tab.id, { kind: "function", form, initial: form });
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

  const onChange = useCallback(    (mutator: (f: FunctionForm) => FunctionForm): void => {
      updateForm(tab.id, (s) => (s.kind === "function" ? { ...s, form: mutator(s.form) } : s));
    },
    [tab.id, updateForm],
);

  const stableFormState = formState && formState.kind === "function" ? formState : null;
  const deferredCurrent = useDeferredValue(stableFormState?.form ?? null);
  const deferredInitial = useDeferredValue(stableFormState?.initial ?? null);
  const ddl = useMemo(() => {
    if (!deferredCurrent) return null;
    return generateFunctionDdl(deferredInitial ?? null, deferredCurrent);
  }, [deferredCurrent, deferredInitial]);
  const dirty = stableFormState
    ? formStateDirty(stableFormState.initial, stableFormState.form)
    : false;
  // Hide required-field errors ("Function name is required" etc.) until the
  // user has actually interacted with the form — otherwise a freshly-opened
  // create tab pre-screams at the user.
  const touched = useTouched(stableFormState?.form, stableFormState?.initial);

  if (loadError) {
    return (      <div data-testid="function-editor-load-error" role="alert" style={{ padding: 16 }}>
        {t("object_editor.common.load_error")}: {loadError}
      </div>
);
  }
  if (!stableFormState || !ddl) {
    return (      <div data-testid="function-editor-loading" style={{ padding: 16 }}>
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
        kind: "function",
        form: stableFormState.initial,
        initial: stableFormState.initial,
      });
    } else {
      setForm(tab.id, {
        kind: "function",
        form: blankFunctionForm(tab.target.schema),
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
      data-testid="function-editor"
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
          <label htmlFor={`fn-schema-${tab.id}`}>{t("object_editor.function.schema_label")}</label>
          <input
            id={`fn-schema-${tab.id}`}
            data-testid="fn-schema"
            className="q-input"
            value={form.schema}
            onChange={(e) => onChange((f) => ({ ...f, schema: e.target.value }))}
          />
        </div>
        <div className="q-field" style={{ width: 260 }}>
          <label htmlFor={`fn-name-${tab.id}`}>{t("object_editor.function.name_label")}</label>
          <input
            id={`fn-name-${tab.id}`}
            data-testid="fn-name"
            className="q-input"
            value={form.name}
            onChange={(e) => onChange((f) => ({ ...f, name: e.target.value }))}
          />
        </div>
        {dirty ? (          <span
            data-testid="fn-dirty-badge"
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
          <HelpLink topic="function" />
        </div>
      </div>

      <div style={{ overflow: "auto", padding: 16, display: "grid", gap: 18, minWidth: 0 }}>
        {/* Language */}
        <section
          data-testid="fn-section-language"
          style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}
        >
          <div className="q-field" style={{ width: 200 }}>
            <label htmlFor={`fn-language-${tab.id}`}>
              {t("object_editor.function.language_label")}
            </label>
            <select
              id={`fn-language-${tab.id}`}
              data-testid="fn-language"
              className="q-select"
              value={form.language}
              onChange={(e) =>
                onChange((f) => ({ ...f, language: e.target.value as FunctionLanguage }))
              }
            >
              <option value="sql">{t("object_editor.function.languages_sql")}</option>
              <option value="plpgsql">{t("object_editor.function.languages_plpgsql")}</option>
              <option value="other">{t("object_editor.function.languages_other")}</option>
            </select>
          </div>
          {form.language === "other" ? (            <div className="q-field" style={{ width: 220 }}>
              <label htmlFor={`fn-language-other-${tab.id}`}>
                {t("object_editor.function.languages_other")}
              </label>
              <input
                id={`fn-language-other-${tab.id}`}
                data-testid="fn-language-other"
                className="q-input"
                value={form.languageOther ?? ""}
                placeholder={t("object_editor.function.language_other_placeholder")}
                onChange={(e) => onChange((f) => ({ ...f, languageOther: e.target.value }))}
              />
            </div>
) : null}
        </section>

        {/* Parameters */}
        <section data-testid="fn-section-parameters" style={{ display: "grid", gap: 6 }}>
          <h4 style={{ margin: 0, fontSize: 13 }}>
            {t("object_editor.function.parameters_section")}
          </h4>
          <ParametersList
            parameters={form.parameters}
            onChange={(parameters) => onChange((f) => ({ ...f, parameters }))}
            testIdPrefix="fn-param"
          />
        </section>

        {/* Return type */}
        <section data-testid="fn-section-return" style={{ display: "grid", gap: 6 }}>
          <h4 style={{ margin: 0, fontSize: 13 }}>
            {t("object_editor.function.return_type_section")}
          </h4>
          <ReturnTypeForm
            returnKind={form.returnKind}
            returnType={form.returnType}
            onChange={({ returnKind, returnType }) =>
              onChange((f) => ({ ...f, returnKind, returnType }))
            }
          />
        </section>

        {/* Body */}
        <section data-testid="fn-section-body" style={{ display: "grid", gap: 6 }}>
          <h4 style={{ margin: 0, fontSize: 13 }}>{t("object_editor.function.body_section")}</h4>
          <BodyEditor
            value={form.body}
            onChange={(body) => onChange((f) => ({ ...f, body }))}
            language={form.language}
            languageOther={form.languageOther}
          />
        </section>

        {/* Attributes */}
        <section data-testid="fn-section-attributes" style={{ display: "grid", gap: 12 }}>
          <h4 style={{ margin: 0, fontSize: 13 }}>
            {t("object_editor.function.attributes_section")}
          </h4>
          <div
            style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}
          >
            <div className="q-field">
              <label htmlFor={`fn-volatility-${tab.id}`}>
                {t("object_editor.function.volatility")}
              </label>
              <select
                id={`fn-volatility-${tab.id}`}
                data-testid="fn-volatility"
                className="q-select"
                value={form.volatility}
                onChange={(e) =>
                  onChange((f) => ({ ...f, volatility: e.target.value as Volatility }))
                }
              >
                <option value="volatile">{t("object_editor.function.volatility_volatile")}</option>
                <option value="stable">{t("object_editor.function.volatility_stable")}</option>
                <option value="immutable">
                  {t("object_editor.function.volatility_immutable")}
                </option>
              </select>
            </div>
            <div className="q-field">
              <label htmlFor={`fn-parallel-${tab.id}`}>
                {t("object_editor.function.parallel_safety")}
              </label>
              <select
                id={`fn-parallel-${tab.id}`}
                data-testid="fn-parallel"
                className="q-select"
                value={form.parallelSafety}
                onChange={(e) =>
                  onChange((f) => ({ ...f, parallelSafety: e.target.value as ParallelSafety }))
                }
              >
                <option value="unsafe">{t("object_editor.function.parallel_unsafe")}</option>
                <option value="restricted">
                  {t("object_editor.function.parallel_restricted")}
                </option>
                <option value="safe">{t("object_editor.function.parallel_safe")}</option>
              </select>
            </div>
          </div>
          <label className="q-checkbox" data-testid="fn-security-definer-label">
            <input
              data-testid="fn-security-definer"
              type="checkbox"
              checked={form.securityDefiner}
              onChange={(e) => onChange((f) => ({ ...f, securityDefiner: e.target.checked }))}
            />
            {t("object_editor.function.security_definer")}
          </label>
          <div
            style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}
          >
            <div className="q-field">
              <label htmlFor={`fn-cost-${tab.id}`}>{t("object_editor.function.cost")}</label>
              <input
                id={`fn-cost-${tab.id}`}
                data-testid="fn-cost"
                className="q-input"
                value={form.cost === null ? "" : String(form.cost)}
                placeholder={t("object_editor.function.cost_placeholder")}
                onChange={(e) =>
                  onChange((f) => ({ ...f, cost: parseNullableInt(e.target.value) }))
                }
              />
            </div>
            <div className="q-field">
              <label htmlFor={`fn-rows-${tab.id}`}>{t("object_editor.function.rows")}</label>
              <input
                id={`fn-rows-${tab.id}`}
                data-testid="fn-rows"
                className="q-input"
                value={form.estimatedRows === null ? "" : String(form.estimatedRows)}
                placeholder={t("object_editor.function.rows_placeholder")}
                onChange={(e) =>
                  onChange((f) => ({ ...f, estimatedRows: parseNullableInt(e.target.value) }))
                }
              />
            </div>
          </div>
          <div className="q-field">
            <label htmlFor={`fn-comment-${tab.id}`}>
              {t("object_editor.function.comment_label")}
            </label>
            <textarea
              id={`fn-comment-${tab.id}`}
              data-testid="fn-comment"
              className="q-input"
              value={form.comment ?? ""}
              onChange={(e) =>
                onChange((f) => ({
                  ...f,
                  comment: e.target.value.trim() === "" ? null : e.target.value,
                }))
              }
              rows={2}
              style={{ resize: "vertical", paddingTop: 6, paddingBottom: 6, height: "auto" }}
            />
          </div>
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

// Re-export for tests / sub-component consumers.
export { ParametersList } from "./ParametersList";
export { ReturnTypeForm } from "./ReturnTypeForm";
export { BodyEditor } from "./BodyEditor";
