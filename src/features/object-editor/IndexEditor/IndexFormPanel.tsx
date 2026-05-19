// — IndexFormPanel: shared inline form for IndexEditor (standalone)
// and TableEditor's IndexesTab. Pure controlled component — caller owns state.

import type { JSX } from "react";
import { useTranslation } from "react-i18next";

import type { IndexColumnForm, IndexForm } from "../ddl/types";

export interface IndexFormPanelProps {
  form: IndexForm;
  onChange: (mutator: (form: IndexForm) => IndexForm) => void;
  /** When true, the table picker is rendered disabled (parent context owns table). */
  inline?: boolean;
}

const METHODS: IndexForm["method"][] = [
  "btree",
  "hash",
  "gin",
  "gist",
  "brin",
  "spgist",
  "hnsw",
  "ivfflat",
];

function csvToList(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function IndexFormPanel({ form, onChange, inline }: IndexFormPanelProps): JSX.Element {
  const { t } = useTranslation();

  const update = (partial: Partial<IndexForm>): void => {
    onChange((f) => ({ ...f, ...partial }));
  };

  const updateCol = (idx: number, partial: Partial<IndexColumnForm>): void => {
    onChange((f) => ({
      ...f,
      columns: f.columns.map((c, i) => (i === idx ? { ...c, ...partial } : c)),
    }));
  };

  const addCol = (): void => {
    onChange((f) => ({ ...f, columns: [...f.columns, { expr: "" }] }));
  };

  const removeCol = (idx: number): void => {
    onChange((f) => ({ ...f, columns: f.columns.filter((_, i) => i !== idx) }));
  };

  return (
    <div
      data-testid={`index-form-panel-${form.id}`}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 14,
        padding: 12,
      }}
    >
      <div className="q-field">
        <label htmlFor={`index-name-${form.id}`}>{t("object_editor.indexes.index_name")}</label>
        <input
          id={`index-name-${form.id}`}
          data-testid="index-name"
          className="q-input"
          value={form.name}
          onChange={(e) => update({ name: e.target.value })}
        />
      </div>
      <div className="q-field">
        <label htmlFor={`index-table-${form.id}`}>{t("object_editor.indexes.table")}</label>
        <input
          id={`index-table-${form.id}`}
          data-testid="index-table"
          className="q-input"
          value={form.table}
          disabled={inline === true}
          onChange={(e) => update({ table: e.target.value })}
        />
      </div>

      <div>
        <div className="q-label" style={{ marginBottom: 6 }}>
          {t("object_editor.indexes.method")}
        </div>
        {/* Method picker — rendered as a single wrapping row of pills so the
            8 methods don't squeeze together with no separation. Each radio
            input is visually hidden; the label is the clickable target. */}
        <div
          role="radiogroup"
          aria-label={t("object_editor.indexes.method")}
          style={{ display: "flex", flexWrap: "wrap", gap: 6 }}
        >
          {METHODS.map((m) => {
            const checked = form.method === m;
            return (
              <label
                key={m}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "4px 12px",
                  fontSize: 12,
                  fontFamily: "var(--font-mono-q)",
                  color: checked ? "var(--accent)" : "var(--ink-3)",
                  background: checked ? "var(--accent-soft)" : "var(--bg-elev)",
                  border: `1px solid ${checked ? "var(--accent)" : "var(--border-strong-q)"}`,
                  borderRadius: "var(--r-md)",
                  cursor: "default",
                }}
              >
                <input
                  data-testid={`index-method-${m}`}
                  type="radio"
                  name={`index-method-${form.id}`}
                  value={m}
                  checked={checked}
                  onChange={() => update({ method: m })}
                  style={{
                    position: "absolute",
                    width: 1,
                    height: 1,
                    opacity: 0,
                    pointerEvents: "none",
                  }}
                />
                {m}
              </label>
            );
          })}
        </div>
      </div>

      {form.method === "hnsw" && (
        <div
          data-testid="index-with-hnsw"
          style={{ display: "flex", gap: 12, alignItems: "flex-end" }}
        >
          <div className="q-field" style={{ width: 100 }}>
            <label htmlFor={`index-hnsw-m-${form.id}`}>m</label>
            <input
              id={`index-hnsw-m-${form.id}`}
              data-testid="index-with-hnsw-m"
              className="q-input"
              type="number"
              min={2}
              value={form.withOptions.m ?? 16}
              onChange={(e) =>
                update({ withOptions: { ...form.withOptions, m: Number(e.target.value) } })
              }
            />
          </div>
          <div className="q-field" style={{ width: 140 }}>
            <label htmlFor={`index-hnsw-ef-${form.id}`}>ef_construction</label>
            <input
              id={`index-hnsw-ef-${form.id}`}
              data-testid="index-with-hnsw-ef"
              className="q-input"
              type="number"
              min={4}
              value={form.withOptions.ef_construction ?? 64}
              onChange={(e) =>
                update({
                  withOptions: {
                    ...form.withOptions,
                    ef_construction: Number(e.target.value),
                  },
                })
              }
            />
          </div>
        </div>
      )}
      {form.method === "ivfflat" && (
        <div data-testid="index-with-ivfflat" style={{ display: "flex", gap: 12 }}>
          <div className="q-field" style={{ width: 100 }}>
            <label htmlFor={`index-ivfflat-lists-${form.id}`}>lists</label>
            <input
              id={`index-ivfflat-lists-${form.id}`}
              data-testid="index-with-ivfflat-lists"
              className="q-input"
              type="number"
              min={1}
              value={form.withOptions.lists ?? 100}
              onChange={(e) =>
                update({ withOptions: { ...form.withOptions, lists: Number(e.target.value) } })
              }
            />
          </div>
        </div>
      )}

      <label className="q-checkbox" data-testid="index-unique-label">
        <input
          data-testid="index-unique"
          type="checkbox"
          checked={form.unique}
          onChange={(e) => update({ unique: e.target.checked })}
        />
        {t("object_editor.indexes.unique")}
      </label>

      <div>
        <div className="q-label" style={{ marginBottom: 6 }}>
          {t("object_editor.indexes.column_expr")}
        </div>
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
          {form.columns.map((col, i) => (
            <li
              key={`${form.id}-col-${i}`}
              data-testid={`index-col-row-${i}`}
              style={{ display: "flex", gap: 6, alignItems: "center" }}
            >
              <input
                data-testid={`index-col-expr-${i}`}
                aria-label={t("object_editor.indexes.column_expr")}
                className="q-input"
                value={col.expr}
                onChange={(e) => updateCol(i, { expr: e.target.value })}
                style={{ flex: 1 }}
              />
              <select
                data-testid={`index-col-dir-${i}`}
                aria-label={t("object_editor.indexes.direction")}
                className="q-select"
                value={col.direction ?? ""}
                onChange={(e) =>
                  updateCol(i, {
                    direction:
                      e.target.value === "" ? undefined : (e.target.value as "asc" | "desc"),
                  })
                }
                style={{ width: 90 }}
              >
                <option value="">—</option>
                <option value="asc">{t("object_editor.indexes.asc")}</option>
                <option value="desc">{t("object_editor.indexes.desc")}</option>
              </select>
              <select
                data-testid={`index-col-nulls-${i}`}
                aria-label={t("object_editor.indexes.nulls")}
                className="q-select"
                value={col.nulls ?? ""}
                onChange={(e) =>
                  updateCol(i, {
                    nulls: e.target.value === "" ? undefined : (e.target.value as "first" | "last"),
                  })
                }
                style={{ width: 110 }}
              >
                <option value="">—</option>
                <option value="first">{t("object_editor.indexes.nulls_first")}</option>
                <option value="last">{t("object_editor.indexes.nulls_last")}</option>
              </select>
              <input
                data-testid={`index-col-opclass-${i}`}
                aria-label={t("object_editor.indexes.opclass")}
                className="q-input"
                placeholder="opclass"
                value={col.opclass ?? ""}
                onChange={(e) =>
                  updateCol(i, { opclass: e.target.value === "" ? undefined : e.target.value })
                }
                style={{ width: 110 }}
              />
              <button
                type="button"
                data-testid={`index-col-remove-${i}`}
                onClick={() => removeCol(i)}
                aria-label={t("object_editor.constraints.remove")}
                className="btn-ghost"
                style={{ width: 28, height: 28, padding: 0, fontSize: 16 }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          data-testid="index-col-add"
          onClick={addCol}
          className="btn"
          style={{ marginTop: 8 }}
        >
          + {t("object_editor.common.add")}
        </button>
      </div>

      <div className="q-field">
        <label htmlFor={`index-include-${form.id}`}>{t("object_editor.indexes.include")}</label>
        <input
          id={`index-include-${form.id}`}
          data-testid="index-include"
          className="q-input"
          value={form.include.join(", ")}
          onChange={(e) => update({ include: csvToList(e.target.value) })}
        />
      </div>
      <div className="q-field">
        <label htmlFor={`index-predicate-${form.id}`}>{t("object_editor.indexes.predicate")}</label>
        <input
          id={`index-predicate-${form.id}`}
          data-testid="index-predicate"
          className="q-input"
          value={form.predicate ?? ""}
          onChange={(e) => update({ predicate: e.target.value === "" ? null : e.target.value })}
        />
      </div>
    </div>
  );
}
