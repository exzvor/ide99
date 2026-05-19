import { Contrast, Monitor, Moon, Sun } from "lucide-react";
import type { JSX } from "react";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { type Theme, useTheme } from "../hooks/useTheme";

/**
 * Four-state theme cycler: light -> dark -> system -> high-contrast -> light.
 * Spec §5 "Theme switcher UI" + S35 a11y addition (high-contrast theme).
 *
 * Why a cycle and not a popover? The Welcome screen is small; an inline
 * cyclic toggle is the cheapest interaction in clicks (1) and discoverable
 * via the icon. Power users get a full Settings → Accessibility panel.
 */

const NEXT_THEME: Record<Theme, Theme> = {
  light: "dark",
  dark: "system",
  system: "high-contrast",
  "high-contrast": "light",
};

const ICONS: Record<Theme, typeof Sun> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
  "high-contrast": Contrast,
};

export function ThemeSwitcher(): JSX.Element {
  const { theme, setTheme } = useTheme();
  const { t } = useTranslation();

  const cycle = useCallback(() => {
    setTheme(NEXT_THEME[theme]);
  }, [theme, setTheme]);

  const Icon = ICONS[theme];
  const currentLabel = t(`theme.${theme}`);
  const ariaLabel = t("theme.toggle.label", { current: currentLabel });

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-pressed={theme !== "system"}
      onClick={cycle}
      className="q-fchip"
      style={{ width: 28, height: 28, padding: 0, justifyContent: "center" }}
    >
      <Icon size={14} aria-hidden="true" data-testid="theme-icon" data-theme-icon={theme} />
    </button>
  );
}
