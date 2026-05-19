import { Languages } from "lucide-react";
import type { JSX } from "react";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";

/**
 * Two-state language toggle: ru <-> en.
 *
 * S1 ships only the two locales, so a single-click toggle beats a popover
 * on click-cost and screen real estate. The visible "RU"/"EN" hint advertises
 * the *next* language to keep the affordance unambiguous (clicking when "EN"
 * is shown switches you TO English).
 *
 * Persistence is handled by i18n/index.ts via the languageChanged event —
 * the component just calls i18n.changeLanguage() and lets the bootstrap layer
 * write it back to localStorage.
 */

type SupportedLanguage = "en" | "ru";
const NEXT_LANGUAGE: Record<SupportedLanguage, SupportedLanguage> = {
  en: "ru",
  ru: "en",
};

function normalize(lang: string): SupportedLanguage {
  // i18next can hand us "en-US" etc. — collapse to the base tag we know.
  const base = lang.split("-")[0]?.toLowerCase();
  return base === "en" ? "en" : "ru";
}

export function LanguageSwitcher(): JSX.Element {
  const { t, i18n } = useTranslation();
  const current = normalize(i18n.language);
  const next = NEXT_LANGUAGE[current];

  const onClick = useCallback(() => {
    void i18n.changeLanguage(next);
  }, [i18n, next]);

  return (    <button
      type="button"
      aria-label={t("language.switch")}
      onClick={onClick}
      className="q-fchip"
      style={{ height: 28, padding: "0 8px" }}
    >
      <Languages size={14} aria-hidden="true" />
      <span style={{ fontSize: 10.5, fontWeight: 500, letterSpacing: "0.04em" }}>
        {current.toUpperCase()}
      </span>
    </button>
);
}
