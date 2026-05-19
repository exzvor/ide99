/**
 * — sanity checks for the Easy linter rule registry.
 */

import { describe, expect, it } from "vitest";
import { EASY_RULES } from "../rules";

describe("EASY_RULES", () => {
  it("ships at least 10 rules", () => {
    expect(EASY_RULES.length).toBeGreaterThanOrEqual(10);
  });

  it("ids are unique slug-shaped", () => {
    const seen = new Set<string>();
    for (const r of EASY_RULES) {
      expect(r.id).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(seen.has(r.id)).toBe(false);
      seen.add(r.id);
    }
  });

  it("EN + RU messages are non-empty", () => {
    for (const r of EASY_RULES) {
      expect(r.message.en.trim().length).toBeGreaterThan(0);
      expect(r.message.ru.trim().length).toBeGreaterThan(0);
      if (r.fix) {
        expect(r.fix.en.trim().length).toBeGreaterThan(0);
        expect(r.fix.ru.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("severity is info or warning", () => {
    for (const r of EASY_RULES) {
      expect(["info", "warning"]).toContain(r.severity);
    }
  });

  it("top-5 rules ship a fix string", () => {
    const top5 = [
      "where_eq_null",
      "limit_without_order",
      "update_no_where",
      "delete_no_where",
      "cross_join_implicit",
    ];
    for (const id of top5) {
      const r = EASY_RULES.find((x) => x.id === id);
      expect(r).toBeDefined();
      expect(r?.fix).toBeDefined();
    }
  });
});
