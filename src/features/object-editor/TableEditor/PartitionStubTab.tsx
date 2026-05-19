// — Partition stub tab. Read-only display + banner.

import type { JSX } from "react";
import { useTranslation } from "react-i18next";

import type { TableForm } from "../ddl/types";

export interface PartitionStubTabProps {
  form: TableForm;
}

export function PartitionStubTab({ form }: PartitionStubTabProps): JSX.Element {
  const { t } = useTranslation();
  return (
    <div data-testid="partition-stub-tab" style={{ padding: 12 }}>
      {form.partition === null ? (
        <div data-testid="partition-none" style={{ fontSize: 13, marginBottom: 12 }}>
          {t("object_editor.table.partition_none")}
        </div>
      ) : (
        <dl
          data-testid="partition-info"
          style={{
            margin: 0,
            marginBottom: 12,
            fontSize: 13,
            display: "grid",
            gridTemplateColumns: "auto 1fr",
            columnGap: 8,
            rowGap: 4,
          }}
        >
          <dt style={{ fontWeight: 600 }}>{t("object_editor.table.partition_strategy")}</dt>
          <dd style={{ margin: 0 }}>{form.partition.strategy}</dd>
          <dt style={{ fontWeight: 600 }}>{t("object_editor.table.partition_key")}</dt>
          <dd style={{ margin: 0 }}>{form.partition.key}</dd>
        </dl>
      )}
      <div
        // biome-ignore lint/a11y/useSemanticElements: passive banner; not a form <output>.
        role="status"
        data-testid="partition-stub-banner"
        style={{
          padding: "8px 12px",
          background: "var(--accent-soft, rgba(212,155,28,0.08))",
          border: "1px solid var(--hairline)",
          borderRadius: 4,
          fontSize: 12,
        }}
      >
        {t("object_editor.stub.partition_advanced")}
      </div>
    </div>
  );
}
