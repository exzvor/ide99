/**
 * — lookup engine + agent context builder.
 */

import { describe, expect, it } from "vitest";
import { buildAgentContext, explainError, pickLocale } from "../lookup";
import { ERROR_CLASS_BY_PREFIX, ERROR_ENTRIES } from "../mapping";

describe("explainError", () => {
  it("matches an exact SQLSTATE first", () => {
    const r = explainError({ sqlstate: "23505", message: "duplicate key value …" });
    expect(r).not.toBeNull();
    expect(r?.exact).toBe(true);
    expect(r?.matchedCode).toBe("23505");
    expect(r?.explanation.en.toLowerCase()).toContain("unique");
    expect(r?.suggestedFix?.en.toLowerCase()).toContain("on conflict");
  });

  it("matches a regex pattern when SQLSTATE is missing", () => {
    const r = explainError({
      sqlstate: null,
      message: 'duplicate key value violates unique constraint "users_pkey"',
    });
    expect(r?.exact).toBe(true);
    expect(r?.matchedCode).toBe("23505");
  });

  it("falls back to the class entry when neither code nor pattern matches", () => {
    const r = explainError({
      sqlstate: "23999", // non-canonical 23xxx
      message: "some weird integrity error",
    });
    expect(r?.exact).toBe(false);
    expect(r?.classFallback).toBe(true);
    expect(r?.matchedCode).toBe("23999");
    expect(r?.explanation.en.toLowerCase()).toContain("integrity");
  });

  it("returns null when nothing matches", () => {
    const r = explainError({ sqlstate: "ZZ999", message: "totally unknown" });
    expect(r).toBeNull();
  });

  it("matches division by zero by message even without SQLSTATE", () => {
    const r = explainError({ message: "division by zero" });
    expect(r?.matchedCode).toBe("22012");
  });

  it("matches insufficient privilege by SQLSTATE 42501", () => {
    const r = explainError({ sqlstate: "42501", message: "permission denied for table x" });
    expect(r?.matchedCode).toBe("42501");
    expect(r?.suggestedFix?.ru).toContain("GRANT");
  });

  it("matches deadlock detected", () => {
    const r = explainError({ sqlstate: "40P01", message: "deadlock detected" });
    expect(r?.exact).toBe(true);
    expect(r?.matchedCode).toBe("40P01");
  });

  it("matches relation does not exist (42P01)", () => {
    const r = explainError({
      sqlstate: "42P01",
      message: 'relation "users" does not exist',
    });
    expect(r?.matchedCode).toBe("42P01");
  });
});

describe("pickLocale", () => {
  it("returns ru when locale starts with ru", () => {
    expect(pickLocale({ en: "Hello", ru: "Привет" }, "ru")).toBe("Привет");
    expect(pickLocale({ en: "Hello", ru: "Привет" }, "ru-RU")).toBe("Привет");
  });
  it("falls back to en for any other locale", () => {
    expect(pickLocale({ en: "Hello", ru: "Привет" }, "en")).toBe("Hello");
    expect(pickLocale({ en: "Hello", ru: "Привет" }, "de")).toBe("Hello");
  });
});

describe("buildAgentContext", () => {
  it("omits SQLSTATE when missing", () => {
    const ctx = buildAgentContext({ message: "boom" });
    expect(ctx).not.toContain("SQLSTATE");
    expect(ctx).toContain("Message: boom");
  });
  it("includes SQLSTATE when present", () => {
    const ctx = buildAgentContext({ sqlstate: "23505", message: "boom" });
    expect(ctx).toMatch(/SQLSTATE: 23505/);
    expect(ctx).toMatch(/Message: boom/);
  });
  it("truncates long SQL with marker", () => {
    const longSql = "x".repeat(2000);
    const ctx = buildAgentContext({ message: "m", sql: longSql, sqlMaxChars: 100 });
    expect(ctx).toContain("…(truncated)");
    expect(ctx.length).toBeLessThan(longSql.length);
  });
});

describe("mapping consistency", () => {
  it("ships at least 80 per-code entries", () => {
    expect(ERROR_ENTRIES.length).toBeGreaterThanOrEqual(80);
  });

  it("ships class entries for every common SQLSTATE class", () => {
    for (const klass of ["08", "22", "23", "25", "28", "40", "42", "53", "57", "XX"]) {
      expect(ERROR_CLASS_BY_PREFIX.has(klass)).toBe(true);
    }
  });

  it("every entry has non-empty EN+RU text", () => {
    for (const e of ERROR_ENTRIES) {
      expect(e.en.length).toBeGreaterThan(0);
      expect(e.ru.length).toBeGreaterThan(0);
      expect(e.code).toMatch(/^[A-Z0-9]{5}$/);
    }
  });

  it("every suggested fix has both locales", () => {
    for (const e of ERROR_ENTRIES) {
      if (!e.suggestedFix) continue;
      expect(e.suggestedFix.en.length).toBeGreaterThan(0);
      expect(e.suggestedFix.ru.length).toBeGreaterThan(0);
    }
  });

  it("no duplicate codes", () => {
    const seen = new Set<string>();
    for (const e of ERROR_ENTRIES) {
      expect(seen.has(e.code)).toBe(false);
      seen.add(e.code);
    }
  });
});
