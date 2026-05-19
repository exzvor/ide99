// — FunctionEditor sub-component: return-type radio + type input.

import type { JSX } from "react";
import { useTranslation } from "react-i18next";

import type { ReturnKind } from "../ddl/types";

export interface ReturnTypeFormProps {
  returnKind: ReturnKind;
  returnType: string | undefined;
  onChange: (next: { returnKind: ReturnKind; returnType: string | undefined }) => void;
}

export function ReturnTypeForm({
  returnKind,
  returnType,
  onChange,
}: ReturnTypeFormProps): JSX.Element {
  const { t } = useTranslation();
  const typeDisabled = returnKind === "void" || returnKind === "trigger";

  // Pill-style radios — same treatment as the index-method picker, so the
  // four return kinds read as a single coherent control. The native input
  // is visually hidden but stays focusable for keyboard users.
  const pill = (kind: ReturnKind, label: string): JSX.Element => {
    const checked = returnKind === kind;
    return (
      <label
        key={kind}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 12px",
          fontSize: 12,
          color: checked ? "var(--accent)" : "var(--ink-3)",
          background: checked ? "var(--accent-soft)" : "var(--bg-elev)",
          border: `1px solid ${checked ? "var(--accent)" : "var(--border-strong-q)"}`,
          borderRadius: "var(--r-md)",
          cursor: "default",
        }}
      >
        <input
          data-testid={`fn-return-kind-${kind}`}
          type="radio"
          name="fn-return-kind"
          value={kind}
          checked={checked}
          onChange={() =>
            onChange({
              returnKind: kind,
              // Keep typed value when switching scalar/setof; clear for void/trigger.
              returnType: kind === "void" || kind === "trigger" ? undefined : (returnType ?? ""),
            })
          }
          style={{
            position: "absolute",
            width: 1,
            height: 1,
            opacity: 0,
            pointerEvents: "none",
          }}
        />
        {label}
      </label>
    );
  };

  return (
    <div data-testid="fn-return-type" style={{ display: "grid", gap: 10 }}>
      <div
        role="radiogroup"
        aria-label={t("object_editor.function.return_type_section")}
        style={{ display: "flex", flexWrap: "wrap", gap: 6 }}
      >
        {pill("scalar", t("object_editor.function.return_scalar"))}
        {pill("setof", t("object_editor.function.return_setof"))}
        {pill("void", t("object_editor.function.return_void"))}
        {pill("trigger", t("object_editor.function.return_trigger"))}
      </div>
      {!typeDisabled ? (
        <div className="q-field" style={{ maxWidth: 320 }}>
          <label htmlFor="fn-return-type-input">
            {t("object_editor.function.return_type_input")}
          </label>
          <input
            id="fn-return-type-input"
            data-testid="fn-return-type-input"
            className="q-input mono"
            value={returnType ?? ""}
            onChange={(e) => onChange({ returnKind, returnType: e.target.value })}
          />
        </div>
      ) : null}
    </div>
  );
}
