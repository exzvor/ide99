// — RoleEditor (B3.4).

import { type JSX, useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { schemaGetRoleDefinition } from "../../../lib/tauri";
import type { ObjectEditorTab } from "../../editor/store";
import { DdlPreviewPanel } from "../TableEditor/DdlPreviewPanel";
import { HelpLink } from "../TableEditor/HelpLink";
import { formStateDirty } from "../TableEditor/dirty";
import { generateRoleDdl } from "../ddl/roleDdl";
import type { RoleForm } from "../ddl/types";
import { fromDefinition } from "../introspect/roleState";
import { ObjectEditorApplyConfirm } from "../shared/ObjectEditorApplyConfirm";
import { applyAndRefresh } from "../shared/applyAndRefresh";
import { useObjectEditorStore } from "../store";
import { AttributesPanel } from "./AttributesPanel";
import { MemberOfPicker } from "./MemberOfPicker";

export interface RoleEditorProps {
  tab: ObjectEditorTab;
}

function blankForm(): RoleForm {
  return {
    name: "",
    login: true,
    superuser: false,
    createdb: false,
    createrole: false,
    replication: false,
    bypassrls: false,
    inherit: true,
    connectionLimit: -1,
    passwordIsHash: false,
    memberOf: [],
    comment: null,
  };
}

export function RoleEditor({ tab }: RoleEditorProps): JSX.Element {
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
      setForm(tab.id, { kind: "role", form: blankForm(), initial: null });
      return;
    }
    void (async () => {
      try {
        const def = await schemaGetRoleDefinition(tab.connectionId, tab.target.name ?? "");
        if (cancelled) return;
        const form = fromDefinition(def);
        setForm(tab.id, { kind: "role", form, initial: form });
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

  const onChange = useCallback(    (mutator: (f: RoleForm) => RoleForm): void => {
      updateForm(tab.id, (s) => (s.kind === "role" ? { ...s, form: mutator(s.form) } : s));
    },
    [tab.id, updateForm],
);

  const stableFormState = formState && formState.kind === "role" ? formState : null;
  const deferredCurrent = useDeferredValue(stableFormState?.form ?? null);
  const deferredInitial = useDeferredValue(stableFormState?.initial ?? null);
  const ddl = useMemo(() => {
    if (!deferredCurrent) return null;
    return generateRoleDdl(deferredInitial ?? null, deferredCurrent);
  }, [deferredCurrent, deferredInitial]);
  const dirty = stableFormState
    ? formStateDirty(stableFormState.initial, stableFormState.form)
    : false;

  if (loadError) {
    return (      <div data-testid="role-editor-load-error" role="alert" style={{ padding: 16 }}>
        {t("object_editor.common.load_error")}: {loadError}
      </div>
);
  }
  if (!stableFormState || !ddl) {
    return (      <div data-testid="role-editor-loading" style={{ padding: 16 }}>
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
        kind: "role",
        form: stableFormState.initial,
        initial: stableFormState.initial,
      });
    } else {
      setForm(tab.id, { kind: "role", form: blankForm(), initial: null });
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
      data-testid="role-editor"
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
        <h2 style={{ fontSize: 14, margin: 0 }}>
          {tab.target.mode === "create"
            ? t("object_editor.role.title_new")
            : t("object_editor.role.title_edit")}
        </h2>
        {dirty ? (          <span data-testid="role-dirty-badge" style={{ fontSize: 11 }}>
            ● {t("object_editor.common.dirty")}
          </span>
) : null}
        <div style={{ flex: 1 }} />
        <HelpLink topic="role" />
      </div>

      <div style={{ overflow: "auto", padding: 12, display: "grid", gap: 12, minWidth: 0 }}>
        <label style={{ fontSize: 12, display: "flex", flexDirection: "column" }}>
          {t("object_editor.role.name_label")}
          <input
            data-testid="role-name"
            value={form.name}
            onChange={(e) => onChange((g) => ({ ...g, name: e.target.value }))}
          />
        </label>

        <AttributesPanel form={form} onChange={onChange} />

        <section data-testid="role-member-of-section" style={{ display: "grid", gap: 6 }}>
          <h4 style={{ margin: 0, fontSize: 13 }}>{t("object_editor.role.member_of_section")}</h4>
          <MemberOfPicker
            connId={tab.connectionId}
            selfName={form.name}
            selected={form.memberOf}
            onChange={(memberOf) => onChange((g) => ({ ...g, memberOf }))}
          />
        </section>

        <label style={{ fontSize: 12, display: "flex", flexDirection: "column" }}>
          {t("object_editor.role.comment_label")}
          <textarea
            data-testid="role-comment"
            value={form.comment ?? ""}
            rows={2}
            onChange={(e) =>
              onChange((g) => ({
                ...g,
                comment: e.target.value.trim() === "" ? null : e.target.value,
              }))
            }
          />
        </label>
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
