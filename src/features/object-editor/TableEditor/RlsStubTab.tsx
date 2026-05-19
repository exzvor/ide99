// — RLS stub tab. Toggle works ; full policy editor punted to v1.0.

import type { JSX } from "react";
import { useTranslation } from "react-i18next";

import type { TableForm } from "../ddl/types";

export interface RlsStubTabProps {
  form: TableForm;
  onChange: (mutator: (form: TableForm) => TableForm) => void;
}

export function RlsStubTab({ form, onChange }: RlsStubTabProps): JSX.Element {
  const { t } = useTranslation();
  return (    <div data-testid="rls-stub-tab" style={{ padding: 12 }}>
      <label style={{ display: "block", fontSize: 13, marginBottom: 12 }}>
        <input
          data-testid="rls-toggle"
          type="checkbox"
          checked={form.rls.enabled}
          onChange={(e) =>
            onChange((f) => ({ ...f, rls: { ...f.rls, enabled: e.target.checked } }))
          }
        />{" "}
        {t("object_editor.table.rls_label")}
      </label>
      <div
        // biome-ignore lint/a11y/useSemanticElements: passive banner; not a form <output>.
        role="status"
        data-testid="rls-stub-banner"
        style={{
          padding: "8px 12px",
          background: "var(--accent-soft, rgba(212,155,28,0.08))",
          border: "1px solid var(--hairline)",
          borderRadius: 4,
          fontSize: 12,
        }}
      >
        {t("object_editor.stub.rls_advanced")}
      </div>
    </div>
);
}
