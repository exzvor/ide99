/**
 * — i18n parity for the new settings.mcp.external block.
 */

import { describe, expect, it } from "vitest";
import en from "../locales/en.json";
import ru from "../locales/ru.json";

const KEYS = [
  "settings.mcp.external.title",
  "settings.mcp.external.description",
  "settings.mcp.external.loading",
  "settings.mcp.external.empty",
  "settings.mcp.external.reload",
  "settings.mcp.external.reloaded",
  "settings.mcp.external.configPath",
  "settings.mcp.external.connect",
  "settings.mcp.external.disconnect",
  "settings.mcp.external.statusDisconnected",
  "settings.mcp.external.statusConnecting",
  "settings.mcp.external.statusConnected",
  "settings.mcp.external.statusError",
  "settings.mcp.external.toolsCount_one",
  "settings.mcp.external.toolsCount_other",
  "settings.mcp.external.resourcesCount_one",
  "settings.mcp.external.resourcesCount_other",
] as const;

function get(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, k) => {
    if (acc && typeof acc === "object" && k in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[k];
    }
    return undefined;
  }, obj);
}

describe("s32 i18n keys", () => {
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
