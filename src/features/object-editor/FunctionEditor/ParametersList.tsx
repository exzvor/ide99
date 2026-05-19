// — FunctionEditor sub-component: editable parameters list.
//
// Shared between FunctionEditor and ProcedureEditor (same shape). Each row is
// keyed by stable UUID `id` so renames don't trigger remount + diff churn.

import type { JSX } from "react";
import { useTranslation } from "react-i18next";

import type { FunctionParameter, ParameterMode } from "../ddl/types";

export interface ParametersListProps {
  parameters: FunctionParameter[];
  onChange: (next: FunctionParameter[]) => void;
  /** test-id prefix to keep selectors disjoint between Function/Procedure editors. */
  testIdPrefix?: string;
}

function blankParameter(): FunctionParameter {
  return {
    id: crypto.randomUUID(),
    name: "",
    mode: "in",
    type: "integer",
    default: null,
  };
}

export function ParametersList({
  parameters,
  onChange,
  testIdPrefix = "fn-param",
}: ParametersListProps): JSX.Element {
  const { t } = useTranslation();

  const updateAt = (index: number, patch: Partial<FunctionParameter>): void => {
    const next = parameters.map((p, i) => (i === index ? { ...p, ...patch } : p));
    onChange(next);
  };
  const removeAt = (index: number): void => {
    onChange(parameters.filter((_, i) => i !== index));
  };
  const add = (): void => {
    onChange([...parameters, blankParameter()]);
  };

  const gridCols = "minmax(0, 1.4fr) 130px minmax(0, 1.4fr) minmax(0, 1fr) 32px";
  const hasRows = parameters.length > 0;
  return (
    <div data-testid={`${testIdPrefix}-list`} style={{ display: "grid", gap: 8 }}>
      {hasRows ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: gridCols,
            gap: 8,
            fontSize: 11.5,
            fontWeight: 500,
            color: "var(--ink-3)",
            padding: "0 4px",
          }}
        >
          <span>{t("object_editor.function.param_name")}</span>
          <span>{t("object_editor.function.param_mode")}</span>
          <span>{t("object_editor.function.param_type")}</span>
          <span>{t("object_editor.function.param_default")}</span>
          <span />
        </div>
      ) : null}
      {parameters.map((p, i) => (
        <div
          key={p.id}
          data-testid={`${testIdPrefix}-row-${p.id}`}
          style={{
            display: "grid",
            gridTemplateColumns: gridCols,
            gap: 8,
            alignItems: "center",
          }}
        >
          <input
            data-testid={`${testIdPrefix}-name-${p.id}`}
            className="q-input"
            value={p.name}
            onChange={(e) => updateAt(i, { name: e.target.value })}
            aria-label={t("object_editor.function.param_name")}
          />
          <select
            data-testid={`${testIdPrefix}-mode-${p.id}`}
            className="q-select"
            value={p.mode}
            onChange={(e) => updateAt(i, { mode: e.target.value as ParameterMode })}
            aria-label={t("object_editor.function.param_mode")}
          >
            <option value="in">{t("object_editor.function.mode_in")}</option>
            <option value="out">{t("object_editor.function.mode_out")}</option>
            <option value="inout">{t("object_editor.function.mode_inout")}</option>
            <option value="variadic">{t("object_editor.function.mode_variadic")}</option>
          </select>
          <input
            data-testid={`${testIdPrefix}-type-${p.id}`}
            className="q-input mono"
            value={p.type}
            onChange={(e) => updateAt(i, { type: e.target.value })}
            aria-label={t("object_editor.function.param_type")}
          />
          <input
            data-testid={`${testIdPrefix}-default-${p.id}`}
            className="q-input mono"
            value={p.default ?? ""}
            onChange={(e) =>
              updateAt(i, { default: e.target.value.trim() === "" ? null : e.target.value })
            }
            aria-label={t("object_editor.function.param_default")}
          />
          <button
            type="button"
            data-testid={`${testIdPrefix}-remove-${p.id}`}
            onClick={() => removeAt(i)}
            aria-label={t("object_editor.function.remove_parameter")}
            className="btn-ghost"
            style={{ width: 28, height: 28, padding: 0, fontSize: 16 }}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        data-testid={`${testIdPrefix}-add`}
        onClick={add}
        className="btn"
        style={{ alignSelf: "start", marginTop: 4 }}
      >
        + {t("object_editor.function.add_parameter")}
      </button>
    </div>
  );
}
