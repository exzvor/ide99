// src/features/erd/edit/EditToolbar.tsx
//
// — split into two pieces so the read-mode Toolbar stays a single
// non-wrapping flex row even in RU (fix):
//
// - <EditModeToggle/>  — compact pencil button hosted INSIDE the read-mode
// Toolbar, alongside zoom/export/stats. Always visible.
// - <EditActionsBar/>  — full-width action bar mounted by ErdPane on its own
// row, only when the tab is in edit mode. Hosts +New table, Undo, Redo,
// Reset Layout, Discard, Apply.
//
// `EditToolbar` is kept as a thin backward-compatible wrapper that renders
// both pieces in one flex row. Existing tests keep working; new layout
// callers should prefer the split components.

import { Pencil, Plus, Redo2, RotateCcw, Save, Trash2, Undo2 } from "lucide-react";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { useEditStore } from "./store";

export interface EditModeToggleProps {
  tabId: string;
}

/**
 * Compact pencil-button used inside the main ERD Toolbar to flip the tab
 * between read and edit modes. Carries no action buttons of its own — those
 * live in <EditActionsBar/>, mounted by ErdPane on a separate row when the
 * tab is in edit mode.
 */
export function EditModeToggle({ tabId }: EditModeToggleProps): JSX.Element {
  const { t } = useTranslation();
  const mode = useEditStore((s) => s.tabs.get(tabId)?.mode ?? "read");
  const toggleMode = useEditStore((s) => s.toggleMode);
  return (
    <button
      type="button"
      data-testid="edit-toggle"
      aria-pressed={mode === "edit"}
      title={t("erd.edit.toggle.tooltip")}
      onClick={() => toggleMode(tabId)}
      className="btn-icon"
      style={{ height: 26, padding: "0 8px", display: "inline-flex", gap: 4 }}
    >
      <Pencil size={13} aria-hidden />
      <span style={{ fontSize: 11 }}>{t("erd.edit.toggle.label")}</span>
    </button>
  );
}

export interface EditActionsBarProps {
  tabId: string;
  onApply(): void;
  onDiscard(): void;
  onResetLayout(): void;
  onAddTable(): void;
  canResetLayout: boolean;
  canApply: boolean;
}

/**
 * Full-width second-row toolbar mounted by ErdPane when the tab is in edit
 * mode. Hosts the destructive / state-changing controls. Self-mounting
 * inside `mode === "edit"` is the caller's responsibility — the bar always
 * renders its buttons when invoked.
 */
export function EditActionsBar({
  tabId,
  onApply,
  onDiscard,
  onResetLayout,
  onAddTable,
  canResetLayout,
  canApply,
}: EditActionsBarProps): JSX.Element {
  const { t } = useTranslation();
  const isDirty = useEditStore((s) => (s.tabs.get(tabId)?.ops.length ?? 0) > 0);
  const canUndo = useEditStore((s) => (s.tabs.get(tabId)?.past.length ?? 0) > 0);
  const canRedo = useEditStore((s) => (s.tabs.get(tabId)?.future.length ?? 0) > 0);
  const undo = useEditStore((s) => s.undo);
  const redo = useEditStore((s) => s.redo);

  return (
    <div
      role="toolbar"
      aria-label={t("erd.edit.toggle.label")}
      data-testid="edit-actions-bar"
      style={{
        display: "flex",
        gap: 6,
        alignItems: "center",
        padding: "6px 10px",
        borderBottom: "1px solid var(--hairline)",
        background: "var(--bg-elev)",
        flexWrap: "wrap",
        minHeight: 36,
      }}
    >
      <button type="button" data-testid="edit-new-table" onClick={onAddTable} className="btn-icon">
        <Plus size={14} aria-hidden />
        <span style={{ marginLeft: 4 }}>{t("erd.edit.new_table")}</span>
      </button>
      <button
        type="button"
        data-testid="edit-undo"
        onClick={() => undo(tabId)}
        disabled={!canUndo}
        className="btn-icon"
        title={t("erd.edit.undo")}
        aria-label={t("erd.edit.undo")}
      >
        <Undo2 size={14} aria-hidden />
      </button>
      <button
        type="button"
        data-testid="edit-redo"
        onClick={() => redo(tabId)}
        disabled={!canRedo}
        className="btn-icon"
        title={t("erd.edit.redo")}
        aria-label={t("erd.edit.redo")}
      >
        <Redo2 size={14} aria-hidden />
      </button>
      <span style={{ flex: 1 }} />
      {canResetLayout && (
        <button
          type="button"
          data-testid="edit-reset-layout"
          onClick={onResetLayout}
          className="btn-icon"
          title={t("erd.edit.reset_layout")}
          aria-label={t("erd.edit.reset_layout")}
        >
          <RotateCcw size={14} aria-hidden />
          <span style={{ marginLeft: 4 }}>{t("erd.edit.reset_layout")}</span>
        </button>
      )}
      <button
        type="button"
        data-testid="edit-discard"
        onClick={onDiscard}
        disabled={!isDirty}
        className="btn-icon"
      >
        <Trash2 size={14} aria-hidden />
        <span style={{ marginLeft: 4 }}>{t("erd.edit.discard")}</span>
      </button>
      <button
        type="button"
        data-testid="edit-apply"
        onClick={onApply}
        disabled={!canApply || !isDirty}
        className="btn-icon"
        style={{ background: "var(--accent, #4a90e2)", color: "#fff" }}
      >
        <Save size={14} aria-hidden />
        <span style={{ marginLeft: 4 }}>{t("erd.edit.apply")}</span>
      </button>
    </div>
  );
}

// ── Backward-compat aggregate ──────────────────────────────────────────────
//
// Existing callers (legacy tests, the soon-to-be-removed inline mount in
// Toolbar) consume <EditToolbar/> as a single component. Keep it as a thin
// vertical stack so layout regression is bounded if anyone still mounts it
// directly. Toolbar.tsx now uses <EditModeToggle/>; ErdPane renders
// <EditActionsBar/> on its own row.

export interface EditToolbarProps extends EditActionsBarProps {}

export function EditToolbar(props: EditToolbarProps): JSX.Element {
  const mode = useEditStore((s) => s.tabs.get(props.tabId)?.mode ?? "read");
  return (
    <div data-testid="edit-toolbar-legacy" style={{ display: "contents" }}>
      <EditModeToggle tabId={props.tabId} />
      {mode === "edit" && <EditActionsBar {...props} />}
    </div>
  );
}
