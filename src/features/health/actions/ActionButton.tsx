import { BarChart3, RotateCw, Search, Sparkles, Square, Trash2 } from "lucide-react";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { useConnections } from "../../connections/store";
import { isEasyMode } from "./easyMode";
import { useHealthActions } from "./store";
import type { ActionKind, ActionTarget } from "./types";

const ICON_MAP: Record<ActionKind, typeof RotateCw> = {
  reindexTable: RotateCw,
  vacuum: Sparkles,
  analyze: BarChart3,
  dropIndex: Trash2,
  killPid: Square,
  explain: Search,
};

function stableKey(target: ActionTarget): string {
  switch (target.kind) {
    case "reindexTable":
    case "vacuum":
    case "analyze":
      return `${target.schema}.${target.table}`;
    case "dropIndex":
      return `${target.schema}.${target.index}`;
    case "killPid":
      return `pid-${target.pid}`;
    case "explain":
      return "explain";
  }
}

interface Props {
  kind: ActionKind;
  target: ActionTarget;
  connId: string;
  size?: number;
}

/**
 * — single-row action button. Renders an icon-only `<button>` that
 * opens the preview modal via `useHealthActions.openPreview`. Returns `null`
 * when Easy mode is on or the connection is missing (acceptance criteria).
 */
export function ActionButton({ kind, target, connId, size = 14 }: Props): JSX.Element | null {
  const { t } = useTranslation();
  const conn = useConnections((s) => s.connections.find((c) => c.id === connId));
  if (isEasyMode()) return null;
  if (!conn) return null;
  const Icon = ICON_MAP[kind];
  return (
    <button
      type="button"
      className="health-action-btn"
      onClick={() => useHealthActions.getState().openPreview(target, conn)}
      aria-label={t(`health.actions.label.${kind}`)}
      title={t(`health.actions.tooltip.${kind}`)}
      data-testid={`health-action-${kind}-${stableKey(target)}`}
    >
      <Icon size={size} aria-hidden="true" />
    </button>
  );
}
