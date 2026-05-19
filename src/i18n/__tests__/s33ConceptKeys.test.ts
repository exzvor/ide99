/**
 * — i18n parity for the conceptTooltip.* block.
 *
 * Lives separately from `s33Keys.test.ts` (onboarding tour) so each Easy-mode
 * sub-agent owns its own parity test and merges cleanly without contention.
 */

import { describe, expect, it } from "vitest";
import en from "../locales/en.json";
import ru from "../locales/ru.json";

const KEYS = ["conceptTooltip.trigger", "conceptTooltip.transactionHint"] as const;

function get(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, k) => {
    if (acc && typeof acc === "object" && k in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[k];
    }
    return undefined;
  }, obj);
}

describe("s33 i18n keys (conceptTooltip)", () => {
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
