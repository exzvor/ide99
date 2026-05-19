/**
 * — Operator-specific form fields for the JSONB Query Builder.
 *
 * Renders the appropriate controls based on the selected operator and
 * translates user input into the `BuilderValue` wire shape.
 */

import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import type { Comparator, PathSegment } from "../../../lib/tauri";
import { useInferredSchema } from "../inference";
import type { BuilderValue } from "./sqlGenerator";
import type { BuilderAction, BuilderFormState, OpKind } from "./state";

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

export interface OperatorFormProps {
  connId: string;
  fqn: { schema: string; table: string; column: string };
  state: BuilderFormState;
  dispatch: (action: BuilderAction) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Get leaf probable-type for the current selectedPath from the inferred schema. */
function useLeafKind(  connId: string,
  fqn: { schema: string; table: string; column: string },
  path: PathSegment[],
): { kind: string; values?: string[] } | null {
  const entry = useInferredSchema(connId, fqn);
  if (entry.status !== "ready" && entry.status !== "stale") return null;
  const schema = entry.schema;
  // Find the node whose path matches
  for (const node of schema.nodes) {
    if (pathsEqual(node.path, path)) {
      const k = node.kind as { kind: string; values?: string[] };
      return k;
    }
  }
  return null;
}

function pathsEqual(a: PathSegment[], b: PathSegment[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const av = a[i];
    const bv = b[i];
    if (!av || !bv) return false;
    if (av === "arraywildcard" || bv === "arraywildcard") {
      if (av !== bv) return false;
    } else if (typeof av === "object" && typeof bv === "object") {
      if (av.key !== bv.key) return false;
    } else {
      return false;
    }
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Comparator select (shared by PathExtract comparison + PathPredicate)
// ─────────────────────────────────────────────────────────────────────────────

interface ComparatorSelectProps {
  value: Comparator;
  onChange: (c: Comparator) => void;
  labelledBy?: string;
}

function ComparatorSelect({ value, onChange, labelledBy }: ComparatorSelectProps): JSX.Element {
  const { t } = useTranslation();
  const comparators: Comparator[] = ["eq", "ne", "gt", "lt", "ge", "le", "likeRegex"];
  return (    <select
      value={value}
      aria-labelledby={labelledBy}
      onChange={(e) => onChange(e.target.value as Comparator)}
      style={{ width: "100%" }}
    >
      {comparators.map((c) => (        <option key={c} value={c}>
          {t(`jsonb.builder.comparator.${c}`)}
        </option>
))}
    </select>
);
}

// ─────────────────────────────────────────────────────────────────────────────
// Type-aware value control
// ─────────────────────────────────────────────────────────────────────────────

interface TypeAwareValueControlProps {
  leafKind: { kind: string; values?: string[] } | null;
  value: BuilderValue;
  onChange: (v: BuilderValue) => void;
  labelId: string;
}

function TypeAwareValueControl({
  leafKind,
  value,
  onChange,
  labelId,
}: TypeAwareValueControlProps): JSX.Element {
  const { t } = useTranslation();

  const currentText =
    value.kind === "string" || value.kind === "number" || value.kind === "jsonLiteral"
      ? value.value
      : value.kind === "bool"
        ? String(value.value)
        : "";

  // Enum: native select + free-text fallback
  if (leafKind?.kind === "enum" && leafKind.values && leafKind.values.length > 0) {
    const isOther =
      value.kind === "string" && !leafKind.values.includes(value.value) && value.value !== "";
    const selectVal = value.kind === "string" ? (isOther ? "__other__" : value.value) : "";

    return (      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <select
          aria-labelledby={labelId}
          value={selectVal}
          onChange={(e) => {
            if (e.target.value === "__other__") {
              onChange({ kind: "string", value: currentText === "" ? "" : currentText });
            } else {
              onChange({ kind: "string", value: e.target.value });
            }
          }}
          style={{ width: "100%" }}
        >
          <option value="">—</option>
          {leafKind.values.map((v) => (            <option key={v} value={v}>
              {v}
            </option>
))}
          <option value="__other__">{t("jsonb.builder.valueLabel")} (other…)</option>
        </select>
        {(selectVal === "__other__" || isOther) && (          <input
            type="text"
            aria-label={`${t("jsonb.builder.valueLabel")} (custom)`}
            value={currentText}
            onChange={(e) => onChange({ kind: "string", value: e.target.value })}
            style={{ width: "100%" }}
          />
)}
      </div>
);
  }

  // Primitive: Boolean
  if (    leafKind?.kind === "primitive" &&
    (leafKind as { kind: string; value?: string }).value === "boolean"
) {
    const boolVal = value.kind === "bool" ? String(value.value) : "true";
    return (      <select
        aria-labelledby={labelId}
        value={boolVal}
        onChange={(e) => onChange({ kind: "bool", value: e.target.value === "true" })}
        style={{ width: "100%" }}
      >
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
);
  }

  // Primitive: Number
  if (    leafKind?.kind === "primitive" &&
    (leafKind as { kind: string; value?: string }).value === "number"
) {
    const numVal = value.kind === "number" ? value.value : "";
    return (      <input
        type="text"
        aria-labelledby={labelId}
        value={numVal}
        inputMode="decimal"
        placeholder="0"
        onChange={(e) => {
          const raw = e.target.value;
          // Only allow numeric chars
          if (raw === "" || /^-?[0-9]*\.?[0-9]*([eE][+-]?[0-9]*)?$/.test(raw)) {
            onChange({ kind: "number", value: raw });
          }
        }}
        style={{ width: "100%" }}
      />
);
  }

  // Primitive: Null
  if (    leafKind?.kind === "primitive" &&
    (leafKind as { kind: string; value?: string }).value === "null"
) {
    const jsonText = value.kind === "jsonLiteral" ? value.value : "";
    return (      <JsonTextarea
        labelId={labelId}
        value={jsonText}
        onChange={(v) => onChange({ kind: "jsonLiteral", value: v })}
        placeholder="null"
      />
);
  }

  // Object / Array or unknown → JSON textarea
  if (leafKind?.kind === "object" || leafKind?.kind === "array" || leafKind === null) {
    const jsonText = value.kind === "jsonLiteral" ? value.value : "";
    return (      <JsonTextarea
        labelId={labelId}
        value={jsonText}
        onChange={(v) => onChange({ kind: "jsonLiteral", value: v })}
        placeholder='{"key": "value"}'
      />
);
  }

  // Primitive: String (default)
  const strVal = value.kind === "string" ? value.value : "";
  return (    <input
      type="text"
      aria-labelledby={labelId}
      value={strVal}
      onChange={(e) => onChange({ kind: "string", value: e.target.value })}
      style={{ width: "100%" }}
    />
);
}

// ─────────────────────────────────────────────────────────────────────────────
// JSON textarea with inline parse lint
// ─────────────────────────────────────────────────────────────────────────────

interface JsonTextareaProps {
  labelId: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}

function JsonTextarea({ labelId, value, onChange, placeholder }: JsonTextareaProps): JSX.Element {
  const { t } = useTranslation();

  let parseError: string | null = null;
  if (value.trim() !== "") {
    try {
      JSON.parse(value);
    } catch (e: unknown) {
      parseError = e instanceof Error ? e.message : String(e);
    }
  }

  return (    <div>
      <textarea
        aria-labelledby={labelId}
        value={value}
        placeholder={placeholder}
        rows={3}
        onChange={(e) => onChange(e.target.value)}
        style={{ width: "100%", fontFamily: "var(--font-mono-q, monospace)", fontSize: 12 }}
        aria-invalid={parseError !== null ? "true" : undefined}
        aria-describedby={parseError !== null ? `${labelId}-json-error` : undefined}
      />
      {parseError !== null && (        <div
          id={`${labelId}-json-error`}
          role="alert"
          style={{ color: "var(--accent-strong-danger)", fontSize: 11, marginTop: 2 }}
        >
          {t("jsonb.builder.error.invalidJson", { message: parseError })}
        </div>
)}
    </div>
);
}

// ─────────────────────────────────────────────────────────────────────────────
// Path display
// ─────────────────────────────────────────────────────────────────────────────

function pathToDisplayString(path: PathSegment[]): string {
  return path.map((seg) => (seg === "arraywildcard" ? "[*]" : seg.key)).join(" → ");
}

// ─────────────────────────────────────────────────────────────────────────────
// Operator-specific sub-forms
// ─────────────────────────────────────────────────────────────────────────────

interface ExistenceFormProps {
  state: BuilderFormState;
  dispatch: (a: BuilderAction) => void;
}

function ExistenceForm({ state, dispatch }: ExistenceFormProps): JSX.Element {
  const { t } = useTranslation();
  // When path is set the reducer prefills value with the last Key segment;
  // user can override by typing. The warning is shown by the parent modal from
  // preview.warnings — do NOT render it here to avoid duplication.
  const keyVal = state.value.kind === "string" ? state.value.value : "";

  return (    <div>
      <label
        htmlFor="builder-existence-key"
        style={{ display: "block", marginBottom: 4, fontSize: 12 }}
      >
        {t("jsonb.builder.valueLabel")}
      </label>
      <input
        id="builder-existence-key"
        type="text"
        value={keyVal}
        placeholder={t("jsonb.builder.pathPlaceholder")}
        onChange={(e) =>
          dispatch({ type: "SET_VALUE", value: { kind: "string", value: e.target.value } })
        }
        style={{ width: "100%" }}
      />
    </div>
);
}

interface ContainmentFormProps {
  connId: string;
  fqn: { schema: string; table: string; column: string };
  state: BuilderFormState;
  dispatch: (a: BuilderAction) => void;
}

function ContainmentForm({ connId, fqn, state, dispatch }: ContainmentFormProps): JSX.Element {
  const { t } = useTranslation();
  const leafKind = useLeafKind(connId, fqn, state.selectedPath);

  return (    <div>
      <span
        id="builder-containment-value-label"
        style={{ display: "block", marginBottom: 4, fontSize: 12 }}
      >
        {t("jsonb.builder.valueLabel")}
      </span>
      <TypeAwareValueControl
        leafKind={leafKind}
        value={state.value}
        onChange={(v) => dispatch({ type: "SET_VALUE", value: v })}
        labelId="builder-containment-value-label"
      />
    </div>
);
}

interface PathExtractFormProps {
  connId: string;
  fqn: { schema: string; table: string; column: string };
  state: BuilderFormState;
  dispatch: (a: BuilderAction) => void;
}

function PathExtractForm({ connId, fqn, state, dispatch }: PathExtractFormProps): JSX.Element {
  const { t } = useTranslation();
  const leafKind = useLeafKind(connId, fqn, state.selectedPath);
  const isComparison = state.extractMode.kind === "comparison";

  return (    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
        <legend style={{ fontSize: 12, marginBottom: 4 }}>
          {t("jsonb.builder.extractMode.projection")}
        </legend>
        <label
          style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}
        >
          <input
            type="radio"
            name="extract-mode"
            value="projection"
            checked={!isComparison}
            onChange={() => dispatch({ type: "SET_EXTRACT_MODE", mode: "projection" })}
          />
          {t("jsonb.builder.extractMode.projection")}
        </label>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            cursor: "pointer",
            marginTop: 4,
          }}
        >
          <input
            type="radio"
            name="extract-mode"
            value="comparison"
            checked={isComparison}
            onChange={() => dispatch({ type: "SET_EXTRACT_MODE", mode: "comparison" })}
          />
          {t("jsonb.builder.extractMode.comparison")}
        </label>
      </fieldset>
      {isComparison && (        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {/* UI: PathExtract Comparison only supports =; label makes this explicit */}
          <span id="builder-extract-compare-label" style={{ fontSize: 12 }}>
            {t("jsonb.builder.comparator.eq")} {t("jsonb.builder.valueLabel")}
          </span>
          <TypeAwareValueControl
            leafKind={leafKind}
            value={state.extractComparisonValue}
            onChange={(v) => dispatch({ type: "SET_EXTRACT_COMPARISON_VALUE", value: v })}
            labelId="builder-extract-compare-label"
          />
        </div>
)}
    </div>
);
}

