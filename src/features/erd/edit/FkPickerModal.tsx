// src/features/erd/edit/FkPickerModal.tsx
import { type JSX, useState } from "react";
import { useTranslation } from "react-i18next";

interface ColOption {
  id: string;
  name: string;
  dataType: string;
  isPkOrUnique?: boolean;
}
interface TableSide {
  id: string;
  name: string;
  columns: ColOption[];
}

interface Props {
  open: boolean;
  sourceTable: TableSide;
  targetTable: TableSide;
  onConfirm(sourceColumns: string[], targetColumns: string[], constraintName: string): void;
  onCancel(): void;
}

export function FkPickerModal({
  open,
  sourceTable,
  targetTable,
  onConfirm,
  onCancel,
}: Props): JSX.Element | null {
  const { t } = useTranslation();
  const [src, setSrc] = useState<string[]>([]);
  const [tgt, setTgt] = useState<string[]>([]);
  const [name, setName] = useState<string>(`${sourceTable.name}_${targetTable.name}_fkey`);
  if (!open) return null;

  const toggle = (set: (v: string[]) => void, current: string[], id: string) => {
    set(current.includes(id) ? current.filter((x) => x !== id) : [...current, id]);
  };
  const canConfirm = src.length > 0 && tgt.length === src.length && name.trim() !== "";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="fk-modal-title"
      data-testid="fk-picker-modal"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <div style={{ background: "var(--bg)", padding: 20, borderRadius: 6, minWidth: 540 }}>
        <h2 id="fk-modal-title" style={{ margin: 0, marginBottom: 12 }}>
          {t("erd.edit.fk.modal.title")}
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <section>
            <h3 style={{ margin: 0, marginBottom: 6 }}>
              {t("erd.edit.fk.modal.from")}: {sourceTable.name}
            </h3>
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {sourceTable.columns.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    data-testid={`fk-source-${c.id}`}
                    aria-pressed={src.includes(c.id)}
                    onClick={() => toggle(setSrc, src, c.id)}
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      padding: "4px 6px",
                      background: src.includes(c.id)
                        ? "var(--accent-subtle, #2a4a6a)"
                        : "transparent",
                    }}
                  >
                    {c.name} <span style={{ opacity: 0.6, fontSize: 11 }}>{c.dataType}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h3 style={{ margin: 0, marginBottom: 6 }}>
              {t("erd.edit.fk.modal.to")}: {targetTable.name}
            </h3>
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {targetTable.columns.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    data-testid={`fk-target-${c.id}`}
                    aria-pressed={tgt.includes(c.id)}
                    onClick={() => toggle(setTgt, tgt, c.id)}
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      padding: "4px 6px",
                      background: tgt.includes(c.id)
                        ? "var(--accent-subtle, #2a4a6a)"
                        : "transparent",
                    }}
                  >
                    {c.name} <span style={{ opacity: 0.6, fontSize: 11 }}>{c.dataType}</span>
                    {c.isPkOrUnique === false && (
                      <span style={{ marginLeft: 6, color: "var(--warn, #d49b1c)", fontSize: 10 }}>
                        {t("erd.edit.fk.modal.not_pk_unique")}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>
        <label style={{ display: "block", marginTop: 12, fontSize: 12 }}>
          {t("erd.edit.fk.modal.constraint_name")}
          <input
            type="text"
            data-testid="fk-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{
              display: "block",
              width: "100%",
              marginTop: 4,
              padding: 6,
              background: "var(--bg-2)",
              color: "inherit",
              border: "1px solid var(--border)",
              borderRadius: 3,
            }}
          />
        </label>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
          <button type="button" data-testid="fk-cancel" className="btn-icon" onClick={onCancel}>
            {t("erd.edit.cancel")}
          </button>
          <button
            type="button"
            data-testid="fk-confirm"
            className="btn-icon"
            style={{ background: "var(--accent, #4a90e2)", color: "#fff" }}
            disabled={!canConfirm}
            onClick={() => onConfirm(src, tgt, name)}
          >
            {t("erd.edit.fk.modal.add")}
          </button>
        </div>
      </div>
    </div>
  );
}
