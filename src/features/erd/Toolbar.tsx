/**
 * — ERD toolbar.
 *
 * Layout: schema filter (Radix Select) → spacer → zoom out / reset / zoom
 * in / fit (icon buttons) → Export ▾ (Radix DropdownMenu with PNG / SVG
 * entries) → stats span (right-aligned).
 *
 * The schema filter writes through the editor store
 * (`useEditor.getState().setErdTabSchemas(tabId, schemas)`) so the change
 * is reactive across remounts.
 *
 * `availableSchemas` is the FULL list of non-system schemas for the
 * connection — independent of the current filter. Without this, the
 * dropdown collapsed to just the currently-loaded schema and the user
 * couldn't switch directly to another ().
 *
 * Styling note: Radix Portal contents (`Select.Content`,
 * `DropdownMenu.Content`) use INLINE styles instead of Tailwind utility
 * classes — this guarantees the popover background is opaque and sits
 * above the canvas in any theme, regardless of which token bundle has
 * loaded. An earlier draft used `bg-[var(--gray-0)]` etc., and the
 * Export dropdown failed to surface from the UI ().
 */

import * as RadixDropdown from "@radix-ui/react-dropdown-menu";
import * as RadixSelect from "@radix-ui/react-select";
import { Check, ChevronDown, Download, Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import type { CSSProperties, JSX } from "react";
import { useTranslation } from "react-i18next";
import type { ErdSchemaGraph } from "../../lib/tauri";
import { useEditor } from "../editor/store";
import { EditModeToggle } from "./edit/EditToolbar";
import { exportPng, exportSvg } from "./exporters";

export const ALL_SCHEMAS_VALUE = "__all__";

export interface ToolbarProps {
  tabId: string;
  graph: ErdSchemaGraph;
  /** Full schema list for the connection (independent of current filter). */
  availableSchemas: string[];
  layoutMs: number;
  /** `undefined` = "All schemas". */
  selectedSchemas: string[] | undefined;
  onZoomIn(): void;
  onZoomOut(): void;
  onZoomReset(): void;
  onFit(): void;
  /** Resolves the live `<svg>` for the exporters. */
  getSvgEl(): SVGSVGElement | null;
}

const POPOVER_STYLE: CSSProperties = {
  zIndex: 400,
  minWidth: 160,
  background: "var(--bg-elev)",
  border: "1px solid var(--hairline)",
  borderRadius: 8,
  boxShadow: "0 8px 24px rgba(0, 0, 0, 0.18)",
  padding: 4,
  fontSize: 12,
  color: "var(--ink-2)",
  overflow: "hidden",
};

const ITEM_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "6px 12px 6px 28px",
  borderRadius: 4,
  cursor: "pointer",
  outline: "none",
  color: "var(--ink-2)",
  fontSize: 12,
  position: "relative",
  whiteSpace: "nowrap",
};

const ITEM_PLAIN_STYLE: CSSProperties = {
  ...ITEM_STYLE,
  paddingLeft: 12,
};

const TRIGGER_STYLE: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 6,
  height: 26,
  minWidth: 140,
  padding: "0 8px",
  background: "var(--bg-elev)",
  border: "1px solid var(--hairline)",
  borderRadius: 4,
  fontSize: 12,
  color: "var(--ink-2)",
  cursor: "pointer",
};

