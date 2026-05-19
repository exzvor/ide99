// — PublicationEditor (B3.2).
//
// Layout: header (name + mode radio + dirty + HelpLink) — body (mode-specific
// picker, ops checkboxes, publish_via_partition_root toggle, comment) —
// sticky right pane (DDL preview + Apply/Cancel footer).

import { type JSX, useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { schemaGetPublicationDefinition } from "../../../lib/tauri";
import type { ObjectEditorTab } from "../../editor/store";
import { DdlPreviewPanel } from "../TableEditor/DdlPreviewPanel";
import { HelpLink } from "../TableEditor/HelpLink";
import { formStateDirty } from "../TableEditor/dirty";
import { generatePublicationDdl } from "../ddl/publicationDdl";
import type { PublicationForm, PublicationMode } from "../ddl/types";
import { fromDefinition } from "../introspect/publicationState";
import { ObjectEditorApplyConfirm } from "../shared/ObjectEditorApplyConfirm";
import { applyAndRefresh } from "../shared/applyAndRefresh";
import { useTouched } from "../shared/useTouched";
import { useObjectEditorStore } from "../store";
import { SchemasPicker } from "./SchemasPicker";
import { TablesPicker } from "./TablesPicker";

export interface PublicationEditorProps {
  tab: ObjectEditorTab;
}

function blankForm(): PublicationForm {
  return {
    name: "",
    mode: "all_tables",
    schemas: [],
    tables: [],
    publishInsert: true,
    publishUpdate: true,
    publishDelete: true,
    publishTruncate: true,
    publishViaPartitionRoot: false,
    comment: null,
  };
}

export function PublicationEditor({ tab }: PublicationEditorProps): JSX.Element {
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
      setForm(tab.id, { kind: "publication", form: blankForm(), initial: null });
      return;
    }
    void (async () => {
      try {
        const def = await schemaGetPublicationDefinition(tab.connectionId, tab.target.name ?? "");
        if (cancelled) return;
        const form = fromDefinition(def);
        setForm(tab.id, { kind: "publication", form, initial: form });
      } catch (err) {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab.id, tab.connectionId, tab.target.mode, tab.target.name, setForm]);

  useEffect(() => {
    return () => {
      clearTab(tab.id);
    };
  }, [tab.id, clearTab]);

  const onChange = useCallback(
    (mutator: (f: PublicationForm) => PublicationForm): void => {
      updateForm(tab.id, (s) => (s.kind === "publication" ? { ...s, form: mutator(s.form) } : s));
    },
    [tab.id, updateForm],
  );

  const stableFormState = formState && formState.kind === "publication" ? formState : null;
  const deferredCurrent = useDeferredValue(stableFormState?.form ?? null);
  const deferredInitial = useDeferredValue(stableFormState?.initial ?? null);
  const ddl = useMemo(() => {
    if (!deferredCurrent) return null;
    return generatePublicationDdl(deferredInitial ?? null, deferredCurrent);
  }, [deferredCurrent, deferredInitial]);
  const dirty = stableFormState
    ? formStateDirty(stableFormState.initial, stableFormState.form)
    : false;
  const touched = useTouched(stableFormState?.form, stableFormState?.initial);

  if (loadError) {
    return (
      <div data-testid="publication-editor-load-error" role="alert" style={{ padding: 16 }}>
        {t("object_editor.common.load_error")}: {loadError}
      </div>
    );
  }
  if (!stableFormState || !ddl) {
    return (
      <div data-testid="publication-editor-loading" style={{ padding: 16 }}>
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
        kind: "publication",
        form: stableFormState.initial,
        initial: stableFormState.initial,
      });
    } else {
      setForm(tab.id, { kind: "publication", form: blankForm(), initial: null });
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
      data-testid="publication-editor"
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
            ? t("object_editor.publication.title_new")
            : t("object_editor.publication.title_edit")}
        </h2>
        {dirty ? (
          <span
            data-testid="pub-dirty-badge"
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
        <HelpLink topic="publication" />
      </div>

      <div style={{ overflow: "auto", padding: 16, display: "grid", gap: 14, minWidth: 0 }}>
        <div className="q-field">
          <label htmlFor={`pub-name-${tab.id}`}>{t("object_editor.publication.name_label")}</label>
          <input
            id={`pub-name-${tab.id}`}
            data-testid="pub-name"
            className="q-input"
            value={form.name}
            onChange={(e) => onChange((g) => ({ ...g, name: e.target.value }))}
          />
        </div>

        <fieldset
          data-testid="pub-mode-fieldset"
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
            style={{
              fontSize: 11.5,
              fontWeight: 500,
              color: "var(--ink-3)",
              padding: "0 6px",
            }}
          >
            {t("object_editor.publication.mode_label")}
          </legend>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {(
              [
                ["all_tables", "mode_all_tables"],
                ["schemas", "mode_schemas"],
                ["tables", "mode_tables"],
              ] as const
            ).map(([value, key]) => {
              const checked = form.mode === value;
              return (
                <label
                  key={value}
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
                    type="radio"
                    name={`pub-mode-${tab.id}`}
                    data-testid={`pub-mode-${value}`}
                    checked={checked}
                    onChange={() => onChange((g) => ({ ...g, mode: value as PublicationMode }))}
                    style={{
                      position: "absolute",
                      width: 1,
                      height: 1,
                      opacity: 0,
                      pointerEvents: "none",
                    }}
                  />
                  {t(`object_editor.publication.${key}`)}
                </label>
              );
            })}
          </div>
        </fieldset>

        {form.mode === "tables" ? (
          <section data-testid="pub-tables-section" style={{ display: "grid", gap: 6 }}>
            <h4 style={{ margin: 0, fontSize: 13 }}>
              {t("object_editor.publication.tables_section")}
            </h4>
            <TablesPicker
              connId={tab.connectionId}
              selected={form.tables}
              onChange={(tables) => onChange((g) => ({ ...g, tables }))}
            />
          </section>
        ) : null}

        {form.mode === "schemas" ? (
          <section data-testid="pub-schemas-section" style={{ display: "grid", gap: 6 }}>
            <h4 style={{ margin: 0, fontSize: 13 }}>
              {t("object_editor.publication.schemas_section")}
            </h4>
            <SchemasPicker
              connId={tab.connectionId}
              selected={form.schemas}
              onChange={(schemas) => onChange((g) => ({ ...g, schemas }))}
            />
          </section>
        ) : null}

        <fieldset
          data-testid="pub-ops-fieldset"
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
            style={{
              fontSize: 11.5,
              fontWeight: 500,
              color: "var(--ink-3)",
              padding: "0 6px",
            }}
          >
            {t("object_editor.publication.publish_ops_section")}
          </legend>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
            <label className="q-checkbox" data-testid="pub-op-insert-label">
              <input
                type="checkbox"
                data-testid="pub-op-insert"
                checked={form.publishInsert}
                onChange={(e) => onChange((g) => ({ ...g, publishInsert: e.target.checked }))}
              />
              {t("object_editor.publication.publish_insert")}
            </label>
            <label className="q-checkbox" data-testid="pub-op-update-label">
              <input
                type="checkbox"
                data-testid="pub-op-update"
                checked={form.publishUpdate}
                onChange={(e) => onChange((g) => ({ ...g, publishUpdate: e.target.checked }))}
              />
              {t("object_editor.publication.publish_update")}
            </label>
            <label className="q-checkbox" data-testid="pub-op-delete-label">
              <input
                type="checkbox"
                data-testid="pub-op-delete"
                checked={form.publishDelete}
                onChange={(e) => onChange((g) => ({ ...g, publishDelete: e.target.checked }))}
              />
              {t("object_editor.publication.publish_delete")}
            </label>
            <label className="q-checkbox" data-testid="pub-op-truncate-label">
              <input
                type="checkbox"
                data-testid="pub-op-truncate"
                checked={form.publishTruncate}
                onChange={(e) => onChange((g) => ({ ...g, publishTruncate: e.target.checked }))}
              />
              {t("object_editor.publication.publish_truncate")}
            </label>
          </div>
        </fieldset>

        <label className="q-checkbox" data-testid="pub-via-partition-root-label">
          <input
            type="checkbox"
            data-testid="pub-via-partition-root"
            checked={form.publishViaPartitionRoot}
            onChange={(e) => onChange((g) => ({ ...g, publishViaPartitionRoot: e.target.checked }))}
          />
          {t("object_editor.publication.publish_via_partition_root")}
        </label>

        <div className="q-field">
          <label htmlFor={`pub-comment-${tab.id}`}>
            {t("object_editor.publication.comment_label")}
          </label>
          <textarea
            id={`pub-comment-${tab.id}`}
            data-testid="pub-comment"
            className="q-input"
            value={form.comment ?? ""}
            rows={2}
            onChange={(e) =>
              onChange((g) => ({
                ...g,
                comment: e.target.value.trim() === "" ? null : e.target.value,
              }))
            }
            style={{ resize: "vertical", paddingTop: 6, paddingBottom: 6, height: "auto" }}
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
