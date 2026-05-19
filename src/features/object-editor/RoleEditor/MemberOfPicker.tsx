// — Member-of picker. Queries `schemaListRoles` once, filters out
// the role being edited (a role can't be a member of itself), and renders a
// flat checkbox list. Selection mirrors back as `string[]` of role names —
// the DDL generator emits GRANT/REVOKE for each diff.

import { type JSX, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { type RoleSummaryDto, schemaListRoles } from "../../../lib/tauri";

export interface MemberOfPickerProps {
  connId: string;
  /** Name of the role being edited; never offered as a member-of target. */
  selfName: string;
  selected: string[];
  onChange: (next: string[]) => void;
}

export function MemberOfPicker({
  connId,
  selfName,
  selected,
  onChange,
}: MemberOfPickerProps): JSX.Element {
  const { t } = useTranslation();
  const [available, setAvailable] = useState<RoleSummaryDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await schemaListRoles(connId);
        if (!cancelled) setAvailable(list);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connId]);

  const toggle = (name: string): void => {
    if (selected.includes(name)) onChange(selected.filter((n) => n !== name));
    else onChange([...selected, name]);
  };

  if (error) {
    return (
      <div data-testid="role-members-error" role="alert" style={{ fontSize: 12 }}>
        {error}
      </div>
    );
  }
  if (available === null) {
    return (
      <div data-testid="role-members-loading" style={{ fontSize: 12 }}>
        {t("object_editor.common.loading")}
      </div>
    );
  }

  const filtered = available.filter((r) => r.name !== selfName);
  return (
    <div
      data-testid="role-member-of-picker"
      style={{
        maxHeight: 160,
        overflow: "auto",
        border: "1px solid var(--hairline)",
        borderRadius: 4,
        padding: 6,
      }}
    >
      {filtered.length === 0 ? (
        <div style={{ fontSize: 12 }}>{t("object_editor.role.member_of_picker_placeholder")}</div>
      ) : null}
      {filtered.map((r) => (
        <label key={r.name} style={{ display: "flex", gap: 6, fontSize: 12, alignItems: "center" }}>
          <input
            type="checkbox"
            data-testid={`role-member-${r.name}`}
            checked={selected.includes(r.name)}
            onChange={() => toggle(r.name)}
          />
          <span>{r.name}</span>
        </label>
      ))}
    </div>
  );
}
