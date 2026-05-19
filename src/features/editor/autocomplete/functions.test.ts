import { describe, expect, it } from "vitest";
import { BUILTIN_FUNCTIONS } from "./functions";

describe("BUILTIN_FUNCTIONS", () => {
  it("ships at least 70 functions", () => {
    expect(BUILTIN_FUNCTIONS.length).toBeGreaterThanOrEqual(70);
  });

  it("each function has a non-empty name, signature, and i18n doc key", () => {
    for (const f of BUILTIN_FUNCTIONS) {
      expect(f.name).toMatch(/^[a-z_]+$/);
      expect(f.signature.length).toBeGreaterThan(0);
      expect(f.docI18nKey).toMatch(/^editor\.functions\.[a-z_]+\.doc$/);
    }
  });

  it("function names are unique", () => {
    const names = BUILTIN_FUNCTIONS.map((f) => f.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("essentials present", () => {
    const names = new Set(BUILTIN_FUNCTIONS.map((f) => f.name));
    for (const must of ["count", "sum", "avg", "coalesce", "now", "to_char", "jsonb_set"]) {
      expect(names.has(must)).toBe(true);
    }
  });
});
