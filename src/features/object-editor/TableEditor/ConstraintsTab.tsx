// — Constraints tab.

import type { JSX } from "react";
import { useTranslation } from "react-i18next";

import type { ConstraintForm, TableForm } from "../ddl/types";
import {
  blankCheckConstraint,
  blankFkConstraint,
  blankPkConstraint,
  blankUniqueConstraint,
} from "./blank";

export interface ConstraintsTabProps {
  form: TableForm;
  onChange: (mutator: (form: TableForm) => TableForm) => void;
}

function csvToList(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function listToCsv(list: string[]): string {
  return list.join(", ");
}

export function ConstraintsTab({ form, onChange }: ConstraintsTabProps): JSX.Element {
  const { t } = useTranslation();

  const updateCon = (id: string, partial: Partial<ConstraintForm>): void => {
    onChange((f) => ({
      ...f,
      constraints: f.constraints.map((c) =>
        c.id === id ? ({ ...c, ...partial } as ConstraintForm) : c,
),
    }));
  };
  const removeCon = (id: string): void => {
    onChange((f) => ({ ...f, constraints: f.constraints.filter((c) => c.id !== id) }));
  };
  const addCon = (kind: "pk" | "unique" | "fk" | "check"): void => {
    onChange((f) => ({
      ...f,
      constraints: [
        ...f.constraints,
        kind === "pk"
          ? blankPkConstraint()
          : kind === "unique"
            ? blankUniqueConstraint()
            : kind === "fk"
              ? blankFkConstraint()
              : blankCheckConstraint(),
      ],
    }));
  };

  return (    <div data-testid="constraints-tab" style={{ padding: 12 }}>
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {form.constraints.map((c) => (          <li
            key={c.id}
            data-testid={`constraint-row-${c.id}`}
            data-kind={c.kind}
            style={{
              border: "1px solid var(--hairline)",
              borderRadius: 4,
              padding: 8,
              marginBottom: 8,
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
              {c.kind.toUpperCase()}
              <button
                type="button"
                data-testid={`constraint-remove-${c.id}`}
                aria-label={t("object_editor.constraints.remove")}
                onClick={() => removeCon(c.id)}
                style={{
                  float: "right",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                ×
              </button>
            </div>
            {(c.kind === "unique" || c.kind === "fk" || c.kind === "check") && (              <label style={{ display: "block", fontSize: 12 }}>
                {t("object_editor.constraints.constraint_name")}
                <input
                  data-testid={`constraint-name-${c.id}`}
                  value={c.name ?? ""}
                  onChange={(e) =>
                    updateCon(c.id, { name: e.target.value === "" ? undefined : e.target.value })
                  }
                  className="q-input"
                  style={{ width: "100%" }}
                />
              </label>
)}
            {(c.kind === "pk" || c.kind === "unique" || c.kind === "fk") && (              <label style={{ display: "block", fontSize: 12, marginTop: 4 }}>
                {t("object_editor.constraints.columns")}
                <input
                  data-testid={`constraint-columns-${c.id}`}
                  value={listToCsv(c.columns)}
                  onChange={(e) => updateCon(c.id, { columns: csvToList(e.target.value) })}
                  className="q-input"
                  style={{ width: "100%" }}
                />
              </label>
)}
            {c.kind === "fk" && (              <>
                <label style={{ display: "block", fontSize: 12, marginTop: 4 }}>
                  {t("object_editor.constraints.ref_schema")}
                  <input
                    data-testid={`constraint-ref-schema-${c.id}`}
                    value={c.refSchema}
                    onChange={(e) => updateCon(c.id, { refSchema: e.target.value })}
                    className="q-input"
                    style={{ width: "100%" }}
                  />
                </label>
                <label style={{ display: "block", fontSize: 12, marginTop: 4 }}>
                  {t("object_editor.constraints.ref_table")}
                  <input
                    data-testid={`constraint-ref-table-${c.id}`}
                    value={c.refTable}
                    onChange={(e) => updateCon(c.id, { refTable: e.target.value })}
                    className="q-input"
                    style={{ width: "100%" }}
                  />
                </label>
                <label style={{ display: "block", fontSize: 12, marginTop: 4 }}>
                  {t("object_editor.constraints.ref_columns")}
                  <input
                    data-testid={`constraint-ref-columns-${c.id}`}
                    value={listToCsv(c.refColumns)}
                    onChange={(e) => updateCon(c.id, { refColumns: csvToList(e.target.value) })}
                    className="q-input"
                    style={{ width: "100%" }}
                  />
                </label>
              </>
)}
            {c.kind === "check" && (              <label style={{ display: "block", fontSize: 12, marginTop: 4 }}>
                {t("object_editor.constraints.expression")}
                <input
                  data-testid={`constraint-expr-${c.id}`}
                  value={c.expression}
                  onChange={(e) => updateCon(c.id, { expression: e.target.value })}
                  className="q-input"
                  style={{ width: "100%" }}
                />
              </label>
)}
          </li>
))}
      </ul>
      {/* `.btn-icon` was a 28×28 square — text labels never fit and the four
          buttons stacked. `.btn` has the right text padding and the row reads
          as a normal action toolbar. */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button
          type="button"
          data-testid="constraint-add-pk"
          onClick={() => addCon("pk")}
          className="btn"
        >
          + {t("object_editor.constraints.add_pk")}
        </button>
        <button
          type="button"
          data-testid="constraint-add-unique"
          onClick={() => addCon("unique")}
          className="btn"
        >
          + {t("object_editor.constraints.add_unique")}
        </button>
        <button
          type="button"
          data-testid="constraint-add-fk"
          onClick={() => addCon("fk")}
          className="btn"
        >
          + {t("object_editor.constraints.add_fk")}
        </button>
        <button
          type="button"
          data-testid="constraint-add-check"
          onClick={() => addCon("check")}
          className="btn"
        >
          + {t("object_editor.constraints.add_check")}
        </button>
      </div>
    </div>
);
}
