// — i18n parity test for the new MCP keys.
//
// We only assert the new keys (Phase B) — the existing skeleton keys
// (`settings.mcp.title`, etc.) are already covered by Phase A.

import { describe, expect, it } from "vitest";
import en from "../locales/en.json";
import ru from "../locales/ru.json";

describe("i18n S30 keys present in both locales", () => {
  const expected = [
    "settings.mcp.lastUsed",
    "settings.mcp.lastUsedNever",
    "settings.mcp.authorize.title",
    "settings.mcp.authorize.requesting",
    "settings.mcp.authorize.scopesHeading",
    "settings.mcp.authorize.allow",
    "settings.mcp.authorize.allowReadOnly",
    "settings.mcp.authorize.allowWithWrite",
    "settings.mcp.authorize.deny",
    "settings.mcp.writeConfirm.title",
    "settings.mcp.writeConfirm.kindQuery",
    "settings.mcp.writeConfirm.kindMigration",
    "settings.mcp.writeConfirm.clientWants",
    "settings.mcp.writeConfirm.approve",
    "settings.mcp.writeConfirm.reject",
    "settings.mcp.writeConfirm.approveAllForNext",
    "settings.mcp.connect.claudeCode",
    "settings.mcp.connect.cursor",
    "settings.mcp.connect.manualConfig",
    "settings.mcp.connect.copy",
    "settings.mcp.connect.copied",
    "settings.mcp.connect.commandNotFound",
    "settings.mcp.connect.addedSuccessfully",
    "settings.mcp.connect.enableFirst",
    "settings.mcp.connect.readGuide",
    "settings.mcp.audit.title",
    "settings.mcp.audit.viewLog",
  ];
  const get = (obj: unknown, path: string): unknown =>
    path
      .split(".")
      .reduce<unknown>(        (acc, k) =>
          acc && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined,
        obj,
);
  for (const key of expected) {
    it(`${key} exists in en`, () => {
      expect(typeof get(en, key)).toBe("string");
    });
    it(`${key} exists in ru`, () => {
      expect(typeof get(ru, key)).toBe("string");
    });
  }
});
