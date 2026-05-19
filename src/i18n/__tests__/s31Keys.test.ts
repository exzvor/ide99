/**
 * — i18n parity for the new errorExplain block.
 */

import { describe, expect, it } from "vitest";
import en from "../locales/en.json";
import ru from "../locales/ru.json";

const KEYS = [
  "errorExplain.button",
  "errorExplain.title",
  "errorExplain.codeLabel",
  "errorExplain.originalMessage",
  "errorExplain.explanationHeading",
  "errorExplain.classExplanationHeading",
  "errorExplain.suggestedFix",
  "errorExplain.close",
  "errorExplain.askAgent.headline",
  "errorExplain.askAgent.copy",
  "errorExplain.askAgent.copied",
] as const;

function get(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, k) => {
    if (acc && typeof acc === "object" && k in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[k];
    }
    return undefined;
  }, obj);
}

describe("s31 i18n keys", () => {
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
