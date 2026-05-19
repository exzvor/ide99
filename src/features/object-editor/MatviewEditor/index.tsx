// — MatviewEditor (B3.T4).

import { type JSX, useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { errorToMessage } from "../../../lib/errors";
import { schemaGetMatviewDefinition } from "../../../lib/tauri";
import type { ObjectEditorTab } from "../../editor/store";
import { DdlPreviewPanel } from "../TableEditor/DdlPreviewPanel";
import { HelpLink } from "../TableEditor/HelpLink";
import { formStateDirty } from "../TableEditor/dirty";
import type { MatviewForm } from "../ddl/types";
import { ObjectEditorApplyConfirm } from "../shared/ObjectEditorApplyConfirm";
import { applyAndRefresh } from "../shared/applyAndRefresh";
import { useTouched } from "../shared/useTouched";
import { useObjectEditorStore } from "../store";
import { generateMatviewDdl } from "./matviewDdl";

export interface MatviewEditorProps {
  tab: ObjectEditorTab;
}

function blankMatviewForm(schema: string): MatviewForm {
  return { schema, name: "", body: "", withData: true };
}

export function MatviewEditor({ tab }: MatviewEditorProps): JSX.Element {
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
        kind: "matview",
        form: blankMatviewForm(tab.target.schema),
        initial: null,
      });
      return;
    }
    void (async () => {
      try {
        const def = await schemaGetMatviewDefinition(          tab.connectionId,
          tab.target.schema,
          tab.target.name ?? "",
);
        if (cancelled) return;
        const form: MatviewForm = {
          schema: def.schema,
          name: def.name,
          body: def.body,
          withData: def.populated,
        };
        setForm(tab.id, { kind: "matview", form, initial: form });
      } catch (err) {
        if (cancelled) return;
        setLoadError(errorToMessage(err));
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

  const onChange = useCallback(    (mutator: (f: MatviewForm) => MatviewForm): void => {
      updateForm(tab.id, (s) => (s.kind === "matview" ? { ...s, form: mutator(s.form) } : s));
    },
    [tab.id, updateForm],
);

  const stableFormState = formState && formState.kind === "matview" ? formState : null;
  const deferredCurrent = useDeferredValue(stableFormState?.form ?? null);
  const deferredInitial = useDeferredValue(stableFormState?.initial ?? null);
  const ddl = useMemo(() => {
    if (!deferredCurrent) return null;
    return generateMatviewDdl(deferredInitial ?? null, deferredCurrent);
  }, [deferredCurrent, deferredInitial]);
  const dirty = stableFormState
    ? formStateDirty(stableFormState.initial, stableFormState.form)
    : false;
  const touched = useTouched(stableFormState?.form, stableFormState?.initial);

  if (loadError) {
    return (      <div data-testid="matview-editor-load-error" role="alert" style={{ padding: 16 }}>
        {t("object_editor.common.load_error")}: {loadError}
      </div>
);
  }
  if (!stableFormState || !ddl) {
    return (      <div data-testid="matview-editor-loading" style={{ padding: 16 }}>
        {t("object_editor.common.loading")}
      </div>
);
  }

  const form = stableFormState.form;
  const recreateWarning =
    stableFormState.initial !== null && stableFormState.initial.body !== form.body;
  const canApply =
    ddl.errors.length === 0 &&
    ddl.sql.trim().length > 0 &&
    form.name.trim().length > 0 &&
    form.body.trim().length > 0;

  const onCancel = (): void => {
    // reset form, keep tab open.
    if (stableFormState.initial !== null) {
      setForm(tab.id, {
        kind: "matview",
        form: stableFormState.initial,
        initial: stableFormState.initial,
      });
    } else {
      setForm(tab.id, {
        kind: "matview",
        form: blankMatviewForm(tab.target.schema),
        initial: null,
      });
    }
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
          message: errorToMessage(err),
        });
      }
    })();
  };
  const banner =
    apply && apply.phase === "error" ? { kind: "error" as const, message: apply.message } : null;

  return (    <div
      data-testid="matview-editor"
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
          <label htmlFor={`matview-schema-${tab.id}`}>{t("object_editor.common.schema")}</label>
          <input
            id={`matview-schema-${tab.id}`}
            data-testid="matview-schema"
            className="q-input"
            value={form.schema}
            onChange={(e) => onChange((f) => ({ ...f, schema: e.target.value }))}
          />
        </div>
        <div className="q-field" style={{ width: 240 }}>
          <label htmlFor={`matview-name-${tab.id}`}>{t("object_editor.common.name")}</label>
          <input
            id={`matview-name-${tab.id}`}
            data-testid="matview-name"
            className="q-input"
            value={form.name}
            onChange={(e) => onChange((f) => ({ ...f, name: e.target.value }))}
          />
        </div>
        <label
          className="q-checkbox"
          style={{ paddingBottom: 6 }}
          data-testid="matview-with-data-label"
        >
          <input
            data-testid="matview-with-data"
            type="checkbox"
            checked={form.withData}
            onChange={(e) => onChange((f) => ({ ...f, withData: e.target.checked }))}
          />
          {t("object_editor.matview.with_data")}
        </label>
        {dirty ? (          <span
            data-testid="matview-dirty-badge"
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
          <HelpLink topic="matview" />
        </div>
      </div>
      <div style={{ overflow: "auto", padding: 12, display: "flex", flexDirection: "column" }}>
        {recreateWarning ? (          <div
            // biome-ignore lint/a11y/useSemanticElements: passive banner; not a form <output>.
            role="status"
            data-testid="matview-recreate-warning"
            style={{
              padding: "6px 12px",
              background: "var(--accent-soft, rgba(212,155,28,0.08))",
              border: "1px solid var(--hairline)",
              borderRadius: 4,
              fontSize: 12,
              marginBottom: 8,
            }}
          >
            {t("object_editor.stub.matview_recreate_warning")}
          </div>
) : null}
        <label
          style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}
          htmlFor={`matview-body-${tab.id}`}
        >
          {t("object_editor.matview.body")}
        </label>
        <textarea
          id={`matview-body-${tab.id}`}
          data-testid="matview-body"
          className="q-editor-rules"
          aria-label={t("object_editor.matview.body")}
          value={form.body}
          onChange={(e) => onChange((f) => ({ ...f, body: e.target.value }))}
          style={{
            flex: 1,
            minHeight: 240,
            fontFamily: '"JetBrains Mono", ui-monospace, Menlo, monospace',
            fontSize: 13,
            padding: "10px 10px",
          }}
        />
      </div>
      <div style={{ gridColumn: 2, gridRow: 2, minHeight: 0 }}>
        <DdlPreviewPanel
          result={ddl}
          onApply={() => {
            if (canApply) setConfirmOpen(true);
          }}
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
    </div>
);
}
