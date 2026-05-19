// — Columns tab for TableEditor.

import type { JSX } from "react";
import { useTranslation } from "react-i18next";

import type { ColumnForm, TableForm } from "../ddl/types";
import { blankColumn } from "./blank";

export interface ColumnsTabProps {
  form: TableForm;
  onChange: (mutator: (form: TableForm) => TableForm) => void;
}

export function ColumnsTab({ form, onChange }: ColumnsTabProps): JSX.Element {
  const { t } = useTranslation();

  const updateCol = (id: string, partial: Partial<ColumnForm>): void => {
    onChange((f) => ({
      ...f,
      columns: f.columns.map((c) => (c.id === id ? { ...c, ...partial } : c)),
    }));
  };

  const removeCol = (id: string): void => {
    onChange((f) => ({ ...f, columns: f.columns.filter((c) => c.id !== id) }));
  };

  const addCol = (): void => {
    onChange((f) => ({ ...f, columns: [...f.columns, blankColumn()] }));
  };

  return (
    <div data-testid="columns-tab" style={{ padding: 12, overflow: "auto" }}>
      {/* `<colgroup>` + `table-layout: fixed` keeps the headers from merging
          when the panel narrows — without it long localized column names
          overlap each other. minWidth gives a horizontal scrollbar instead
          of a collapsed jumble. */}
      <table
        style={{
          width: "100%",
          minWidth: 720,
          borderCollapse: "collapse",
          fontSize: 13,
          tableLayout: "fixed",
        }}
      >
        <colgroup>
          <col style={{ width: "18%" }} />
          <col style={{ width: "16%" }} />
          <col style={{ width: 80 }} />
          <col style={{ width: "18%" }} />
          <col style={{ width: "18%" }} />
          <col style={{ width: "auto" }} />
          <col style={{ width: 32 }} />
        </colgroup>
        <thead>
          <tr>
            <th style={{ textAlign: "left", padding: "6px 4px", color: "var(--ink-3)" }}>
              {t("object_editor.columns.column")}
            </th>
            <th style={{ textAlign: "left", padding: "6px 4px", color: "var(--ink-3)" }}>
              {t("object_editor.columns.type")}
            </th>
            <th style={{ textAlign: "left", padding: "6px 4px", color: "var(--ink-3)" }}>
              {t("object_editor.columns.nullable")}
            </th>
            <th style={{ textAlign: "left", padding: "6px 4px", color: "var(--ink-3)" }}>
              {t("object_editor.columns.default")}
            </th>
            <th style={{ textAlign: "left", padding: "6px 4px", color: "var(--ink-3)" }}>
              {t("object_editor.columns.generated")}
            </th>
            <th style={{ textAlign: "left", padding: "6px 4px", color: "var(--ink-3)" }}>
              {t("object_editor.columns.comment")}
            </th>
            <th />
          </tr>
        </thead>
        <tbody>
          {form.columns.map((col) => (
            <tr key={col.id} data-testid={`column-row-${col.id}`}>
              <td style={{ padding: 4 }}>
                <input
                  data-testid={`column-name-${col.id}`}
                  aria-label={t("object_editor.columns.column")}
                  value={col.name}
                  onChange={(e) => updateCol(col.id, { name: e.target.value })}
                  className="q-input"
                  style={{ width: "100%" }}
                />
              </td>
              <td style={{ padding: 4 }}>
                <input
                  data-testid={`column-type-${col.id}`}
                  aria-label={t("object_editor.columns.type")}
                  value={col.typeText}
                  onChange={(e) => updateCol(col.id, { typeText: e.target.value })}
                  className="q-input"
                  style={{ width: "100%" }}
                />
              </td>
              <td style={{ padding: 4 }}>
                <input
                  data-testid={`column-nullable-${col.id}`}
                  aria-label={t("object_editor.columns.nullable")}
                  type="checkbox"
                  checked={col.nullable}
                  onChange={(e) => updateCol(col.id, { nullable: e.target.checked })}
                />
              </td>
              <td style={{ padding: 4 }}>
                <input
                  data-testid={`column-default-${col.id}`}
                  aria-label={t("object_editor.columns.default")}
                  value={col.default ?? ""}
                  onChange={(e) =>
                    updateCol(col.id, {
                      default: e.target.value === "" ? null : e.target.value,
                    })
                  }
                  className="q-input"
                  style={{ width: "100%" }}
                />
              </td>
              <td style={{ padding: 4 }}>
                <input
                  data-testid={`column-generated-toggle-${col.id}`}
                  aria-label={t("object_editor.columns.generated")}
                  type="checkbox"
                  checked={col.generated !== null}
                  onChange={(e) =>
                    updateCol(col.id, {
                      generated: e.target.checked ? { kind: "stored", expression: "" } : null,
                    })
                  }
                />
                {col.generated !== null ? (
                  <input
                    data-testid={`column-generated-expr-${col.id}`}
                    aria-label={t("object_editor.columns.generated_expr")}
                    value={col.generated.expression}
                    onChange={(e) =>
                      updateCol(col.id, {
                        generated: { kind: "stored", expression: e.target.value },
                      })
                    }
                    style={{ marginLeft: 4, width: "70%" }}
                  />
                ) : null}
              </td>
              <td style={{ padding: 4 }}>
                <input
                  data-testid={`column-comment-${col.id}`}
                  aria-label={t("object_editor.columns.comment")}
                  value={col.comment ?? ""}
                  onChange={(e) =>
                    updateCol(col.id, { comment: e.target.value === "" ? null : e.target.value })
                  }
                  className="q-input"
                  style={{ width: "100%" }}
                />
              </td>
              <td style={{ padding: 4 }}>
                <button
                  type="button"
                  data-testid={`column-remove-${col.id}`}
                  aria-label={t("object_editor.columns.remove_column")}
                  onClick={() => removeCol(col.id)}
                  className="btn-ghost"
                  style={{ background: "transparent", border: "none", cursor: "pointer" }}
                >
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        type="button"
        data-testid="columns-add"
        onClick={addCol}
        className="btn"
        style={{ marginTop: 12 }}
      >
        + {t("object_editor.columns.add_column")}
      </button>
    </div>
  );
}
