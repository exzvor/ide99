import { describe, expect, it } from "vitest";
import { BUILTIN_SNIPPET_EXTENSIONS } from "./builtinExtensions";

describe("BUILTIN_SNIPPET_EXTENSIONS", () => {
  it("ships exactly the 9 templates added in ", () => {
    expect(BUILTIN_SNIPPET_EXTENSIONS.map((s) => s.id).sort()).toEqual([
      "case_when",
      "cte",
      "cte_recursive",
      "jsonb_contains",
      "jsonb_get",
      "truncate",
      "union_all",
      "window_lag",
      "window_row_number",
    ]);
  });

  it("each has non-empty body / label / prefixes / docI18nKey", () => {
    for (const s of BUILTIN_SNIPPET_EXTENSIONS) {
      expect(s.body.length).toBeGreaterThan(0);
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.prefixes.length).toBeGreaterThan(0);
      expect(s.docI18nKey).toMatch(/^editor\.snippets\.[a-z_]+\.doc$/);
    }
  });

  it("each body contains the $0 / ${0} final-cursor placeholder", () => {
    for (const s of BUILTIN_SNIPPET_EXTENSIONS) {
      expect(s.body).toMatch(/\$\{?0\}?/);
    }
  });
});
