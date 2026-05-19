// — owner: .
//
// Small primitive used by every TimescaleDB policy dialog. Renders a number
// input + unit picker and emits the structured `IntervalValue` on change.
//
// Always pluralizes the unit when serialized — Postgres parses both
// `1 day` and `1 days` identically, and pluralizing keeps the renderer simple.
import type { JSX } from "react";

export type IntervalUnit = "minute" | "hour" | "day" | "week" | "month";

export interface IntervalValue {
  count: number;
  unit: IntervalUnit;
}

export interface IntervalInputProps {
  value: IntervalValue;
  onChange: (next: IntervalValue) => void;
  /** Test id suffix; full id is `interval-input-<idSuffix>`. */
  idSuffix: string;
}

const UNITS: IntervalUnit[] = ["minute", "hour", "day", "week", "month"];

export function intervalToSqlLiteral(v: IntervalValue): string {
  return `${v.count} ${v.unit}s`;
}

export function IntervalInput(props: IntervalInputProps): JSX.Element {
  const { value, onChange, idSuffix } = props;
  return (
    <span data-testid={`interval-input-${idSuffix}`} style={{ display: "inline-flex", gap: 4 }}>
      <input
        type="number"
        min="1"
        value={value.count}
        style={{ width: 64 }}
        onChange={(e) => {
          const next = Number.parseInt(e.target.value, 10);
          onChange({ count: Number.isFinite(next) && next > 0 ? next : 1, unit: value.unit });
        }}
      />
      <select
        value={value.unit}
        onChange={(e) => onChange({ count: value.count, unit: e.target.value as IntervalUnit })}
      >
        {UNITS.map((u) => (
          <option key={u} value={u}>
            {u}
          </option>
        ))}
      </select>
    </span>
  );
}
