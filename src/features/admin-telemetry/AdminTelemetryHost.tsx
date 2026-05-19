import { type JSX, useEffect, useRef } from "react";

import { adminTelemetry } from "../../lib/adminTelemetry";
import { useAppSettings } from "../privacy/store";

const HEARTBEAT_INTERVAL_MS = 60_000;
const HEARTBEAT_SECONDS = 60;

/**
 * Mounted once at App level. Owns the Phase-5 wedge telemetry side-effects:
 *
 * - `ide.opened` fires once per app launch, after privacy settings hydrate
 * (so telemetryEnabled is known and we don't send a pre-consent event).
 * - `ide.heartbeat` fires every 60s but only while the window is *focused
 * and visible*. Background ticks are skipped so "active hours" actually
 * reflects engaged time, not wall-clock uptime.
 *
 * The privacy gate lives in `adminTelemetry.emit` — when telemetry is off
 * the calls here become no-ops, so we don't conditionally start/stop the
 * interval (keeps the lifecycle simple and avoids state thrash).
 */
export function AdminTelemetryHost(): JSX.Element | null {
  const settings = useAppSettings((s) => s.settings);
  const openedRef = useRef(false);

  useEffect(() => {
    if (!settings || openedRef.current) return;
    openedRef.current = true;
    adminTelemetry.emit("ide.opened", {
      first_run: settings.onboardingCompleted === false,
    });
  }, [settings]);

  useEffect(() => {
    const tick = () => {
      if (typeof document === "undefined") return;
      if (document.visibilityState !== "visible") return;
      if (typeof document.hasFocus === "function" && !document.hasFocus()) return;
      adminTelemetry.emit("ide.heartbeat", { seconds: HEARTBEAT_SECONDS });
    };
    const id = window.setInterval(tick, HEARTBEAT_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, []);

  return null;
}
