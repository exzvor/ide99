import { type JSX, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { LeafEditor, leafDisplay, leafKind } from "../tree/leafEditor";

export interface TableViewProps {
  /** Must be `unknown[]` of plain-object elements; component owns the
   * detection but never crashes on bad input. */
  value: unknown;
  onChange: (next: unknown) => void;
  readOnly: boolean;
}

/** Static helper used by the modal to decide whether the Table-mode
 * toggle is enabled. Spec §5.4: array of objects, ≤12 unique keys. */
export function isTabularValue(value: unknown): boolean {
  if (!Array.isArray(value) || value.length === 0) return false;
  const allObjects = value.every((v) => v !== null && typeof v === "object" && !Array.isArray(v));
  if (!allObjects) return false;
  const keys = new Set<string>();
  for (const obj of value as Record<string, unknown>[]) {
    for (const k of Object.keys(obj)) keys.add(k);
    if (keys.size > 12) return false;
  }
  return true;
}

/** Editable grid for an array-of-objects JSONB value. Headers are the
 * alphabetically-sorted union of keys. Returns null when the value
 * isn't tabular — the parent decides how to communicate that. */
export function TableView({ value, onChange, readOnly }: TableViewProps): JSX.Element | null {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<{ rowIdx: number; key: string } | null>(null);

  const headers = useMemo(() => {
    if (!Array.isArray(value)) return [];
    const keys = new Set<string>();
    for (const obj of value as Record<string, unknown>[]) {
      for (const k of Object.keys(obj)) keys.add(k);
    }
    return Array.from(keys).sort();
  }, [value]);

  if (!isTabularValue(value)) return null;
  const rows = value as Record<string, unknown>[];

  function setCell(rowIdx: number, key: string, next: unknown): void {
    const draft = rows.map((row, i) => (i === rowIdx ? { ...row, [key]: next } : row));
    onChange(draft);
  }

  function deleteRow(rowIdx: number): void {
    onChange(rows.filter((_, i) => i !== rowIdx));
  }

  function addRow(): void {
    onChange([...rows, {}]);
  }

  return (    <div
      data-testid="jsonb-table-view"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        overflow: "auto",
        fontFamily: "var(--font-mono-q, monospace)",
        fontSize: 12,
      }}
    >
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {headers.map((h) => (              <th
                key={h}
                scope="col"
                style={{
                  padding: "6px 10px",
                  fontFamily: "var(--font-sans-q, sans-serif)",
                  fontSize: 11,
                  color: "var(--ink-3)",
                  fontWeight: 500,
                  background: "var(--bg-sunken)",
                  borderBottom: "1px solid var(--hairline)",
                  textAlign: "left",
                }}
              >
                {h}
              </th>
))}
            {!readOnly ? (              <th
                scope="col"
                aria-label="row actions"
                style={{
                  width: 60,
                  padding: "6px 10px",
                  background: "var(--bg-sunken)",
                  borderBottom: "1px solid var(--hairline)",
                }}
              />
) : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIdx) => (            <tr
              // biome-ignore lint/suspicious/noArrayIndexKey: array index is the canonical identity of an array-of-objects row; we don't have a stable id.
              key={rowIdx}
              style={{ height: 30 }}
            >
              {headers.map((h) => {
                const has = h in row;
                const cellValue = row[h];
                const isEditing = editing?.rowIdx === rowIdx && editing.key === h;
                const cellKind = leafKind(cellValue);
                const isContainer = has && cellKind === "container";
                return (                  <td
                    key={h}
                    data-testid={`jsonb-table-cell-${rowIdx}-${h}`}
                    onClick={() => {
                      if (readOnly || isContainer) return;
                      setEditing({ rowIdx, key: h });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !readOnly && !isContainer) {
                        setEditing({ rowIdx, key: h });
                      }
                    }}
                    style={{
                      padding: "4px 10px",
                      borderBottom: "1px solid var(--hairline)",
                      cursor: readOnly || isContainer ? "default" : "pointer",
                      color: "var(--ink-2)",
                      verticalAlign: "middle",
                    }}
                  >
                    {isEditing && !readOnly ? (                      <LeafEditor
                        value={has ? cellValue : null}
                        onCommit={(next) => {
                          setCell(rowIdx, h, next);
                          setEditing(null);
                        }}
                        onCancel={() => setEditing(null)}
                        testid="jsonb-table-cell-input"
                      />
) : !has ? (                      ""
) : isContainer ? (                      <span style={{ color: "var(--ink-4)" }}>
                        {Array.isArray(cellValue) ? `[${(cellValue as unknown[]).length}]` : "{…}"}
                      </span>
) : (                      leafDisplay(cellValue)
)}
                  </td>
);
              })}
              {!readOnly ? (                <td
                  style={{
                    padding: "4px 10px",
                    borderBottom: "1px solid var(--hairline)",
                    textAlign: "right",
                  }}
                >
                  <button
                    type="button"
                    data-testid={`jsonb-table-delete-row-${rowIdx}`}
                    aria-label={t("jsonb.tree.delete")}
                    onClick={() => deleteRow(rowIdx)}
                    style={chipBtn}
                  >
                    ×
                  </button>
                </td>
) : null}
            </tr>
))}
        </tbody>
      </table>
      {!readOnly ? (        <div style={{ padding: 8 }}>
          <button type="button" data-testid="jsonb-table-add-row" onClick={addRow} style={chipBtn}>
            {t("jsonb.tree.addItem")}
          </button>
        </div>
) : null}
    </div>
);
}

const chipBtn: React.CSSProperties = {
  background: "transparent",
  border: "1px solid var(--hairline)",
  padding: "0 8px",
  fontSize: 11,
  color: "var(--ink-3)",
  cursor: "pointer",
  height: 20,
  lineHeight: "18px",
  fontFamily: "var(--font-sans-q, sans-serif)",
};
