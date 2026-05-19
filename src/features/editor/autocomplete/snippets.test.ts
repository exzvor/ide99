import { describe, expect, it } from "vitest";
import { BUILTIN_SNIPPETS } from "./snippets";

describe("BUILTIN_SNIPPETS", () => {
  it("ships 17 templates total (8  + 9)", () => {
    expect(BUILTIN_SNIPPETS.length).toBe(17);
    const ids = BUILTIN_SNIPPETS.map((s) => s.id).sort();
    expect(ids).toEqual(
      [
        // S7
        "create_index",
        "create_table",
        "inner_join",
        "insert_into",
        "left_join",
        "select_from_where",
        "select_group_having",
        "update_set_where",
        // S8
        "case_when",
        "cte",
        "cte_recursive",
        "jsonb_contains",
        "jsonb_get",
        "truncate",
        "union_all",
        "window_lag",
        "window_row_number",
      ].sort(),
    );
  });

  it("each snippet has a non-empty body, label, prefixes and i18n key", () => {
    for (const s of BUILTIN_SNIPPETS) {
      expect(s.body.length).toBeGreaterThan(0);
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.prefixes.length).toBeGreaterThan(0);
      expect(s.docI18nKey).toMatch(/^editor\.snippets\.[a-z_]+\.doc$/);
    }
  });

  it("each snippet body contains the $0 / ${0} final-cursor placeholder", () => {
    for (const s of BUILTIN_SNIPPETS) {
      expect(s.body).toMatch(/\$\{?0\}?/);
    }
  });

  it("ids are unique", () => {
    const ids = BUILTIN_SNIPPETS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
