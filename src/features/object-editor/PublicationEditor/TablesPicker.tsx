// — Tables picker for publications: queries publishable tables
// (regular relkind, current DB) once on mount, groups them by schema, and
// renders one checkbox row per table beneath a sticky schema header.
// Selection is mirrored back to the parent as `QualifiedNameForm[]`
// (id-stamped so the publication-DDL diff can detect add/drop without
// reorder noise).
//
// previously this was a flat list with `schema.name` rows —
// painful to scan in multi-schema databases. The grouped layout matches
// the spec acceptance criterion.

import { type JSX, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { type QualifiedNameDto, schemaListPublishableTables } from "../../../lib/tauri";
import type { QualifiedNameForm } from "../ddl/types";

let counter = 0;
const newId = (): string => `s25-pub-tbl-${Date.now()}-${++counter}`;

export interface TablesPickerProps {
  connId: string;
  selected: QualifiedNameForm[];
  onChange: (next: QualifiedNameForm[]) => void;
}

function key(q: { schema: string; name: string }): string {
  return `${q.schema}.${q.name}`;
}

export function TablesPicker({ connId, selected, onChange }: TablesPickerProps): JSX.Element {
  const { t } = useTranslation();
  const [available, setAvailable] = useState<QualifiedNameDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await schemaListPublishableTables(connId);
        if (!cancelled) setAvailable(list);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connId]);

  const selectedSet = new Set(selected.map(key));

  const toggle = (q: QualifiedNameDto): void => {
    const k = key(q);
    if (selectedSet.has(k)) {
      onChange(selected.filter((it) => key(it) !== k));
    } else {
      onChange([...selected, { id: newId(), schema: q.schema, name: q.name }]);
    }
  };

  if (error) {
    return (
      <div data-testid="pub-tables-error" role="alert" style={{ fontSize: 12 }}>
        {error}
      </div>
    );
  }
  if (available === null) {
    return (
      <div data-testid="pub-tables-loading" style={{ fontSize: 12 }}>
        {t("object_editor.common.loading")}
      </div>
    );
  }
  if (available.length === 0) {
    return (
      <div data-testid="pub-tables-empty" style={{ fontSize: 12 }}>
        {t("object_editor.publication.no_publishable_tables")}
      </div>
    );
  }

  // Group tables by schema for rendering. Keys preserve first-seen order
  // (matches what the backend already returned, sorted by `nspname, relname`).
  const grouped = new Map<string, QualifiedNameDto[]>();
  for (const q of available) {
    const list = grouped.get(q.schema);
    if (list) list.push(q);
    else grouped.set(q.schema, [q]);
  }

  return (
    <div
      data-testid="pub-tables-picker"
      style={{
        maxHeight: 240,
        overflow: "auto",
        border: "1px solid var(--hairline)",
        borderRadius: 4,
        padding: 6,
      }}
    >
      {Array.from(grouped.entries()).map(([schema, tables]) => (
        <div key={schema} data-testid={`pub-tables-group-${schema}`}>
          <div
            data-testid={`pub-tables-group-header-${schema}`}
            style={{
              position: "sticky",
              top: -6,
              padding: "4px 0 2px",
              fontSize: 11,
              fontWeight: 600,
              color: "var(--ink-3)",
              background: "var(--bg-2, #1f1f1f)",
              borderBottom: "1px solid var(--hairline)",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            {schema}
          </div>
          {tables.map((q) => {
            const k = key(q);
            return (
              <label
                key={k}
                data-testid={`pub-table-row-${q.schema}-${q.name}`}
                style={{
                  display: "flex",
                  gap: 6,
                  fontSize: 12,
                  alignItems: "center",
                  padding: "2px 4px 2px 12px",
                }}
              >
                <input
                  type="checkbox"
                  data-testid={`pub-table-${q.schema}-${q.name}`}
                  checked={selectedSet.has(k)}
                  onChange={() => toggle(q)}
                />
                <span>{q.name}</span>
              </label>
            );
          })}
        </div>
      ))}
    </div>
  );
}
