/**
 * — i18n parity for new keys (theme.high-contrast,
 * keymap_import.*). .
 */

import { describe, expect, it } from "vitest";
import en from "../locales/en.json";
import ru from "../locales/ru.json";

const KEYS = [
  "theme.high-contrast",
  "keymap_import.title",
  "keymap_import.field.format",
  "keymap_import.field.raw",
  "keymap_import.action.parse",
  "keymap_import.action.parsing",
  "keymap_import.action.reset",
  "keymap_import.preview.title",
  "keymap_import.preview.empty",
] as const;

function get(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, k) => {
    if (acc && typeof acc === "object" && k in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[k];
    }
    return undefined;
  }, obj);
}

describe("s35 i18n keys (baseline)", () => {
  for (const key of KEYS) {
    it(`en has ${key}`, () => {
      const v = get(en, key);
      expect(typeof v).toBe("string");
      expect((v as string).length).toBeGreaterThan(0);
    });
    it(`ru has ${key}`, () => {
      const v = get(ru, key);
      expect(typeof v).toBe("string");
      expect((v as string).length).toBeGreaterThan(0);
    });
  }
});
