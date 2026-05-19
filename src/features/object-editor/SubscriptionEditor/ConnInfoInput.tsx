// — `conninfo` textarea + plain-text password warning banner.
//
// We deliberately do not mask the password (per spec / Postgres semantics —
// pg_subscription stores it in clear text). The banner above the textarea
// makes the leak explicit so the user can decide whether to commit the DDL
// preview to version control.

import type { JSX } from "react";
import { useTranslation } from "react-i18next";

export interface ConnInfoInputProps {
  value: string;
  onChange: (next: string) => void;
}

export function ConnInfoInput({ value, onChange }: ConnInfoInputProps): JSX.Element {
  const { t } = useTranslation();
  return (
    <div data-testid="sub-conninfo-wrap" style={{ display: "grid", gap: 8 }}>
      <output
        data-testid="sub-conninfo-warning"
        style={{
          fontSize: 12,
          padding: "8px 12px",
          background: "var(--warn-q-soft)",
          border: "1px solid var(--warn-q)",
          color: "var(--warn-q)",
          borderRadius: "var(--r-md)",
          lineHeight: 1.4,
        }}
      >
        ⚠ {t("object_editor.subscription.conninfo_password_warning")}
      </output>
      <div className="q-field">
        <label htmlFor="sub-conninfo-input">{t("object_editor.subscription.conninfo_label")}</label>
        <textarea
          id="sub-conninfo-input"
          data-testid="sub-conninfo"
          className="q-input mono"
          aria-label={t("object_editor.subscription.conninfo_label")}
          value={value}
          rows={3}
          onChange={(e) => onChange(e.target.value)}
          style={{ resize: "vertical", paddingTop: 6, paddingBottom: 6, height: "auto" }}
        />
      </div>
    </div>
  );
}
