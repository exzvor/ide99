// — best-effort telemetry for paid-module slot interactions.
//
// Mirrors the contract used by `usePrivacy().sendEvent` (which already wraps
// `telemetry_send_event` in a try/catch). We avoid pulling the privacy store
// directly so this module stays cheap to import (paid-modules is loaded
// eagerly inside slots scattered across the app), and so failures truly are
// silent: the user never sees a console error if Tauri's IPC isn't ready.

import { invoke } from "@tauri-apps/api/core";

import type { VibepgSlot } from "./VibepgActionButton";

/**
 * Fires `feature_used` with `feature_id = paid_modules.vibepg.<slot>.upgrade_click`.
 * Never throws. Backend short-circuits when telemetry is disabled.
 */
export function sendUpgradeClickTelemetry(slot: VibepgSlot | string): void {
  const featureId = `paid_modules.vibepg.${slot}.upgrade_click`;
  void invoke("telemetry_send_event", {
    name: "feature_used",
    props: { feature_id: featureId },
  }).catch(() => {
    // Telemetry must NEVER break user flow.
  });
}

/**
 * () — generic best-effort `feature_used` emitter for
 * SPG99 slot interactions. Never throws. Provided as a counterpart to the
 * vibepg-flavored helper so SPG99 components can use the same crash-proof
 * wrapper instead of inlining `try / void invoke().catch()` everywhere.
 */
export function sendFeatureEvent(featureId: string): void {
  void invoke("telemetry_send_event", {
    name: "feature_used",
    props: { feature_id: featureId },
  }).catch(() => {
    // Telemetry must NEVER break user flow.
  });
}
