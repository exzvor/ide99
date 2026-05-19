/**
 * Frontend wrapper for the `admin_telemetry_emit` Tauri command.
 *
 * Honors the user's telemetryEnabled privacy flag: if telemetry is off, we
 * never call into Rust. This is the same flag PostHog telemetry checks.
 *
 * All sends are fire-and-forget. Failures are silent — wedge metrics must
 * never block UX or surface errors.
 */

import { invoke } from "@tauri-apps/api/core";

import { useAppSettings } from "../features/privacy/store";

type Payload = Record<string, unknown> | undefined;

function locale(): string {
  if (typeof navigator !== "undefined" && navigator.language) return navigator.language;
  return "en";
}

function isAllowed(): boolean {
  // The privacy store hydrates async; before hydration, settings is null and
  // we default-deny (consistent with PostHog telemetry).
  const settings = useAppSettings.getState().settings;
  return !!settings && settings.telemetryEnabled === true;
}

export function emit(event_name: string, payload?: Payload): void {
  if (!isAllowed()) return;
  void invoke("admin_telemetry_emit", {
    locale: locale(),
    eventName: event_name,
    payload: payload ?? null,
  }).catch(() => {
    // Swallow — wedge telemetry must never surface as a UI error.
  });
}

export const adminTelemetry = { emit };
