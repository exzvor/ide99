// — TriggerEditor sub-component: function picker.
//
// Filters via `schemaListFunctions(connId, schema, true)` (trigger-returning
// only). Shows search input + dropdown list. If the currently selected
// function isn't in the list (e.g. lives in another schema), surfaces a small
// "Selected: schema.name (not in current list)" hint.

import { type JSX, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { schemaListFunctions } from "../../../lib/tauri";
import type { FunctionSummary } from "../../../lib/tauri";

export interface FunctionPickerProps {
  value: { schema: string; name: string };
  onChange: (next: { schema: string; name: string }) => void;
  connId: string;
  /** Schema to enumerate; usually the trigger's own schema. */
  schema: string;
}

export function FunctionPicker({
  value,
  onChange,
  connId,
  schema,
}: FunctionPickerProps): JSX.Element {
  const { t } = useTranslation();
  const [items, setItems] = useState<FunctionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    setError(null);
    void (async () => {
      try {
        const list = await schemaListFunctions(connId, schema, true);
        if (cancelled) return;
        setItems(list);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connId, schema]);

  const visible = useMemo(() => {
    if (!items) return [];
    const q = filter.trim().toLowerCase();
    if (q === "") return items;
    return items.filter((it) => it.name.toLowerCase().includes(q));
  }, [items, filter]);

  const selectedInList =
    items?.some((it) => it.name === value.name) && value.schema === schema && value.name !== "";

  return (    <div data-testid="trigger-fn-picker" style={{ display: "grid", gap: 6 }}>
      <input
        data-testid="trigger-fn-picker-search"
        className="q-input"
        value={filter}
        placeholder={t("object_editor.trigger.function_picker_search")}
        onChange={(e) => setFilter(e.target.value)}
      />
      {error ? (        <div
          // biome-ignore lint/a11y/useSemanticElements: passive banner.
          role="status"
          data-testid="trigger-fn-picker-error"
          style={{
            padding: "6px 10px",
            fontSize: 12,
            background: "var(--danger-q-soft)",
            border: "1px solid var(--danger-q)",
            color: "var(--danger-q)",
            borderRadius: "var(--r-md)",
          }}
        >
          {error}
        </div>
) : null}
      {items === null && error === null ? (        <span
          data-testid="trigger-fn-picker-loading"
          style={{ fontSize: 12, color: "var(--ink-4)" }}
        >
          {t("object_editor.trigger.function_picker_loading")}
        </span>
) : null}
      {items !== null && visible.length === 0 ? (        <span data-testid="trigger-fn-picker-empty" style={{ fontSize: 12, color: "var(--ink-4)" }}>
          {t("object_editor.trigger.function_picker_empty")}
        </span>
) : null}
      {visible.length > 0 ? (        <ul
          data-testid="trigger-fn-picker-list"
          style={{
            listStyle: "none",
            padding: 4,
            margin: 0,
            background: "var(--bg-elev)",
            border: "1px solid var(--border-strong-q)",
            borderRadius: "var(--r-md)",
            maxHeight: 220,
            overflow: "auto",
          }}
        >
          {visible.map((fn) => {
            const selected = value.schema === schema && value.name === fn.name;
            return (              <li key={`${fn.name}(${fn.args})`}>
                <button
                  type="button"
                  data-testid={`trigger-fn-option-${fn.name}`}
                  onClick={() => onChange({ schema, name: fn.name })}
                  aria-pressed={selected}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "6px 10px",
                    fontFamily: "var(--font-mono-q)",
                    background: selected ? "var(--accent-soft)" : "transparent",
                    color: selected ? "var(--accent)" : "var(--ink-2)",
                    border: 0,
                    borderRadius: "var(--r-sm)",
                    cursor: "default",
                    fontSize: 12,
                  }}
                >
                  {fn.name}({fn.args})
                </button>
              </li>
);
          })}
        </ul>
) : null}
      {value.name !== "" && !selectedInList ? (        <span
          data-testid="trigger-fn-picker-outside"
          style={{ fontSize: 11, color: "var(--ink-4)" }}
        >
          {t("object_editor.trigger.function_picker_selected_outside", {
            schema: value.schema,
            name: value.name,
          })}
        </span>
) : null}
    </div>
);
}
