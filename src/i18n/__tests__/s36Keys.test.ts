/**
 * — i18n parity for baseline (privacy + onboarding +
 * file_sharing). Sub-agents D / C / F extend.
 */

import { describe, expect, it } from "vitest";
import en from "../locales/en.json";
import ru from "../locales/ru.json";

const KEYS = [
  "privacy.title",
  "privacy.telemetry.title",
  "privacy.telemetry.enable",
  "privacy.telemetry.endpoint",
  "privacy.telemetry.endpoint_none",
  "privacy.crash.title",
  "privacy.crash.enable",
  "privacy.crash.send.success",
  "privacy.crash.send.not_configured",
  "privacy.crash.send.error",
  "privacy.clear_all",
  "privacy.opt_in.title",
  "privacy.opt_in.body",
  "privacy.opt_in.decline",
  "privacy.opt_in.accept",
  "privacy.opt_in.footer",
  "onboarding.step.welcome.title",
  "onboarding.step.connection.title",
  "onboarding.step.tour-handoff.title",
  "onboarding.welcome.body",
  "onboarding.welcome.standard",
  "onboarding.welcome.easy",
  "onboarding.connection.body",
  "onboarding.profile.local",
  "onboarding.profile.supabase",
  "onboarding.profile.neon",
  "onboarding.profile.railway",
  "onboarding.profile.rds",
  "onboarding.profile.spg99",
  "onboarding.profile.custom",
  "onboarding.profile.skip",
  "onboarding.tour_handoff.body",
  "onboarding.tour_handoff.finish",
  "file_sharing.import.title",
  "file_sharing.import.pick",
  "file_sharing.import.kind",
  "file_sharing.import.cancel",
  "file_sharing.import.apply",
  "file_sharing.export.connection",
  "file_sharing.export.connection_bundle",
] as const;

function get(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, k) => {
    if (acc && typeof acc === "object" && k in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[k];
    }
    return undefined;
  }, obj);
}

describe("s36 i18n keys (baseline)", () => {
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
