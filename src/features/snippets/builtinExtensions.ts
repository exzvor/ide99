import type { SnippetTemplate } from "../editor/autocomplete/types";

/**
 * — 9 additional built-in snippets that extend the 8 .
 * Combined with `BUILTIN_SNIPPETS` in `editor/autocomplete/snippets.ts`,
 * the palette ships 17 built-ins total.
 */
export const BUILTIN_SNIPPET_EXTENSIONS: readonly SnippetTemplate[] = Object.freeze([
  {
    id: "cte",
    label: "WITH … AS …",
    prefixes: ["cte"],
    body: "WITH ${1:name} AS (\n  ${2:SELECT ...}\n)\n${0}",
    docI18nKey: "editor.snippets.cte.doc",
    visibleIn: ["unknown"],
  },
  {
    id: "cte_recursive",
    label: "WITH RECURSIVE …",
    prefixes: ["wrec", "cte_rec"],
    body:
      "WITH RECURSIVE ${1:tree} AS (\n" +
      "  -- base\n" +
      "  SELECT ${2:cols} FROM ${3:table} WHERE ${4:base_cond}\n" +
      "  UNION ALL\n" +
      "  -- step\n" +
      "  SELECT ${2:cols} FROM ${3:table} JOIN ${1:tree} ON ${5:join_cond}\n" +
      ")\nSELECT * FROM ${1:tree};$0",
    docI18nKey: "editor.snippets.cte_recursive.doc",
    visibleIn: ["unknown"],
  },
  {
    id: "window_row_number",
    label: "ROW_NUMBER() OVER (…)",
    prefixes: ["rn", "row_number"],
    body: "ROW_NUMBER() OVER (PARTITION BY ${1:col} ORDER BY ${2:col} DESC)$0",
    docI18nKey: "editor.snippets.window_row_number.doc",
    visibleIn: ["select-list", "unknown"],
  },
  {
    id: "window_lag",
    label: "LAG(…) OVER (…)",
    prefixes: ["lag"],
    body: "LAG(${1:col}) OVER (PARTITION BY ${2:partition} ORDER BY ${3:order})$0",
    docI18nKey: "editor.snippets.window_lag.doc",
    visibleIn: ["select-list", "unknown"],
  },
  {
    id: "jsonb_get",
    label: "col->>'key'",
    prefixes: ["jget", "jsonb_get"],
    body: "${1:col}->>'${2:key}'$0",
    docI18nKey: "editor.snippets.jsonb_get.doc",
    visibleIn: ["select-list", "where", "unknown"],
  },
  {
    id: "jsonb_contains",
    label: "col @> '{...}'::jsonb",
    prefixes: ["jcon", "jsonb_contains"],
    body: "${1:col} @> '${2:{}}'::jsonb$0",
    docI18nKey: "editor.snippets.jsonb_contains.doc",
    visibleIn: ["where", "unknown"],
  },
  {
    id: "case_when",
    label: "CASE WHEN … THEN …",
    prefixes: ["case", "cw"],
    body: "CASE WHEN ${1:cond} THEN ${2:val}\n     ELSE ${3:default}\nEND$0",
    docI18nKey: "editor.snippets.case_when.doc",
    visibleIn: ["select-list", "unknown"],
  },
  {
    id: "union_all",
    label: "UNION ALL",
    prefixes: ["uall", "union_all"],
    body: "UNION ALL\n${0}",
    docI18nKey: "editor.snippets.union_all.doc",
    visibleIn: ["unknown"],
  },
  {
    id: "truncate",
    label: "TRUNCATE TABLE",
    prefixes: ["tr", "truncate"],
    body: "TRUNCATE TABLE ${1:name} RESTART IDENTITY CASCADE;$0",
    docI18nKey: "editor.snippets.truncate.doc",
    visibleIn: ["unknown"],
  },
]);
