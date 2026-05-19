// — i18n parity test for the new object-editor keys.
//
// Covers the 8 toolbar entries (added by Phase A) plus the new
// fdw_server / publication / subscription / role / type body keys (B4.6).
// We assert each key exists in both en.json and ru.json so a missing
// translation surfaces immediately.

import { describe, expect, it } from "vitest";
import en from "../locales/en.json";
import ru from "../locales/ru.json";

describe("i18n S25 keys present in both locales", () => {
  const expected = [
    "object_editor.toolbar.new_fdw_server",
    "object_editor.toolbar.new_publication",
    "object_editor.toolbar.new_subscription",
    "object_editor.toolbar.new_role",
    "object_editor.toolbar.new_enum_type",
    "object_editor.toolbar.new_composite_type",
    "object_editor.toolbar.new_domain_type",
    "object_editor.toolbar.new_range_type",
    "object_editor.fdw_server.title_new",
    "object_editor.publication.title_new",
    "object_editor.subscription.title_new",
    "object_editor.role.title_new",
    "object_editor.type.enum_title_new",
    "object_editor.type.composite_title_new",
    "object_editor.type.domain_title_new",
    "object_editor.type.range_title_new",
  ];
  const get = (obj: unknown, path: string): unknown =>
    path
      .split(".")
      .reduce<unknown>(
        (acc, k) =>
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
