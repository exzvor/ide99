// — Schemas picker for publications when mode === "schemas"
// (FOR TABLES IN SCHEMA …). Reuses the existing S3 `schemaListSchemas`
// command — no new RPC.

import { type JSX, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { schemaListSchemas } from "../../../lib/tauri";

export interface SchemasPickerProps {
  connId: string;
  selected: string[];
  onChange: (next: string[]) => void;
}

export function SchemasPicker({ connId, selected, onChange }: SchemasPickerProps): JSX.Element {
  const { t } = useTranslation();
  const [available, setAvailable] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await schemaListSchemas(connId);
        if (!cancelled) setAvailable(list.map((s) => s.name));
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
      <div data-testid="pub-schemas-error" role="alert" style={{ fontSize: 12 }}>
        {error}
      </div>
    );
  }
  if (available === null) {
    return (
      <div data-testid="pub-schemas-loading" style={{ fontSize: 12 }}>
        {t("object_editor.common.loading")}
      </div>
    );
  }

  return (
    <div
      data-testid="pub-schemas-picker"
      style={{
        maxHeight: 200,
        overflow: "auto",
        border: "1px solid var(--hairline)",
        borderRadius: 4,
        padding: 6,
      }}
    >
      {available.map((name) => (
        <label key={name} style={{ display: "flex", gap: 6, fontSize: 12, alignItems: "center" }}>
          <input
            type="checkbox"
            data-testid={`pub-schema-${name}`}
            checked={selected.includes(name)}
            onChange={() => toggle(name)}
          />
          <span>{name}</span>
        </label>
      ))}
    </div>
  );
}
