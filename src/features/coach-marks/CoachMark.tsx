import type { JSX, ReactNode } from "react";

import { useCoachMarks } from "./store";

/**
 * v1.0 GA — inline coach mark.
 *
 * A small, dismissable hint rendered in-flow next to the UI it explains.
 * Designed to replace the "show every tip on first launch"
 * pattern with "show one tip, in context, when the user is actually
 * looking at that surface".
 *
 * Behavior:
 * - skips render when `useCoachMarks.isSeen(id)` is true (idempotent)
 * - `Got it` button calls `markSeen(id)` and unmounts
 * - no auto-dismiss — the user has to acknowledge so we know they saw it
 *
 * Render contract: caller wraps the surface and the hint's `<CoachMark>`
 * sits beside (not on top of) the related UI. Keeps the layout flow
 * predictable; we don't do absolute-positioned overlays here because
 * those interact poorly with virtualized grids and dynamic layouts.
 */
export interface CoachMarkProps {
  /** Stable id used to track the dismissed flag in localStorage. */
  id: string;
  /** Hint heading. */
  title: string;
  /** Hint body — keep ≤2 sentences. */
  body: ReactNode;
  /** Localized "Got it" label (caller passes via i18n.t). */
  dismissLabel: string;
}

export function CoachMark({ id, title, body, dismissLabel }: CoachMarkProps): JSX.Element | null {
  const isSeen = useCoachMarks((s) => s.isSeen(id));
  const markSeen = useCoachMarks((s) => s.markSeen);

  if (isSeen) return null;

  return (    <div
      role="status"
      data-testid={`coach-mark-${id}`}
      style={{
        marginTop: 12,
        padding: "10px 12px",
        borderRadius: 6,
        background: "var(--accent-soft)",
        border: "1px solid var(--accent)",
        color: "var(--fg)",
        fontSize: 12,
        lineHeight: 1.45,
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
      }}
    >
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600, marginBottom: 2 }}>{title}</div>
        <div style={{ color: "var(--ink-2)" }}>{body}</div>
      </div>
      <button
        type="button"
        onClick={() => markSeen(id)}
        data-testid={`coach-mark-${id}-dismiss`}
        style={{
          alignSelf: "center",
          background: "transparent",
          border: "1px solid var(--hairline)",
          borderRadius: 4,
          padding: "4px 8px",
          fontSize: 11,
          color: "var(--ink-2)",
          cursor: "pointer",
        }}
      >
        {dismissLabel}
      </button>
    </div>
);
}
