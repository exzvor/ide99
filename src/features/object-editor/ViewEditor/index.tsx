// — ViewEditor (B3.T3). Schema/name + textarea body + DDL preview.
// TODO: swap textarea for Monaco-mini once a standalone Monaco wrapper exists.

import { type JSX, useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { schemaGetViewDefinition } from "../../../lib/tauri";
import type { ObjectEditorTab } from "../../editor/store";
import { DdlPreviewPanel } from "../TableEditor/DdlPreviewPanel";
import { HelpLink } from "../TableEditor/HelpLink";
import { formStateDirty } from "../TableEditor/dirty";
import type { ViewForm } from "../ddl/types";
import { generateViewDdl } from "../ddl/viewDdl";
import { ObjectEditorApplyConfirm } from "../shared/ObjectEditorApplyConfirm";
import { applyAndRefresh } from "../shared/applyAndRefresh";
import { useTouched } from "../shared/useTouched";
import { useObjectEditorStore } from "../store";

export interface ViewEditorProps {
  tab: ObjectEditorTab;
}

function blankViewForm(schema: string): ViewForm {
  return { schema, name: "", body: "" };
}

export function ViewEditor({ tab }: ViewEditorProps): JSX.Element {
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
      setForm(tab.id, { kind: "view", form: blankViewForm(tab.target.schema), initial: null });
      return;
    }
    void (async () => {
      try {
        const def = await schemaGetViewDefinition(          tab.connectionId,
          tab.target.schema,
          tab.target.name ?? "",
);
        if (cancelled) return;
        const form: ViewForm = { schema: def.schema, name: def.name, body: def.body };
        setForm(tab.id, { kind: "view", form, initial: form });
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

  const onChange = useCallback(    (mutator: (f: ViewForm) => ViewForm): void => {
      updateForm(tab.id, (s) => (s.kind === "view" ? { ...s, form: mutator(s.form) } : s));
    },
    [tab.id, updateForm],
);

  const stableFormState = formState && formState.kind === "view" ? formState : null;
  const deferredCurrent = useDeferredValue(stableFormState?.form ?? null);
  const deferredInitial = useDeferredValue(stableFormState?.initial ?? null);
  const ddl = useMemo(() => {
    if (!deferredCurrent) return null;
    return generateViewDdl(deferredInitial ?? null, deferredCurrent);
  }, [deferredCurrent, deferredInitial]);
  const dirty = stableFormState
    ? formStateDirty(stableFormState.initial, stableFormState.form)
    : false;
  const touched = useTouched(stableFormState?.form, stableFormState?.initial);

  if (loadError) {
    return (      <div data-testid="view-editor-load-error" role="alert" style={{ padding: 16 }}>
        {t("object_editor.common.load_error")}: {loadError}
      </div>
);
  }
  if (!stableFormState || !ddl) {
    return (      <div data-testid="view-editor-loading" style={{ padding: 16 }}>
        {t("object_editor.common.loading")}
      </div>
);
  }

  const form = stableFormState.form;
  const canApply =
    ddl.errors.length === 0 &&
    ddl.sql.trim().length > 0 &&
    form.name.trim().length > 0 &&
    form.body.trim().length > 0;

  const onCancel = (): void => {
    // reset form, keep tab open.
    if (stableFormState.initial !== null) {
      setForm(tab.id, {
        kind: "view",
        form: stableFormState.initial,
        initial: stableFormState.initial,
      });
    } else {
      setForm(tab.id, {
        kind: "view",
        form: blankViewForm(tab.target.schema),
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
          message: err instanceof Error ? err.message : String(err),
        });
      }
    })();
  };

  const banner =
    apply && apply.phase === "error" ? { kind: "error" as const, message: apply.message } : null;

  return (    <div
      data-testid="view-editor"
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
          gap: 8,
          alignItems: "center",
          padding: 12,
          borderBottom: "1px solid var(--hairline)",
        }}
      >
        <label style={{ fontSize: 12, display: "flex", flexDirection: "column" }}>
          {t("object_editor.common.schema")}
          <input
            data-testid="view-schema"
            value={form.schema}
            onChange={(e) => onChange((f) => ({ ...f, schema: e.target.value }))}
            style={{ width: 140 }}
          />
        </label>
        <label style={{ fontSize: 12, display: "flex", flexDirection: "column" }}>
          {t("object_editor.common.name")}
          <input
            data-testid="view-name"
            value={form.name}
            onChange={(e) => onChange((f) => ({ ...f, name: e.target.value }))}
            style={{ width: 200 }}
          />
        </label>
        {dirty ? (          <span data-testid="view-dirty-badge" style={{ fontSize: 11 }}>
            ● {t("object_editor.common.dirty")}
          </span>
) : null}
        <div style={{ flex: 1 }} />
        <HelpLink topic="view" />
      </div>
      <div style={{ overflow: "auto", padding: 12, display: "flex", flexDirection: "column" }}>
        <label
          style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}
          htmlFor={`view-body-${tab.id}`}
        >
          {t("object_editor.view.body")}
        </label>
        <textarea
          id={`view-body-${tab.id}`}
          data-testid="view-body"
          className="q-editor-rules"
          aria-label={t("object_editor.view.body")}
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