interface PathPredicateFormProps {
  connId: string;
  fqn: { schema: string; table: string; column: string };
  state: BuilderFormState;
  dispatch: (a: BuilderAction) => void;
}

function PathPredicateForm({ connId, fqn, state, dispatch }: PathPredicateFormProps): JSX.Element {
  const { t } = useTranslation();
  const leafKind = useLeafKind(connId, fqn, state.selectedPath);

  return (    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div>
        <span
          id="builder-predicate-comparator-label"
          style={{ display: "block", fontSize: 12, marginBottom: 4 }}
        >
          {t("jsonb.builder.operatorLabel")}
        </span>
        <ComparatorSelect
          value={state.predicateComparator}
          onChange={(c) => dispatch({ type: "SET_PREDICATE_COMPARATOR", comparator: c })}
          labelledBy="builder-predicate-comparator-label"
        />
      </div>
      <div>
        <span
          id="builder-predicate-value-label"
          style={{ display: "block", fontSize: 12, marginBottom: 4 }}
        >
          {t("jsonb.builder.valueLabel")}
        </span>
        <TypeAwareValueControl
          leafKind={leafKind}
          value={state.predicateRhs}
          onChange={(v) => dispatch({ type: "SET_PREDICATE_RHS", value: v })}
          labelId="builder-predicate-value-label"
        />
      </div>
    </div>
);
}

