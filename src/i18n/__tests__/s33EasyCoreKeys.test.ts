/**
 * — i18n parity for the easy-mode-core keys (toggle, bidi panel,
 * help, and the safety.easy advisory bodies surfaced through the
 * SlowQueryWarningModal in Easy mode).
 */

import { describe, expect, it } from "vitest";
import en from "../locales/en.json";
import ru from "../locales/ru.json";

const KEYS = [
  "easyMode.toggle.easyOn",
  "easyMode.toggle.standardOn",
  "easyMode.toggle.hint",
  "easyMode.bidi.title",
  "easyMode.bidi.toggle",
  "easyMode.bidi.hint",
  "easyMode.help.restartTour",
  "safety.easy.cross-join.title",
  "safety.easy.cross-join.body",
  "safety.easy.slow-preview.title",
  "safety.easy.slow-preview.body",
] as const;

function get(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, k) => {
    if (acc && typeof acc === "object" && k in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[k];
    }
    return undefined;
  }, obj);
}

describe("s33 i18n keys (easy-mode-core)", () => {
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

  it("cross-join body interpolates {{tableCount}} in both locales", () => {
    expect(get(en, "safety.easy.cross-join.body")).toContain("{{tableCount}}");
    expect(get(ru, "safety.easy.cross-join.body")).toContain("{{tableCount}}");
  });
});
