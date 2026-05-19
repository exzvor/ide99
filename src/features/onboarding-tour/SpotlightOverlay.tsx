/**
 * — onboarding tour spotlight backdrop.
 *
 * Renders a full-viewport dimmed overlay with a transparent rectangular
 * cut-out around `rect`, plus a subtle Easy-orange ring around the cut-out
 * (per design spec §7 — "Easy orange glow"). When `rect === null` (target
 * not found in DOM), falls back to a uniform dim with no cut-out so the
 * tour remains usable even if a surface is hidden.
 *
 * Implementation uses `box-shadow` on a small transparent rect to paint the
 * surrounding mask — this keeps the spotlight a single absolutely-positioned
 * element and avoids a 4-rect mask layout. Pointer events pass through the
 * cut-out so the highlighted element stays interactive (skip/next still
 * work via the bubble's own buttons).
 */

import type { JSX } from "react";

export interface SpotlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface SpotlightOverlayProps {
  rect: SpotlightRect | null;
  /** Padding around the cut-out, in pixels (visual breathing room). */
  padding?: number;
}

export function SpotlightOverlay(props: SpotlightOverlayProps): JSX.Element {
  const padding = props.padding ?? 8;
  const rect = props.rect;

  if (rect === null) {
    return (
      <div
        data-testid="tour-spotlight-fallback"
        aria-hidden="true"
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0, 0, 0, 0.45)",
          zIndex: 1000,
          pointerEvents: "none",
        }}
      />
    );
  }

  const top = Math.max(0, rect.top - padding);
  const left = Math.max(0, rect.left - padding);
  const width = rect.width + padding * 2;
  const height = rect.height + padding * 2;

  return (
    <div
      data-testid="tour-spotlight"
      aria-hidden="true"
      style={{
        position: "fixed",
        top,
        left,
        width,
        height,
        // Massive box-shadow paints the dim mask everywhere except this rect.
        boxShadow:
          "0 0 0 9999px rgba(0, 0, 0, 0.55), 0 0 0 3px var(--easy-orange-500, #f97316), 0 0 24px 6px rgba(249, 115, 22, 0.35)",
        borderRadius: 6,
        zIndex: 1000,
        pointerEvents: "none",
      }}
    />
  );
}
