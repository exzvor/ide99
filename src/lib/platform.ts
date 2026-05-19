/**
 * — small platform helper for cross-platform hotkey labels.
 *
 * Monaco's KeyMod.CtrlCmd already auto-translates per platform (Cmd on
 * macOS, Ctrl on Linux/Windows) so the BINDING is correct everywhere.
 * What's missing is the visual LABEL: i18n strings, button titles,
 * tooltips. This module provides the symbol used in those labels.
 *
 * Detection uses `navigator.platform` first (deprecated but still
 * accurate when present); falls back to `navigator.userAgent` when
 * the modern UA-Client-Hints API hasn't populated `platform`.
 */

let cachedIsMac: boolean | null = null;

export function isMacPlatform(): boolean {
  if (cachedIsMac !== null) return cachedIsMac;
  if (typeof navigator === "undefined") {
    cachedIsMac = false;
    return false;
  }
  const platform = navigator.platform || "";
  const ua = navigator.userAgent || "";
  cachedIsMac = /mac|iphone|ipod|ipad/i.test(platform) || /macintosh|mac os x/i.test(ua);
  return cachedIsMac;
}

/** "⌘" on macOS, "Ctrl" elsewhere — used for hotkey labels in titles / tooltips. */
export function modKey(): string {
  return isMacPlatform() ? "⌘" : "Ctrl";
}

/**
 * Format a hotkey label like "modKey + key" — e.g. "⌘ + T" on macOS,
 * "Ctrl + T" on Linux/Windows. Pass any key combo as additional args:
 * formatHotkey("T")             → "⌘ + T" or "Ctrl + T"
 * formatHotkey("Shift", "F")    → "⌘ + Shift + F" or "Ctrl + Shift + F"
 */
export function formatHotkey(...parts: string[]): string {
  return [modKey(), ...parts].join(" + ");
}

/** Test-only: clear the platform cache so each test can fake navigator.platform. */
export function __resetPlatformCache(): void {
  cachedIsMac = null;
}
