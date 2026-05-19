import { useCallback, useEffect, useState } from "react";

/**
 * Theme handling hook.
 *
 * The user-visible setting is one of "light" | "dark" | "system" — the latter
 * defers to the OS via `prefers-color-scheme`. The hook always returns a
 * concrete `resolved` value ("light" | "dark") so callers don't have to
 * re-implement the system preference branching.
 *
 * Side effects:
 * - Persists `theme` in localStorage under `ide99:theme`.
 * - Mirrors `resolved` into `document.documentElement.dataset.theme`, which
 * is what `themes.css` keys off of via `[data-theme="dark"]`.
 * - Subscribes to the OS preference change while `theme === "system"` and
 * unsubscribes once the user picks an explicit theme.
 */

export type Theme = "light" | "dark" | "system" | "high-contrast";
export type ResolvedTheme = "light" | "dark" | "high-contrast";

export const THEME_STORAGE_KEY = "ide99:theme";

const VALID_THEMES: readonly Theme[] = ["light", "dark", "system", "high-contrast"];

function readStoredTheme(): Theme {
  if (typeof window === "undefined") return "system";
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (raw && (VALID_THEMES as readonly string[]).includes(raw)) {
      return raw as Theme;
    }
  } catch {
    // Storage may throw in privacy / sandboxed contexts — fall back to system.
  }
  return "system";
}

function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function resolveTheme(theme: Theme, prefersDark: boolean): ResolvedTheme {
  if (theme === "system") return prefersDark ? "dark" : "light";
  return theme;
  // Note: "high-contrast" passes through unchanged — it's an explicit user
  // choice (Settings → Accessibility), not derived from the OS preference.
}

export interface UseThemeResult {
  theme: Theme;
  resolved: ResolvedTheme;
  setTheme: (next: Theme) => void;
}

export function useTheme(): UseThemeResult {
  const [theme, setThemeState] = useState<Theme>(() => readStoredTheme());
  const [prefersDark, setPrefersDark] = useState<boolean>(() => systemPrefersDark());

  // Subscribe to OS-level preference changes only while in "system" mode —
  // once the user has picked a concrete theme, the OS preference is irrelevant.
  useEffect(() => {
    if (theme !== "system") return;
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;

    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    setPrefersDark(mql.matches);

    const onChange = (event: { matches: boolean }) => {
      setPrefersDark(event.matches);
    };

    mql.addEventListener("change", onChange);
    return () => {
      mql.removeEventListener("change", onChange);
    };
  }, [theme]);

  const resolved = resolveTheme(theme, prefersDark);

  // Mirror resolved theme onto <html data-theme=...> so themes.css can apply.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.dataset.theme = resolved;
  }, [resolved]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Best-effort; surfacing a storage error to the user would be obnoxious.
    }
  }, []);

  return { theme, resolved, setTheme };
}
