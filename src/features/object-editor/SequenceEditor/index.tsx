// — SequenceEditor (B3.T5).

import { type JSX, useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { schemaGetSequenceDefinition } from "../../../lib/tauri";
import type { ObjectEditorTab } from "../../editor/store";
import { DdlPreviewPanel } from "../TableEditor/DdlPreviewPanel";
import { HelpLink } from "../TableEditor/HelpLink";
import { formStateDirty } from "../TableEditor/dirty";
import { generateSequenceDdl } from "../ddl/sequenceDdl";
import type { SequenceForm } from "../ddl/types";
import { ObjectEditorApplyConfirm } from "../shared/ObjectEditorApplyConfirm";
import { applyAndRefresh } from "../shared/applyAndRefresh";
import { useTouched } from "../shared/useTouched";
import { useObjectEditorStore } from "../store";

export interface SequenceEditorProps {
  tab: ObjectEditorTab;
}

function blankSequenceForm(schema: string): SequenceForm {
  return {
    schema,
    name: "",
    dataType: "bigint",
    start: null,
    increment: 1,
    minValue: null,
    maxValue: null,
    cache: 1,
    cycle: false,
    ownedBy: null,
  };
}

function parseNullableNumber(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function SequenceEditor({ tab }: SequenceEditorProps): JSX.Element {
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
        kind: "sequence",
        form: blankSequenceForm(tab.target.schema),
        initial: null,
      });
      return;
    }
    void (async () => {
      try {
        const def = await schemaGetSequenceDefinition(          tab.connectionId,
          tab.target.schema,
          tab.target.name ?? "",
);
        if (cancelled) return;
        const form: SequenceForm = {
          schema: def.schema,
          name: def.name,
          dataType: def.dataType,
          start: def.start,
          increment: def.increment,
          minValue: def.minValue,
          maxValue: def.maxValue,
          cache: def.cache,
          cycle: def.cycle,
          ownedBy: def.ownedBy,
        };
        setForm(tab.id, { kind: "sequence", form, initial: form });
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

  const onChange = useCallback(    (mutator: (f: SequenceForm) => SequenceForm): void => {
      updateForm(tab.id, (s) => (s.kind === "sequence" ? { ...s, form: mutator(s.form) } : s));
    },
    [tab.id, updateForm],
);

  const stableFormState = formState && formState.kind === "sequence" ? formState : null;
  const deferredCurrent = useDeferredValue(stableFormState?.form ?? null);
  const deferredInitial = useDeferredValue(stableFormState?.initial ?? null);
  const ddl = useMemo(() => {
    if (!deferredCurrent) return null;
    return generateSequenceDdl(deferredInitial ?? null, deferredCurrent);
  }, [deferredCurrent, deferredInitial]);
  const dirty = stableFormState
    ? formStateDirty(stableFormState.initial, stableFormState.form)
    : false;
  const touched = useTouched(stableFormState?.form, stableFormState?.initial);

  if (loadError) {
    return (      <div data-testid="sequence-editor-load-error" role="alert" style={{ padding: 16 }}>
        {t("object_editor.common.load_error")}: {loadError}
      </div>
);
  }
  if (!stableFormState || !ddl) {
    return (      <div data-testid="sequence-editor-loading" style={{ padding: 16 }}>
        {t("object_editor.common.loading")}
      </div>
);
  }

  const form = stableFormState.form;
  const owned = form.ownedBy ?? { schema: "", table: "", column: "" };
  const canApply =
    ddl.errors.length === 0 && ddl.sql.trim().length > 0 && form.name.trim().length > 0;

  const onCancel = (): void => {
    // reset form, keep tab open.
    if (stableFormState.initial !== null) {
      setForm(tab.id, {
        kind: "sequence",
        form: stableFormState.initial,
        initial: stableFormState.initial,
      });
    } else {
      setForm(tab.id, {
        kind: "sequence",
        form: blankSequenceForm(tab.target.schema),
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
      data-testid="sequence-editor"
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
          <label htmlFor={`sequence-schema-${tab.id}`}>{t("object_editor.common.schema")}</label>
          <input
            id={`sequence-schema-${tab.id}`}
            data-testid="sequence-schema"
            className="q-input"
            value={form.schema}
            onChange={(e) => onChange((f) => ({ ...f, schema: e.target.value }))}
          />
        </div>
        <div className="q-field" style={{ width: 240 }}>
          <label htmlFor={`sequence-name-${tab.id}`}>{t("object_editor.common.name")}</label>
          <input
            id={`sequence-name-${tab.id}`}
            data-testid="sequence-name"
            className="q-input"
            value={form.name}
            onChange={(e) => onChange((f) => ({ ...f, name: e.target.value }))}
          />
        </div>
        {dirty ? (          <span
            data-testid="sequence-dirty-badge"
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
          <HelpLink topic="sequence" />
        </div>
      </div>
      <div style={{ overflow: "auto", padding: 16, display: "grid", gap: 14 }}>
        <div className="q-field" style={{ width: 200 }}>
          <label htmlFor={`sequence-data-type-${tab.id}`}>
            {t("object_editor.sequence.data_type")}
          </label>
          <select
            id={`sequence-data-type-${tab.id}`}
            data-testid="sequence-data-type"
            className="q-select"
            value={form.dataType}
            onChange={(e) =>
              onChange((f) => ({
                ...f,
                dataType: e.target.value as SequenceForm["dataType"],
              }))
            }
          >
            <option value="smallint">smallint</option>
            <option value="integer">integer</option>
            <option value="bigint">bigint</option>
          </select>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}>
          <div className="q-field">
            <label htmlFor={`sequence-start-${tab.id}`}>{t("object_editor.sequence.start")}</label>
            <input
              id={`sequence-start-${tab.id}`}
              data-testid="sequence-start"
              className="q-input"
              value={form.start === null ? "" : String(form.start)}
              onChange={(e) =>
                onChange((f) => ({ ...f, start: parseNullableNumber(e.target.value) }))
              }
            />
          </div>
          <div className="q-field">
            <label htmlFor={`sequence-increment-${tab.id}`}>
              {t("object_editor.sequence.increment")}
            </label>
            <input
              id={`sequence-increment-${tab.id}`}
              data-testid="sequence-increment"
              className="q-input"
              value={String(form.increment)}
              onChange={(e) => {
                const n = Number(e.target.value);
                onChange((f) => ({ ...f, increment: Number.isFinite(n) ? n : f.increment }));
              }}
            />
          </div>
          <div className="q-field">
            <label htmlFor={`sequence-cache-${tab.id}`}>{t("object_editor.sequence.cache")}</label>
            <input
              id={`sequence-cache-${tab.id}`}
              data-testid="sequence-cache"
              className="q-input"
              value={String(form.cache)}
              onChange={(e) => {
                const n = Number(e.target.value);
                onChange((f) => ({ ...f, cache: Number.isFinite(n) && n > 0 ? n : f.cache }));
              }}
            />
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
          <div className="q-field">
            <label htmlFor={`sequence-min-${tab.id}`}>
              {t("object_editor.sequence.min_value")}
            </label>
            <input
              id={`sequence-min-${tab.id}`}
              data-testid="sequence-min"
              className="q-input"
              value={form.minValue === null ? "" : String(form.minValue)}
              onChange={(e) =>
                onChange((f) => ({ ...f, minValue: parseNullableNumber(e.target.value) }))
              }
            />
          </div>
          <div className="q-field">
            <label htmlFor={`sequence-max-${tab.id}`}>
              {t("object_editor.sequence.max_value")}
            </label>
            <input
              id={`sequence-max-${tab.id}`}
              data-testid="sequence-max"
              className="q-input"
              value={form.maxValue === null ? "" : String(form.maxValue)}
              onChange={(e) =>
                onChange((f) => ({ ...f, maxValue: parseNullableNumber(e.target.value) }))
              }
            />
          </div>
        </div>
        <label className="q-checkbox" data-testid="sequence-cycle-label">
          <input
            data-testid="sequence-cycle"
            type="checkbox"
            checked={form.cycle}
            onChange={(e) => onChange((f) => ({ ...f, cycle: e.target.checked }))}
          />
          {t("object_editor.sequence.cycle")}
        </label>
        <fieldset
          data-testid="sequence-owned-by"
          style={{
            border: "1px solid var(--border-strong-q)",
            borderRadius: "var(--r-md)",
            padding: 12,
            margin: 0,
            display: "grid",
            gap: 12,
          }}
        >
          <legend
            style={{ fontSize: 11.5, fontWeight: 500, color: "var(--ink-3)", padding: "0 6px" }}
          >
            {t("object_editor.sequence.owned_by")}
          </legend>
          <div
            style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}
          >
            <div className="q-field">
              <label htmlFor={`sequence-owned-schema-${tab.id}`}>
                {t("object_editor.sequence.owned_schema")}
              </label>
              <input
                id={`sequence-owned-schema-${tab.id}`}
                data-testid="sequence-owned-schema"
                className="q-input"
                value={owned.schema}
                onChange={(e) => {
                  const next = { ...owned, schema: e.target.value };
                  onChange((f) => ({
                    ...f,
                    ownedBy:
                      next.schema === "" && next.table === "" && next.column === "" ? null : next,
                  }));
                }}
              />
            </div>
            <div className="q-field">
              <label htmlFor={`sequence-owned-table-${tab.id}`}>
                {t("object_editor.sequence.owned_table")}
              </label>
              <input
                id={`sequence-owned-table-${tab.id}`}
                data-testid="sequence-owned-table"
                className="q-input"
                value={owned.table}
                onChange={(e) => {
                  const next = { ...owned, table: e.target.value };
                  onChange((f) => ({
                    ...f,
                    ownedBy:
                      next.schema === "" && next.table === "" && next.column === "" ? null : next,
                  }));
                }}
              />
            </div>
            <div className="q-field">
              <label htmlFor={`sequence-owned-column-${tab.id}`}>
                {t("object_editor.sequence.owned_column")}
              </label>
              <input
                id={`sequence-owned-column-${tab.id}`}
                data-testid="sequence-owned-column"
                className="q-input"
                value={owned.column}
                onChange={(e) => {
                  const next = { ...owned, column: e.target.value };
                  onChange((f) => ({
                    ...f,
                    ownedBy:
                      next.schema === "" && next.table === "" && next.column === "" ? null : next,
                  }));
                }}
              />
            </div>
          </div>
        </fieldset>
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
