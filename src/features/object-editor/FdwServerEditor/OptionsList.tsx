// — generic key/value option-row list, used by FDW server-level
// options and per-mapping options. Pure presentational; the parent owns the
// `options` array via `onChange`.

import type { JSX } from "react";

import type { KvOptionForm } from "../ddl/types";

let counter = 0;
const newId = (): string => `s25-opt-${Date.now()}-${++counter}`;

export interface OptionsListProps {
  options: KvOptionForm[];
  onChange: (next: KvOptionForm[]) => void;
  labelText: string;
  addLabel: string;
  /** Stable test-id prefix; defaults to `fdw-options`. Pass a unique value
   * per nested OptionsList so testids don't collide. */
  testidPrefix?: string;
}

export function OptionsList({
  options,
  onChange,
  labelText,
  addLabel,
  testidPrefix = "fdw-options",
}: OptionsListProps): JSX.Element {
  const rowPrefix = testidPrefix.endsWith("s") ? testidPrefix.slice(0, -1) : testidPrefix;
  return (    <fieldset
      data-testid={`${testidPrefix}-fieldset`}
      style={{
        border: "1px solid var(--border-strong-q)",
        borderRadius: "var(--r-md)",
        padding: 12,
        margin: 0,
        display: "grid",
        gap: 8,
      }}
    >
      <legend style={{ fontSize: 11.5, fontWeight: 500, color: "var(--ink-3)", padding: "0 6px" }}>
        {labelText}
      </legend>
      {options.map((o, i) => (        <div
          key={o.id}
          data-testid={`${rowPrefix}-${i}`}
          style={{ display: "flex", gap: 8, alignItems: "center" }}
        >
          <input
            value={o.key}
            placeholder="key"
            className="q-input mono"
            data-testid={`${rowPrefix}-${i}-key`}
            onChange={(e) =>
              onChange(options.map((it) => (it.id === o.id ? { ...it, key: e.target.value } : it)))
            }
            style={{ flex: 1 }}
          />
          <input
            value={o.value}
            placeholder="value"
            className="q-input mono"
            data-testid={`${rowPrefix}-${i}-value`}
            onChange={(e) =>
              onChange(                options.map((it) => (it.id === o.id ? { ...it, value: e.target.value } : it)),
)
            }
            style={{ flex: 1 }}
          />
          <button
            type="button"
            className="btn-ghost"
            data-testid={`${rowPrefix}-${i}-remove`}
            onClick={() => onChange(options.filter((it) => it.id !== o.id))}
            aria-label="Remove option"
            style={{ width: 28, height: 28, padding: 0, fontSize: 16 }}
          >
            ×
          </button>
        </div>
))}
      <button
        type="button"
        className="btn"
        data-testid={`${testidPrefix}-add`}
        onClick={() => onChange([...options, { id: newId(), key: "", value: "" }])}
        style={{ alignSelf: "start" }}
      >
        + {addLabel}
      </button>
    </fieldset>
);
}
