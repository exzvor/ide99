/**
 * — i18n parity for the onboardingTour block.
 */

import { describe, expect, it } from "vitest";
import en from "../locales/en.json";
import ru from "../locales/ru.json";

const KEYS = [
  "onboardingTour.skip",
  "onboardingTour.next",
  "onboardingTour.previous",
  "onboardingTour.finish",
  "onboardingTour.stepProgress",
] as const;

function get(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, k) => {
    if (acc && typeof acc === "object" && k in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[k];
    }
    return undefined;
  }, obj);
}

describe("s33 i18n keys (onboardingTour)", () => {
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

  it("stepProgress includes interpolation placeholders in both locales", () => {
    expect(get(en, "onboardingTour.stepProgress")).toContain("{{current}}");
    expect(get(en, "onboardingTour.stepProgress")).toContain("{{total}}");
    expect(get(ru, "onboardingTour.stepProgress")).toContain("{{current}}");
    expect(get(ru, "onboardingTour.stepProgress")).toContain("{{total}}");
  });
});