// ─────────────────────────────────────────────────────────────────────────────
// Operator dropdown
// ─────────────────────────────────────────────────────────────────────────────

const OP_KINDS: OpKind[] = ["existence", "containment", "pathExtract", "pathPredicate"];

interface OperatorDropdownProps {
  value: OpKind;
  onChange: (k: OpKind) => void;
}

function OperatorDropdown({ value, onChange }: OperatorDropdownProps): JSX.Element {
  const { t } = useTranslation();
  return (    <select
      id="builder-operator-select"
      value={value}
      onChange={(e) => onChange(e.target.value as OpKind)}
      style={{ width: "100%" }}
    >
      {OP_KINDS.map((k) => (        <option key={k} value={k}>
          {t(`jsonb.builder.operator.${k}`)}
        </option>
))}
    </select>
);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main OperatorForm
// ─────────────────────────────────────────────────────────────────────────────

export function OperatorForm({ connId, fqn, state, dispatch }: OperatorFormProps): JSX.Element {
  const { t } = useTranslation();
  const pathDisplay = pathToDisplayString(state.selectedPath);

  return (    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Operator selector */}
      <div>
        <label
          htmlFor="builder-operator-select"
          style={{ display: "block", marginBottom: 4, fontSize: 12, fontWeight: 600 }}
        >
          {t("jsonb.builder.operatorLabel")}
        </label>
        <OperatorDropdown
          value={state.opKind}
          onChange={(k) => dispatch({ type: "SET_OP", opKind: k })}
        />
      </div>

      {/* Path display */}
      {state.selectedPath.length > 0 ? (        <div>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 2 }}>
            {t("jsonb.builder.pathLabel")}
          </div>
          <div
            style={{
              fontSize: 12,
              color: "var(--ink-2)",
              fontFamily: "var(--font-mono-q, monospace)",
              padding: "4px 6px",
              background: "var(--bg-sunken)",
              borderRadius: 4,
            }}
            aria-label={t("jsonb.builder.pathLabel")}
          >
            {pathDisplay}
          </div>
        </div>
) : (        <div style={{ fontSize: 12, color: "var(--ink-3)", fontStyle: "italic" }}>
          {t("jsonb.builder.pathPlaceholder")}
        </div>
)}

      {/* Operator-specific fields */}
      {state.opKind === "existence" && <ExistenceForm state={state} dispatch={dispatch} />}
      {state.opKind === "containment" && (        <ContainmentForm connId={connId} fqn={fqn} state={state} dispatch={dispatch} />
)}
      {state.opKind === "pathExtract" && (        <PathExtractForm connId={connId} fqn={fqn} state={state} dispatch={dispatch} />
)}
      {state.opKind === "pathPredicate" && (        <PathPredicateForm connId={connId} fqn={fqn} state={state} dispatch={dispatch} />
)}
    </div>
);
}
