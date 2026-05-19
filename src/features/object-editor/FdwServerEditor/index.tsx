// — FdwServerEditor (B3.1).
//
// Layout mirrors S23/S24 editors: header (name + dirty + HelpLink) — body
// (FDW name, server type, version, options, user mappings, comment) — sticky
// right pane (DDL preview + Apply/Cancel footer).
//
// On mount: edit-mode → schemaGetFdwServerDefinition + fromDefinition (B4
// transform). create-mode → blank form. Unmount: clearTab.

import { type JSX, useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { schemaGetFdwServerDefinition } from "../../../lib/tauri";
import type { ObjectEditorTab } from "../../editor/store";
import { DdlPreviewPanel } from "../TableEditor/DdlPreviewPanel";
import { HelpLink } from "../TableEditor/HelpLink";
import { formStateDirty } from "../TableEditor/dirty";
import { generateFdwServerDdl } from "../ddl/fdwServerDdl";
import type { FdwServerForm } from "../ddl/types";
import { fromDefinition } from "../introspect/fdwServerState";
import { ObjectEditorApplyConfirm } from "../shared/ObjectEditorApplyConfirm";
import { applyAndRefresh } from "../shared/applyAndRefresh";
import { useObjectEditorStore } from "../store";
import { OptionsList } from "./OptionsList";
import { UserMappingsList } from "./UserMappingsList";

export interface FdwServerEditorProps {
  tab: ObjectEditorTab;
}

function blankForm(): FdwServerForm {
  return {
    name: "",
    fdwName: "",
    options: [],
    userMappings: [],
    comment: null,
  };
}

export function FdwServerEditor({ tab }: FdwServerEditorProps): JSX.Element {
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
      setForm(tab.id, { kind: "fdw_server", form: blankForm(), initial: null });
      return;
    }
    void (async () => {
      try {
        const def = await schemaGetFdwServerDefinition(tab.connectionId, tab.target.name ?? "");
        if (cancelled) return;
        const form = fromDefinition(def);
        setForm(tab.id, { kind: "fdw_server", form, initial: form });
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
    (mutator: (f: FdwServerForm) => FdwServerForm): void => {
      updateForm(tab.id, (s) => (s.kind === "fdw_server" ? { ...s, form: mutator(s.form) } : s));
    },
    [tab.id, updateForm],
  );

  const stableFormState = formState && formState.kind === "fdw_server" ? formState : null;
  const deferredCurrent = useDeferredValue(stableFormState?.form ?? null);
  const deferredInitial = useDeferredValue(stableFormState?.initial ?? null);
  const ddl = useMemo(() => {
    if (!deferredCurrent) return null;
    return generateFdwServerDdl(deferredInitial ?? null, deferredCurrent);
  }, [deferredCurrent, deferredInitial]);
  const dirty = stableFormState
    ? formStateDirty(stableFormState.initial, stableFormState.form)
    : false;

  if (loadError) {
    return (
      <div data-testid="fdw-server-editor-load-error" role="alert" style={{ padding: 16 }}>
        {t("object_editor.common.load_error")}: {loadError}
      </div>
    );
  }
  if (!stableFormState || !ddl) {
    return (
      <div data-testid="fdw-server-editor-loading" style={{ padding: 16 }}>
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
        kind: "fdw_server",
        form: stableFormState.initial,
        initial: stableFormState.initial,
      });
    } else {
      setForm(tab.id, {
        kind: "fdw_server",
        form: blankForm(),
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
      data-testid="fdw-server-editor"
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
            ? t("object_editor.fdw_server.title_new")
            : t("object_editor.fdw_server.title_edit")}
        </h2>
        {dirty ? (
          <span
            data-testid="fdw-dirty-badge"
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
        <HelpLink topic="fdw_server" />
      </div>

      <div style={{ overflow: "auto", padding: 16, display: "grid", gap: 16, minWidth: 0 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div className="q-field">
            <label htmlFor={`fdw-name-${tab.id}`}>{t("object_editor.fdw_server.name_label")}</label>
            <input
              id={`fdw-name-${tab.id}`}
              data-testid="fdw-name"
              className="q-input"
              value={form.name}
              onChange={(e) => onChange((g) => ({ ...g, name: e.target.value }))}
            />
          </div>
          <div className="q-field">
            <label htmlFor={`fdw-fdw-name-${tab.id}`}>
              {t("object_editor.fdw_server.fdw_label")}
            </label>
            <input
              id={`fdw-fdw-name-${tab.id}`}
              data-testid="fdw-fdw-name"
              className="q-input"
              value={form.fdwName}
              onChange={(e) => onChange((g) => ({ ...g, fdwName: e.target.value }))}
            />
          </div>
          <div className="q-field">
            <label htmlFor={`fdw-type-${tab.id}`}>{t("object_editor.fdw_server.type_label")}</label>
            <input
              id={`fdw-type-${tab.id}`}
              data-testid="fdw-type"
              className="q-input"
              value={form.serverType ?? ""}
              onChange={(e) =>
                onChange((g) => ({
                  ...g,
                  serverType: e.target.value === "" ? undefined : e.target.value,
                }))
              }
            />
          </div>
          <div className="q-field">
            <label htmlFor={`fdw-version-${tab.id}`}>
              {t("object_editor.fdw_server.version_label")}
            </label>
            <input
              id={`fdw-version-${tab.id}`}
              data-testid="fdw-version"
              className="q-input"
              value={form.version ?? ""}
              onChange={(e) =>
                onChange((g) => ({
                  ...g,
                  version: e.target.value === "" ? undefined : e.target.value,
                }))
              }
            />
          </div>
        </div>

        <OptionsList
          options={form.options}
          onChange={(opts) => onChange((g) => ({ ...g, options: opts }))}
          labelText={t("object_editor.fdw_server.options_section")}
          addLabel={t("object_editor.fdw_server.add_option")}
          testidPrefix="fdw-options"
        />

        <UserMappingsList
          mappings={form.userMappings}
          onChange={(m) => onChange((g) => ({ ...g, userMappings: m }))}
        />

        <div className="q-field">
          <label htmlFor={`fdw-comment-${tab.id}`}>
            {t("object_editor.fdw_server.comment_label")}
          </label>
          <textarea
            id={`fdw-comment-${tab.id}`}
            data-testid="fdw-comment"
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
