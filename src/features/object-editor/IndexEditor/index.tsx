// — IndexEditor (B3.T2). Standalone form for create/edit index.

import { type JSX, useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { schemaGetIndexDefinition } from "../../../lib/tauri";
import type { ObjectEditorTab } from "../../editor/store";
import { VectorIndexWizard, isPgvectorInstalled } from "../../pgvector";
import { DdlPreviewPanel } from "../TableEditor/DdlPreviewPanel";
import { HelpLink } from "../TableEditor/HelpLink";
import { blankIndexForm } from "../TableEditor/blank";
import { formStateDirty } from "../TableEditor/dirty";
import { generateIndexDdl } from "../ddl/indexDdl";
import type { IndexForm } from "../ddl/types";
import { ObjectEditorApplyConfirm } from "../shared/ObjectEditorApplyConfirm";
import { applyAndRefresh } from "../shared/applyAndRefresh";
import { useTouched } from "../shared/useTouched";
import { useObjectEditorStore } from "../store";
import { IndexFormPanel } from "./IndexFormPanel";

export { IndexFormPanel };

export interface IndexEditorProps {
  tab: ObjectEditorTab;
}

function indexFormFromDef(def: {
  schema: string;
  name: string;
  table: string;
  method: string;
  unique: boolean;
  columns: string[];
  include: string[];
  predicate: string | null;
}): IndexForm {
  const method =
    (["btree", "hash", "gin", "gist", "brin", "spgist"] as const).find((m) => m === def.method) ??
    "btree";
  return {
    id: crypto.randomUUID(),
    name: def.name,
    schema: def.schema,
    table: def.table,
    method,
    unique: def.unique,
    columns: def.columns.map((expr) => ({ expr })),
    include: def.include,
    predicate: def.predicate,
    withOptions: {},
  };
}

export function IndexEditor({ tab }: IndexEditorProps): JSX.Element {
  const { t } = useTranslation();
  const formState = useObjectEditorStore((s) => s.formByTab[tab.id]);
  const apply = useObjectEditorStore((s) => s.applyByTab[tab.id]);
  const setForm = useObjectEditorStore((s) => s.setForm);
  const updateForm = useObjectEditorStore((s) => s.updateForm);
  const setApply = useObjectEditorStore((s) => s.setApply);
  const clearTab = useObjectEditorStore((s) => s.clearTab);

  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pgvectorAvailable, setPgvectorAvailable] = useState<boolean | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void isPgvectorInstalled(tab.connectionId).then((ok) => {
      if (!cancelled) setPgvectorAvailable(ok);
    });
    return () => {
      cancelled = true;
    };
  }, [tab.connectionId]);

  useEffect(() => {
    let cancelled = false;
    const existing = useObjectEditorStore.getState().formByTab[tab.id];
    if (existing) return;
    if (tab.target.mode === "create") {
      const blank = blankIndexForm(tab.target.schema, tab.target.parentTable ?? "");
      setForm(tab.id, { kind: "index", form: blank, initial: null });
      return;
    }
    void (async () => {
      try {
        const def = await schemaGetIndexDefinition(
          tab.connectionId,
          tab.target.schema,
          tab.target.name ?? "",
        );
        if (cancelled) return;
        const form = indexFormFromDef(def);
        setForm(tab.id, { kind: "index", form, initial: form });
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
    (mutator: (f: IndexForm) => IndexForm): void => {
      updateForm(tab.id, (s) => (s.kind === "index" ? { ...s, form: mutator(s.form) } : s));
    },
    [tab.id, updateForm],
  );

  const stableFormState = formState && formState.kind === "index" ? formState : null;
  const deferredCurrent = useDeferredValue(stableFormState?.form ?? null);
  const deferredInitial = useDeferredValue(stableFormState?.initial ?? null);
  const ddl = useMemo(() => {
    if (!deferredCurrent) return null;
    return generateIndexDdl(deferredInitial ?? null, deferredCurrent);
  }, [deferredCurrent, deferredInitial]);
  const dirty = stableFormState
    ? formStateDirty(stableFormState.initial, stableFormState.form)
    : false;
  const touched = useTouched(stableFormState?.form, stableFormState?.initial);

  if (loadError) {
    return (
      <div data-testid="index-editor-load-error" role="alert" style={{ padding: 16 }}>
        {t("object_editor.common.load_error")}: {loadError}
      </div>
    );
  }
  if (!stableFormState || !ddl) {
    return (
      <div data-testid="index-editor-loading" style={{ padding: 16 }}>
        {t("object_editor.common.loading")}
      </div>
    );
  }

  const form = stableFormState.form;
  const recreating =
    stableFormState.initial !== null &&
    (stableFormState.initial.method !== form.method ||
      JSON.stringify(stableFormState.initial.columns) !== JSON.stringify(form.columns) ||
      stableFormState.initial.predicate !== form.predicate ||
      JSON.stringify(stableFormState.initial.include) !== JSON.stringify(form.include));
  const canApply =
    ddl.errors.length === 0 &&
    ddl.sql.trim().length > 0 &&
    form.name.trim().length > 0 &&
    form.table.trim().length > 0;

  const onCancel = (): void => {
    // reset form, keep tab open.
    if (stableFormState.initial !== null) {
      setForm(tab.id, {
        kind: "index",
        form: stableFormState.initial,
        initial: stableFormState.initial,
      });
    } else {
      setForm(tab.id, {
        kind: "index",
        form: blankIndexForm(tab.target.schema, tab.target.parentTable ?? ""),
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
      data-testid="index-editor"
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
          <label htmlFor={`index-schema-${tab.id}`}>{t("object_editor.common.schema")}</label>
          <input
            id={`index-schema-${tab.id}`}
            data-testid="index-schema"
            className="q-input"
            value={form.schema}
            onChange={(e) => onChange((f) => ({ ...f, schema: e.target.value }))}
          />
        </div>
        {dirty ? (
          <span
            data-testid="index-dirty-badge"
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
        {pgvectorAvailable === true ? (
          <button
            type="button"
            data-testid="index-vector-wizard-button"
            onClick={() => setWizardOpen(true)}
            className="btn"
            style={{ marginBottom: 4 }}
          >
            Vector index wizard…
          </button>
        ) : null}
        <div style={{ paddingBottom: 4 }}>
          <HelpLink topic="index" />
        </div>
      </div>
      <div style={{ overflow: "auto", padding: 12 }}>
        {recreating ? (
          <div
            // biome-ignore lint/a11y/useSemanticElements: passive banner; not a form <output>.
            role="status"
            data-testid="index-recreate-warning"
            style={{
              padding: "6px 12px",
              background: "var(--accent-soft, rgba(212,155,28,0.08))",
              border: "1px solid var(--hairline)",
              borderRadius: 4,
              fontSize: 12,
              marginBottom: 8,
            }}
          >
            {t("object_editor.indexes.recreate_warning")}
          </div>
        ) : null}
        <IndexFormPanel form={form} onChange={onChange} />
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
        statementCount={ddl.sql.split(";").filter((s) => s.trim().length > 0).length}
        connId={tab.connectionId}
        ddl={ddl.sql}
        onConfirm={doApply}
        onCancel={() => setConfirmOpen(false)}
      />
      <VectorIndexWizard
        open={wizardOpen}
        rowCount={0}
        dim={0}
        onCancel={() => setWizardOpen(false)}
        onApply={(patch) => {
          onChange((f) => ({ ...f, method: patch.method, withOptions: patch.withOptions }));
          setWizardOpen(false);
        }}
      />
    </div>
  );
}
