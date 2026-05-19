// — owner: .
//
// Three-mode controlled input used by every kNN / hybrid surface that needs
// a query-time vector expression:
//
// 1. literal    — a JSON-array literal, e.g. `[0.1, 0.2]`. Validated client-
// side as a JSON array of numbers; invalid input shows a
// red hint but never blocks typing.
// 2. sql-fn     — free-text SQL function call, e.g. `public.embed('hi')`.
// No client-side validation — server validates at execute.
// 3. v1.1 stub  — disabled "Generate embedding" button shown for
// discoverability of the upcoming AI integration.
//
// The component is fully controlled — caller owns the `VectorValue` state.

import type { ChangeEvent, JSX } from "react";

export type VectorValueMode = "literal" | "sql-fn";
export type VectorValue = { mode: "literal"; literal: string } | { mode: "sql-fn"; expr: string };

export interface VectorValueInputProps {
  value: VectorValue;
  onChange: (v: VectorValue) => void;
  /** Optional dim hint shown next to the literal-mode input. */
  dimHint?: number;
}

/**
 * Returns true iff the given string parses as a JSON array of finite numbers.
 * Empty input is considered valid (no error rendered).
 */
function isValidVectorLiteral(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed === "") return true;
  try {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) return false;
    return parsed.every((n) => typeof n === "number" && Number.isFinite(n));
  } catch {
    return false;
  }
}

export function VectorValueInput(props: VectorValueInputProps): JSX.Element {
  const { value, onChange, dimHint } = props;

  const handleModeChange = (e: ChangeEvent<HTMLSelectElement>): void => {
    const next = e.target.value as VectorValueMode;
    if (next === value.mode) return;
    if (next === "literal") {
      onChange({ mode: "literal", literal: "" });
    } else {
      onChange({ mode: "sql-fn", expr: "" });
    }
  };

  const literalText = value.mode === "literal" ? value.literal : "";
  const literalValid = value.mode === "literal" ? isValidVectorLiteral(literalText) : true;

  return (
    <div
      data-testid="vector-value-input"
      style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12 }}
    >
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <label style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: 11, color: "var(--ink-3)" }}>Input mode</span>
          <select data-testid="vector-input-mode" value={value.mode} onChange={handleModeChange}>
            <option value="literal">Literal</option>
            <option value="sql-fn">SQL function</option>
          </select>
        </label>
        <button
          type="button"
          data-testid="vector-input-stub-button"
          disabled
          tabIndex={-1}
          style={{ fontSize: 12, opacity: 0.6, cursor: "not-allowed" }}
          title="Coming in v1.1"
        >
          Generate embedding (v1.1)
        </button>
      </div>

      {value.mode === "literal" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <textarea
            data-testid="vector-input-literal"
            value={value.literal}
            onChange={(e) => onChange({ mode: "literal", literal: e.target.value })}
            rows={3}
            placeholder="[0.1, 0.2, 0.3]"
            style={{
              width: "100%",
              fontFamily: "ui-monospace, monospace",
              fontSize: 12,
              border: "1px solid var(--hairline)",
              borderRadius: 4,
              padding: 4,
            }}
          />
          {dimHint !== undefined ? (
            <span style={{ fontSize: 11, color: "var(--ink-3)" }}>Expected dim: {dimHint}</span>
          ) : null}
          {!literalValid ? (
            <span
              data-testid="vector-input-literal-error"
              role="alert"
              style={{ fontSize: 11, color: "var(--err, #d33)" }}
            >
              Invalid JSON array of numbers
            </span>
          ) : null}
        </div>
      ) : (
        <input
          type="text"
          data-testid="vector-input-sqlfn"
          value={value.expr}
          onChange={(e) => onChange({ mode: "sql-fn", expr: e.target.value })}
          placeholder="public.embed_text('hello')"
          style={{
            width: "100%",
            fontFamily: "ui-monospace, monospace",
            fontSize: 12,
            border: "1px solid var(--hairline)",
            borderRadius: 4,
            padding: 4,
          }}
        />
      )}
    </div>
  );
}
