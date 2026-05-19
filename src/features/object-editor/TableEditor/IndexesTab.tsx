// — Indexes tab. Reuses IndexFormPanel from IndexEditor.

import type { JSX } from "react";
import { useTranslation } from "react-i18next";

import { IndexFormPanel } from "../IndexEditor/IndexFormPanel";
import type { IndexForm, TableForm } from "../ddl/types";
import { blankIndexForm } from "./blank";

export interface IndexesTabProps {
  form: TableForm;
  onChange: (mutator: (form: TableForm) => TableForm) => void;
}

export function IndexesTab({ form, onChange }: IndexesTabProps): JSX.Element {
  const { t } = useTranslation();

  const updateIdx = (id: string, mutator: (idx: IndexForm) => IndexForm): void => {
    onChange((f) => ({
      ...f,
      indexes: f.indexes.map((idx) => (idx.id === id ? mutator(idx) : idx)),
    }));
  };

  const removeIdx = (id: string): void => {
    onChange((f) => ({ ...f, indexes: f.indexes.filter((idx) => idx.id !== id) }));
  };

  const addIdx = (): void => {
    onChange((f) => ({
      ...f,
      indexes: [...f.indexes, blankIndexForm(f.schema, f.name)],
    }));
  };

  return (
    <div data-testid="indexes-tab" style={{ padding: 12 }}>
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {form.indexes.map((idx) => (
          <li key={idx.id} style={{ marginBottom: 8 }}>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                type="button"
                data-testid={`index-remove-${idx.id}`}
                onClick={() => removeIdx(idx.id)}
                aria-label={t("object_editor.constraints.remove")}
                style={{ background: "transparent", border: "none", cursor: "pointer" }}
              >
                ×
              </button>
            </div>
            <IndexFormPanel form={idx} onChange={(mut) => updateIdx(idx.id, mut)} inline />
          </li>
        ))}
      </ul>
      <button
        type="button"
        data-testid="index-add"
        onClick={addIdx}
        className="btn"
        style={{ marginTop: 12 }}
      >
        + {t("object_editor.indexes.add_index")}
      </button>
    </div>
  );
}
