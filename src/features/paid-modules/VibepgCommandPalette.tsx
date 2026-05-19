// — minimal command palette for vibepg commands + saved connections.
//
// Hand-rolled accessible palette: a Radix-Dialog wrapper with a search
// input + filterable list. Items are visible regardless of subscription
// state; clicking a vibepg item without subscription opens the upgrade
// page (and fires telemetry). Saved connections are surfaced as a
// dedicated section so Cmd+K provides the spec'd fuzzy-search across
// connection names ().

import { type JSX, type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Dialog } from "../../components/Dialog";
import { useConnections } from "../connections/store";
import { usePaidModules } from "./store";
import { sendUpgradeClickTelemetry } from "./telemetry";

export type VibepgCommandId =
  | "check_migration"
  | "fix_sql_error"
  | "explain_query"
  | "suggest_index"
  | "generate_seed_data"
  | "compare_plans"
  | "rollback_plan";

export const VIBEPG_COMMANDS: readonly VibepgCommandId[] = [
  "check_migration",
  "fix_sql_error",
  "explain_query",
  "suggest_index",
  "generate_seed_data",
  "compare_plans",
  "rollback_plan",
] as const;

interface Props {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Optional override — host can short-circuit subscribed clicks (e.g. open the AI panel). */
  onSelect?(commandId: VibepgCommandId): void;
}

type FlatItem =
  | { kind: "connection"; id: string; name: string; subtitle: string }
  | { kind: "command"; id: VibepgCommandId; label: string; hint: string };

export function VibepgCommandPalette({ open, onOpenChange, onSelect }: Props): JSX.Element {
  const { t } = useTranslation();
  const subscription = usePaidModules((s) => s.subscription);
  const hydrate = usePaidModules((s) => s.hydrate);
  const connections = useConnections((s) => s.connections);
  const selectConn = useConnections((s) => s.select);
  useEffect(() => {
    if (!subscription) void hydrate();
  }, [subscription, hydrate]);

  const subscribed = subscription?.vibepgSubscribed ?? false;
  const upgradeUrl = subscription?.upgradeUrlVibepg ?? "https://vibepg.ai/upgrade";

  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset transient state on each open.
  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIdx(0);
      // Focus runs after Radix mounts.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const items = useMemo<FlatItem[]>(() => {
    const q = query.trim().toLowerCase();
    const connectionItems: FlatItem[] = connections.map((c) => ({
      kind: "connection" as const,
      id: c.id,
      name: c.name,
      subtitle: `${c.host}:${c.port} · ${c.database}`,
    }));
    const commandItems: FlatItem[] = VIBEPG_COMMANDS.map((id) => ({
      kind: "command" as const,
      id,
      label: t(`paid_modules.vibepg.command_palette_items.${id}`),
      hint: t(`paid_modules.vibepg.command_palette_items.${id}_hint`),
    }));
    const all = [...connectionItems, ...commandItems];
    if (q.length === 0) return all;
    return all.filter((item) => {
      if (item.kind === "connection") {
        return item.name.toLowerCase().includes(q) || item.subtitle.toLowerCase().includes(q);
      }
      return item.label.toLowerCase().includes(q) || item.hint.toLowerCase().includes(q);
    });
  }, [query, t, connections]);

  // Clamp activeIdx whenever the filtered list shrinks.
  useEffect(() => {
    if (activeIdx > items.length - 1) {
      setActiveIdx(Math.max(0, items.length - 1));
    }
  }, [items.length, activeIdx]);

  const handleSelect = (item: FlatItem) => {
    if (item.kind === "connection") {
      selectConn(item.id);
      onOpenChange(false);
      return;
    }
    if (subscribed) {
      onSelect?.(item.id);
      onOpenChange(false);
      return;
    }
    sendUpgradeClickTelemetry("command_palette");
    if (typeof window !== "undefined") {
      window.open(upgradeUrl, "_blank", "noopener,noreferrer");
    }
    onOpenChange(false);
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (items.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => (i + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => (i - 1 + items.length) % items.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = items[activeIdx];
      if (item !== undefined) handleSelect(item);
    }
  };

  const activeItem = items[activeIdx];
  const activeId = activeItem ? `${listboxId}-${activeItem.kind}-${activeItem.id}` : undefined;

  // Find the index where the connections section ends and commands begin.
  const firstCommandIdx = items.findIndex((it) => it.kind === "command");

  return (    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("paid_modules.vibepg.command_palette_items.title")}
      description={t("paid_modules.vibepg.command_palette_items.search_placeholder")}
      size="md"
      closeAriaLabel={t("paid_modules.vibepg.command_palette_items.close")}
    >
      <div
        data-testid="vibepg-command-palette"
        style={{ display: "flex", flexDirection: "column", gap: 10 }}
      >
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          data-testid="vibepg-command-input"
          placeholder={t("paid_modules.vibepg.command_palette_items.search_placeholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKey}
          className="q-input"
          style={{ width: "100%", padding: "6px 10px", fontSize: 13 }}
        />
        {items.length === 0 ? (          <div
            data-testid="vibepg-command-empty"
            style={{ padding: "12px 4px", color: "var(--ink-3)", fontSize: 12 }}
          >
            {t("paid_modules.vibepg.command_palette_items.no_results")}
          </div>
) : (          <div
            id={listboxId}
            // biome-ignore lint/a11y/useSemanticElements: native <select>/<datalist> cannot host the compound row layout we need
            role="listbox"
            aria-label={t("paid_modules.vibepg.command_palette_items.title")}
            style={{
              margin: 0,
              padding: 0,
              listStyle: "none",
              display: "flex",
              flexDirection: "column",
              maxHeight: 320,
              overflowY: "auto",
            }}
          >
            {items.map((item, i) => {
              const isActive = i === activeIdx;
              const optionId = `${listboxId}-${item.kind}-${item.id}`;
              const headerLabel =
                i === 0 && item.kind === "connection"
                  ? t("paid_modules.vibepg.command_palette_items.section_connections")
                  : i === firstCommandIdx && item.kind === "command"
                    ? t("paid_modules.vibepg.command_palette_items.section_commands")
                    : null;
              return (                <div key={optionId}>
                  {headerLabel ? (                    <div
                      style={{
                        padding: "6px 10px 2px",
                        fontSize: 10.5,
                        letterSpacing: "0.12em",
                        textTransform: "uppercase",
                        color: "var(--ink-4)",
                      }}
                    >
                      {headerLabel}
                    </div>
) : null}
                  <div
                    id={optionId}
                    // biome-ignore lint/a11y/useSemanticElements: native <option> only valid inside <select>; we host a custom listbox
                    role="option"
                    aria-selected={isActive}
                    data-active={isActive}
                    data-testid={
                      item.kind === "command"
                        ? `vibepg-command-item-${item.id}`
                        : `palette-connection-item-${item.id}`
                    }
                    tabIndex={-1}
                    onMouseEnter={() => setActiveIdx(i)}
                    onClick={() => handleSelect(item)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        handleSelect(item);
                      }
                    }}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: "8px 10px",
                      cursor: "pointer",
                      background: isActive
                        ? "var(--accent-soft, rgba(99,102,241,0.10))"
                        : "transparent",
                      display: "flex",
                      flexDirection: "column",
                      gap: 2,
                    }}
                  >
                    <span style={{ fontSize: 13, color: "var(--ink-1)" }}>
                      {item.kind === "connection" ? item.name : item.label}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--ink-3)" }}>
                      {item.kind === "connection" ? item.subtitle : item.hint}
                    </span>
                  </div>
                </div>
);
            })}
          </div>
)}
      </div>
    </Dialog>
);
}
