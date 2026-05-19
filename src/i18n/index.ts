import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import ru from "./locales/ru.json";

/**
 * i18next bootstrap for ide99.
 *
 * - EN is the default locale; users can switch to RU via the language picker.
 * - The current language is persisted in localStorage under `ide99:lang`.
 * On first launch we honour the OS/browser language if it maps to a
 * supported locale; otherwise we fall back to EN.
 * - `useSuspense: false` because we ship resources synchronously (bundled),
 * so we never need to suspend on a network fetch.
 * - `escapeValue: false` because React already escapes interpolated values.
 */

const STORAGE_KEY = "ide99:lang";
const SUPPORTED = ["en", "ru"] as const;
type Supported = (typeof SUPPORTED)[number];
const DEFAULT_LANG: Supported = "en";

function detectInitialLanguage(): Supported {
  if (typeof window === "undefined") return DEFAULT_LANG;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && (SUPPORTED as readonly string[]).includes(stored)) {
      return stored as Supported;
    }
  } catch {
    // localStorage may throw in private mode / sandboxed contexts; fall through.
  }
  // First launch: honour the OS / browser language tag if it maps cleanly to
  // a supported locale (`ru-RU` → ru, `en-GB` → en). Anything else lands on
  // the default English locale.
  try {
    const tag = (window.navigator.language || window.navigator.languages?.[0] || "")
      .toLowerCase()
      .split("-")[0];
    if ((SUPPORTED as readonly string[]).includes(tag)) {
      return tag as Supported;
    }
  } catch {
    // navigator may be unavailable in some sandboxed renderers.
  }
  return DEFAULT_LANG;
}

const initialLang = detectInitialLanguage();
// Reflect the active locale on <html lang> so the boot overlay (rendered
// before React mounts, see index.html) and screen readers pick the right
// language without a separate code path.
if (typeof document !== "undefined") {
  document.documentElement.lang = initialLang;
}

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    lng: initialLang,
    fallbackLng: DEFAULT_LANG,
    supportedLngs: [...SUPPORTED],
    resources: {
      en: { translation: en },
      ru: { translation: ru },
    },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
    // In dev, log a warning when a translation key is missing so we don't
    // silently render raw keys (audit C5/M5). i18next default returns the
    // key string as the rendered value — fine for tests, dangerous in UI.
    saveMissing: import.meta.env.DEV,
    missingKeyHandler: (lngs, _ns, key, fallbackValue) => {
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.warn(
          `[i18n] missing key "${key}" for locale(s) ${lngs.join(",")} (fallback: ${fallbackValue ?? "<none>"})`,
        );
      }
    },
  });

  i18n.on("languageChanged", (lng) => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(STORAGE_KEY, lng);
    } catch {
      // Persistence is best-effort; an unwritable storage shouldn't crash i18n.
    }
    // Keep <html lang> in sync — assistive tech and the boot overlay both
    // read it.
    if (typeof document !== "undefined") {
      document.documentElement.lang = lng;
    }
  });
}

export default i18n;
export { STORAGE_KEY as LANG_STORAGE_KEY };
