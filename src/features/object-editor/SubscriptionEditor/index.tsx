// — SubscriptionEditor (B3.3).

import { type JSX, useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { schemaGetSubscriptionDefinition } from "../../../lib/tauri";
import type { ObjectEditorTab } from "../../editor/store";
import { DdlPreviewPanel } from "../TableEditor/DdlPreviewPanel";
import { HelpLink } from "../TableEditor/HelpLink";
import { formStateDirty } from "../TableEditor/dirty";
import { generateSubscriptionDdl } from "../ddl/subscriptionDdl";
import type { SubscriptionForm } from "../ddl/types";
import { fromDefinition } from "../introspect/subscriptionState";
import { ObjectEditorApplyConfirm } from "../shared/ObjectEditorApplyConfirm";
import { applyAndRefresh } from "../shared/applyAndRefresh";
import { useObjectEditorStore } from "../store";
import { ConnInfoInput } from "./ConnInfoInput";
import { PublicationsPicker } from "./PublicationsPicker";

export interface SubscriptionEditorProps {
  tab: ObjectEditorTab;
}

function blankForm(): SubscriptionForm {
  return {
    name: "",
    conninfo: "",
    publications: [],
    enabled: true,
    copyData: true,
    createSlot: true,
    comment: null,
  };
}

export function SubscriptionEditor({ tab }: SubscriptionEditorProps): JSX.Element {
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
      setForm(tab.id, { kind: "subscription", form: blankForm(), initial: null });
      return;
    }
    void (async () => {
      try {
        const def = await schemaGetSubscriptionDefinition(tab.connectionId, tab.target.name ?? "");
        if (cancelled) return;
        const form = fromDefinition(def);
        setForm(tab.id, { kind: "subscription", form, initial: form });
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
    (mutator: (f: SubscriptionForm) => SubscriptionForm): void => {
      updateForm(tab.id, (s) => (s.kind === "subscription" ? { ...s, form: mutator(s.form) } : s));
    },
    [tab.id, updateForm],
  );

  const stableFormState = formState && formState.kind === "subscription" ? formState : null;
  const deferredCurrent = useDeferredValue(stableFormState?.form ?? null);
  const deferredInitial = useDeferredValue(stableFormState?.initial ?? null);
  const ddl = useMemo(() => {
    if (!deferredCurrent) return null;
    return generateSubscriptionDdl(deferredInitial ?? null, deferredCurrent);
  }, [deferredCurrent, deferredInitial]);
  const dirty = stableFormState
    ? formStateDirty(stableFormState.initial, stableFormState.form)
    : false;

  if (loadError) {
    return (
      <div data-testid="subscription-editor-load-error" role="alert" style={{ padding: 16 }}>
        {t("object_editor.common.load_error")}: {loadError}
      </div>
    );
  }
  if (!stableFormState || !ddl) {
    return (
      <div data-testid="subscription-editor-loading" style={{ padding: 16 }}>
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
        kind: "subscription",
        form: stableFormState.initial,
        initial: stableFormState.initial,
      });
    } else {
      setForm(tab.id, { kind: "subscription", form: blankForm(), initial: null });
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
      data-testid="subscription-editor"
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
            ? t("object_editor.subscription.title_new")
            : t("object_editor.subscription.title_edit")}
        </h2>
        {dirty ? (
          <span
            data-testid="sub-dirty-badge"
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
        <HelpLink topic="subscription" />
      </div>

      <div style={{ overflow: "auto", padding: 16, display: "grid", gap: 14, minWidth: 0 }}>
        <div className="q-field">
          <label htmlFor={`sub-name-${tab.id}`}>{t("object_editor.subscription.name_label")}</label>
          <input
            id={`sub-name-${tab.id}`}
            data-testid="sub-name"
            className="q-input"
            value={form.name}
            onChange={(e) => onChange((g) => ({ ...g, name: e.target.value }))}
          />
        </div>

        <ConnInfoInput
          value={form.conninfo}
          onChange={(conninfo) => onChange((g) => ({ ...g, conninfo }))}
        />

        <PublicationsPicker
          value={form.publications}
          onChange={(publications) => onChange((g) => ({ ...g, publications }))}
        />

        <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
          <label className="q-checkbox" data-testid="sub-enabled-label">
            <input
              type="checkbox"
              data-testid="sub-enabled"
              checked={form.enabled}
              onChange={(e) => onChange((g) => ({ ...g, enabled: e.target.checked }))}
            />
            {t("object_editor.subscription.enabled_label")}
          </label>
          <label className="q-checkbox" data-testid="sub-copy-data-label">
            <input
              type="checkbox"
              data-testid="sub-copy-data"
              checked={form.copyData}
              onChange={(e) => onChange((g) => ({ ...g, copyData: e.target.checked }))}
            />
            {t("object_editor.subscription.copy_data_label")}
          </label>
          <label className="q-checkbox" data-testid="sub-create-slot-label">
            <input
              type="checkbox"
              data-testid="sub-create-slot"
              checked={form.createSlot}
              onChange={(e) => onChange((g) => ({ ...g, createSlot: e.target.checked }))}
            />
            {t("object_editor.subscription.create_slot_label")}
          </label>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
          <div className="q-field">
            <label htmlFor={`sub-slot-name-${tab.id}`}>
              {t("object_editor.subscription.slot_name_label")}
            </label>
            <input
              id={`sub-slot-name-${tab.id}`}
              data-testid="sub-slot-name"
              className="q-input mono"
              value={form.slotName ?? ""}
              onChange={(e) =>
                onChange((g) => ({
                  ...g,
                  slotName: e.target.value === "" ? undefined : e.target.value,
                }))
              }
            />
          </div>
          <div className="q-field">
            <label htmlFor={`sub-sync-commit-${tab.id}`}>
              {t("object_editor.subscription.synchronous_commit_label")}
            </label>
            <input
              id={`sub-sync-commit-${tab.id}`}
              data-testid="sub-sync-commit"
              className="q-input mono"
              value={form.synchronousCommit ?? ""}
              onChange={(e) =>
                onChange((g) => ({
                  ...g,
                  synchronousCommit: e.target.value === "" ? undefined : e.target.value,
                }))
              }
            />
          </div>
        </div>
        <div className="q-field">
          <label htmlFor={`sub-comment-${tab.id}`}>
            {t("object_editor.subscription.comment_label")}
          </label>
          <textarea
            id={`sub-comment-${tab.id}`}
            data-testid="sub-comment"
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