export function Toolbar({
  tabId,
  graph,
  availableSchemas,
  layoutMs,
  selectedSchemas,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  onFit,
  getSvgEl,
}: ToolbarProps): JSX.Element {
  const { t } = useTranslation();

  // Use the unfiltered schema list when available; fall back to the graph
  // (e.g. before `schemaListSchemas` resolves) so the dropdown still
  // shows the current schema instead of being empty.
  const fallbackFromGraph = (() => {
    const set = new Set<string>();
    for (const tab of graph.tables) set.add(tab.schema);
    return [...set].sort();
  })();
  const schemaOptions = availableSchemas.length > 0 ? availableSchemas : fallbackFromGraph;

  const currentValue =
    selectedSchemas && selectedSchemas.length === 1 ? selectedSchemas[0] : ALL_SCHEMAS_VALUE;

  const onSchemaChange = (value: string): void => {
    if (value === ALL_SCHEMAS_VALUE) {
      useEditor.getState().setErdTabSchemas(tabId, undefined);
    } else {
      useEditor.getState().setErdTabSchemas(tabId, [value]);
    }
  };

  const onExportPng = (): void => {
    const el = getSvgEl();
    if (!el) return;
    void exportPng(el);
  };
  const onExportSvg = (): void => {
    const el = getSvgEl();
    if (!el) return;
    void exportSvg(el);
  };

  return (    <div
      data-testid="erd-toolbar"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "8px 10px",
        borderBottom: "1px solid var(--hairline)",
        background: "var(--bg-elev)",
        minHeight: 36,
      }}
    >
      {/* Schema filter */}
      <RadixSelect.Root value={currentValue} onValueChange={onSchemaChange}>
        <RadixSelect.Trigger
          id={`erd-schema-filter-${tabId}`}
          aria-label={t("erd.toolbar.filter_label")}
          data-testid="erd-schema-filter"
          style={TRIGGER_STYLE}
        >
          <RadixSelect.Value />
          <RadixSelect.Icon>
            <ChevronDown size={12} aria-hidden="true" />
          </RadixSelect.Icon>
        </RadixSelect.Trigger>
        <RadixSelect.Portal>
          <RadixSelect.Content position="popper" sideOffset={4} style={POPOVER_STYLE}>
            <RadixSelect.Viewport>
              {[
                { value: ALL_SCHEMAS_VALUE, label: t("erd.toolbar.filter_all") },
                ...schemaOptions.map((s) => ({ value: s, label: s })),
              ].map((option) => (                <RadixSelect.Item
                  key={option.value}
                  value={option.value}
                  style={ITEM_STYLE}
                  data-testid={
                    option.value === ALL_SCHEMAS_VALUE
                      ? "erd-schema-filter-option-all"
                      : `erd-schema-filter-option-${option.value}`
                  }
                >
                  <RadixSelect.ItemIndicator
                    style={{
                      position: "absolute",
                      left: 8,
                      display: "inline-flex",
                      alignItems: "center",
                      color: "var(--accent)",
                    }}
                  >
                    <Check size={12} aria-hidden="true" />
                  </RadixSelect.ItemIndicator>
                  <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
                </RadixSelect.Item>
))}
            </RadixSelect.Viewport>
          </RadixSelect.Content>
        </RadixSelect.Portal>
      </RadixSelect.Root>

      <div style={{ flex: "1 1 auto" }} />

      {/* Zoom + fit cluster */}
      <button
        type="button"
        className="btn-icon"
        title={t("erd.toolbar.zoom_out")}
        aria-label={t("erd.toolbar.zoom_out")}
        onClick={onZoomOut}
        data-testid="erd-zoom-out"
        style={{ width: 26, height: 26 }}
      >
        <ZoomOut size={13} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="btn-icon"
        title={t("erd.toolbar.zoom_reset")}
        aria-label={t("erd.toolbar.zoom_reset")}
        onClick={onZoomReset}
        data-testid="erd-zoom-reset"
        style={{ width: 32, height: 26, fontSize: 11 }}
      >
        100%
      </button>
      <button
        type="button"
        className="btn-icon"
        title={t("erd.toolbar.zoom_in")}
        aria-label={t("erd.toolbar.zoom_in")}
        onClick={onZoomIn}
        data-testid="erd-zoom-in"
        style={{ width: 26, height: 26 }}
      >
        <ZoomIn size={13} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="btn-icon"
        title={t("erd.toolbar.fit_aria")}
        aria-label={t("erd.toolbar.fit_aria")}
        onClick={onFit}
        data-testid="erd-fit"
        style={{ width: 26, height: 26 }}
      >
        <Maximize2 size={13} aria-hidden="true" />
      </button>

      <div style={{ width: 6 }} />

      {/* Export menu */}
      <RadixDropdown.Root>
        <RadixDropdown.Trigger asChild>
          <button
            type="button"
            className="btn-icon"
            title={t("erd.toolbar.export")}
            aria-label={t("erd.toolbar.export")}
            data-testid="erd-export-menu"
            style={{ height: 26, padding: "0 8px", display: "inline-flex", gap: 4 }}
          >
            <Download size={13} aria-hidden="true" />
            <span style={{ fontSize: 11 }}>{t("erd.toolbar.export")}</span>
          </button>
        </RadixDropdown.Trigger>
        <RadixDropdown.Portal>
          <RadixDropdown.Content
            aria-label={t("erd.toolbar.export")}
            side="bottom"
            align="end"
            sideOffset={4}
            collisionPadding={8}
            style={{ ...POPOVER_STYLE, zIndex: 100 }}
          >
            <RadixDropdown.Item
              data-testid="erd-export-png"
              onSelect={(event) => {
                event.preventDefault();
                onExportPng();
              }}
              style={ITEM_PLAIN_STYLE}
            >
              {t("erd.toolbar.export_png")}
            </RadixDropdown.Item>
            <RadixDropdown.Item
              data-testid="erd-export-svg"
              onSelect={(event) => {
                event.preventDefault();
                onExportSvg();
              }}
              style={ITEM_PLAIN_STYLE}
            >
              {t("erd.toolbar.export_svg")}
            </RadixDropdown.Item>
          </RadixDropdown.Content>
        </RadixDropdown.Portal>
      </RadixDropdown.Root>

      {/* Stats */}
      <span
        data-testid="erd-toolbar-stats"
        style={{
          marginLeft: 10,
          fontSize: 11,
          color: "var(--ink-3)",
          whiteSpace: "nowrap",
        }}
      >
        {t("erd.toolbar.stats", {
          tableCount: graph.tables.length,
          fkCount: graph.foreignKeys.length,
          layoutMs: Math.round(layoutMs),
        })}
      </span>

      {/* — Edit-mode toggle (compact). Action buttons live in a
          separate EditActionsBar mounted by ErdPane on its own row, so the
          read-mode toolbar stays a single non-wrapping flex line even in RU
          (fix). */}
      <EditModeToggle tabId={tabId} />
    </div>
);
}
