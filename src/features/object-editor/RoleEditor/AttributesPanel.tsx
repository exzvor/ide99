// — Role-attributes panel: 7 boolean toggles + connection limit
// + valid_until + password + password-is-hash. The password sits inline
// (no masking — Postgres echoes ALTER ROLE … PASSWORD '…' to the server log
// either way; the DDL preview shows the same string).

import type { JSX } from "react";
import { useTranslation } from "react-i18next";

import type { RoleForm } from "../ddl/types";

export interface AttributesPanelProps {
  form: RoleForm;
  onChange: (mutator: (f: RoleForm) => RoleForm) => void;
}

export function AttributesPanel({ form, onChange }: AttributesPanelProps): JSX.Element {
  const { t } = useTranslation();
  const attrs: Array<[keyof RoleForm, string]> = [
    ["login", "login_label"],
    ["superuser", "superuser_label"],
    ["createdb", "createdb_label"],
    ["createrole", "createrole_label"],
    ["replication", "replication_label"],
    ["bypassrls", "bypassrls_label"],
    ["inherit", "inherit_label"],
  ];
  return (
    <fieldset
      data-testid="role-attributes-fieldset"
      style={{
        border: "1px solid var(--hairline)",
        borderRadius: 4,
        padding: 8,
        display: "grid",
        gap: 6,
      }}
    >
      <legend style={{ fontSize: 12, padding: "0 4px" }}>
        {t("object_editor.role.attributes_section")}
      </legend>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
        {attrs.map(([key, k]) => (
          <label key={key as string} style={{ fontSize: 12 }}>
            <input
              type="checkbox"
              data-testid={`role-attr-${String(key)}`}
              checked={Boolean(form[key])}
              onChange={(e) => onChange((f) => ({ ...f, [key]: e.target.checked }) as RoleForm)}
            />{" "}
            {t(`object_editor.role.${k}`)}
          </label>
        ))}
      </div>
      <label style={{ fontSize: 12, display: "flex", flexDirection: "column" }}>
        {t("object_editor.role.connection_limit_label")}
        <input
          data-testid="role-connection-limit"
          type="number"
          value={String(form.connectionLimit)}
          onChange={(e) => {
            const n = Number(e.target.value);
            onChange((f) => ({
              ...f,
              connectionLimit: Number.isFinite(n) ? n : f.connectionLimit,
            }));
          }}
        />
      </label>
      <label style={{ fontSize: 12, display: "flex", flexDirection: "column" }}>
        {t("object_editor.role.valid_until_label")}
        <input
          data-testid="role-valid-until"
          type="datetime-local"
          value={form.validUntil ?? ""}
          onChange={(e) =>
            onChange((f) => ({
              ...f,
              validUntil: e.target.value === "" ? undefined : e.target.value,
            }))
          }
        />
      </label>
      <label style={{ fontSize: 12, display: "flex", flexDirection: "column" }}>
        {t("object_editor.role.password_label")}
        <input
          data-testid="role-password"
          type="password"
          value={form.password ?? ""}
          onChange={(e) =>
            onChange((f) => ({
              ...f,
              password: e.target.value === "" ? undefined : e.target.value,
            }))
          }
        />
      </label>
      <label style={{ fontSize: 12 }}>
        <input
          type="checkbox"
          data-testid="role-password-is-hash"
          checked={form.passwordIsHash}
          onChange={(e) => onChange((f) => ({ ...f, passwordIsHash: e.target.checked }))}
        />{" "}
        {t("object_editor.role.password_is_hash_label")}
      </label>
    </fieldset>
  );
}
