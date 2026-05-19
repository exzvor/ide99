// src/features/editor/FilterDropdown.tsx
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Filter, FilterOp } from "../../lib/parser";

const ALL_OPS: { value: FilterOp; label: string }[] = [
  { value: "eq", label: "=" },
  { value: "ne", label: "≠" },
  { value: "lt", label: "<" },
  { value: "le", label: "≤" },
  { value: "gt", label: ">" },
  { value: "ge", label: "≥" },
  { value: "like", label: "LIKE" },
  { value: "isNull", label: "IS NULL" },
  { value: "isNotNull", label: "IS NOT NULL" },
];

const NUMERIC_TYPES = [
  "int",
  "integer",
  "bigint",
  "smallint",
  "numeric",
  "real",
  "double precision",
];
const DATE_TYPES = ["date", "timestamp", "timestamptz", "time"];

export function operatorsFor(dataType: string | undefined): FilterOp[] {
  if (!dataType) return ["eq", "ne", "isNull", "isNotNull"];
  const lower = dataType.toLowerCase();
  if (NUMERIC_TYPES.some((t) => lower.includes(t)) || DATE_TYPES.some((t) => lower.includes(t))) {
    return ["eq", "ne", "lt", "le", "gt", "ge", "isNull", "isNotNull"];
  }
  if (lower.includes("text") || lower.includes("char") || lower.includes("varchar")) {
    return ["eq", "ne", "like", "isNull", "isNotNull"];
  }
  return ["eq", "ne", "isNull", "isNotNull"];
}

export interface FilterDropdownProps {
  current: Filter | null;
  columnName: string;
  dataType?: string;
  onApply(filter: Filter | null): void;
  onClose(): void;
}

export function FilterDropdown(props: FilterDropdownProps) {
  const { t } = useTranslation();
  const allowed = operatorsFor(props.dataType);
  const [op, setOp] = useState<FilterOp>(props.current?.op ?? "eq");
  const [value, setValue] = useState<string>(    props.current?.value === null || props.current?.value === undefined
      ? ""
      : String(props.current.value),
);
  const valueless = op === "isNull" || op === "isNotNull";

  function apply() {
    if (valueless) {
      props.onApply({ column: props.columnName, op, value: null });
    } else {
      const v = parseValue(value, props.dataType);
      props.onApply({ column: props.columnName, op, value: v });
    }
    props.onClose();
  }

  function clear() {
    props.onApply(null);
    props.onClose();
  }

  return (    <div
      className="filter-dropdown"
      // biome-ignore lint/a11y/useSemanticElements: native <dialog> would force showModal/show/close lifecycle + inert handling we don't need for this lightweight popover (closes on outside click).
      role="dialog"
      aria-label={t("filter.title", { defaultValue: "Filter column" })}
    >
      <select
        value={op}
        onChange={(e) => setOp(e.target.value as FilterOp)}
        aria-label={t("filter.operator", { defaultValue: "Operator" })}
      >
        {ALL_OPS.filter((o) => allowed.includes(o.value)).map((o) => (          <option key={o.value} value={o.value}>
            {o.label}
          </option>
))}
      </select>
      {!valueless && (        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label={t("filter.value", { defaultValue: "Value" })}
        />
)}
      <div className="filter-dropdown-actions">
        <button type="button" onClick={clear}>
          {t("filter.clear", { defaultValue: "Clear" })}
        </button>
        <button type="button" onClick={apply}>
          {t("filter.apply", { defaultValue: "Apply" })}
        </button>
      </div>
    </div>
);
}

function parseValue(raw: string, dataType: string | undefined): unknown {
  if (!dataType) return raw;
  const lower = dataType.toLowerCase();
  if (NUMERIC_TYPES.some((t) => lower.includes(t))) {
    const n = Number(raw);
    return Number.isFinite(n) ? n : raw;
  }
  return raw;
}
