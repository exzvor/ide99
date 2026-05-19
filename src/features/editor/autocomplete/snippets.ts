import { BUILTIN_SNIPPET_EXTENSIONS } from "../../snippets/builtinExtensions";
import type { SnippetTemplate } from "./types";

const SPRINT_7_BUILTINS: readonly SnippetTemplate[] = Object.freeze([
  {
    id: "select_from_where",
    label: "SELECT … FROM … WHERE",
    prefixes: ["sel", "select"],
    body: "SELECT ${1:*}\nFROM ${2:table}\nWHERE ${3:condition};$0",
    docI18nKey: "editor.snippets.select_from_where.doc",
    visibleIn: ["unknown"],
  },
  {
    id: "select_group_having",
    label: "SELECT … GROUP BY … HAVING",
    prefixes: ["selg"],
    body: "SELECT ${1:col}, COUNT(*)\nFROM ${2:table}\nGROUP BY ${1:col}\nHAVING COUNT(*) > ${3:1};$0",
    docI18nKey: "editor.snippets.select_group_having.doc",
    visibleIn: ["unknown"],
  },
  {
    id: "inner_join",
    label: "INNER JOIN … ON",
    prefixes: ["join", "ijoin"],
    body: "JOIN ${1:table} ${2:t} ON ${2:t}.${3:fk} = ${4:other}.${5:pk}$0",
    docI18nKey: "editor.snippets.inner_join.doc",
    visibleIn: ["from", "join"],
  },
  {
    id: "left_join",
    label: "LEFT JOIN … ON",
    prefixes: ["ljoin"],
    body: "LEFT JOIN ${1:table} ${2:t} ON ${2:t}.${3:fk} = ${4:other}.${5:pk}$0",
    docI18nKey: "editor.snippets.left_join.doc",
    visibleIn: ["from", "join"],
  },
  {
    id: "insert_into",
    label: "INSERT INTO … VALUES",
    prefixes: ["ins", "insert"],
    body: "INSERT INTO ${1:table} (${2:columns})\nVALUES (${3:values});$0",
    docI18nKey: "editor.snippets.insert_into.doc",
    visibleIn: ["unknown"],
  },
  {
    id: "update_set_where",
    label: "UPDATE … SET … WHERE",
    prefixes: ["upd", "update"],
    body: "UPDATE ${1:table}\nSET ${2:col} = ${3:value}\nWHERE ${4:condition};$0",
    docI18nKey: "editor.snippets.update_set_where.doc",
    visibleIn: ["unknown"],
  },
  {
    id: "create_table",
    label: "CREATE TABLE",
    prefixes: ["ctab", "create_table"],
    body: "CREATE TABLE ${1:name} (\n  id BIGSERIAL PRIMARY KEY,\n  ${2:column} ${3:type}${4: NOT NULL}\n);$0",
    docI18nKey: "editor.snippets.create_table.doc",
    visibleIn: ["unknown"],
  },
  {
    id: "create_index",
    label: "CREATE INDEX",
    prefixes: ["cidx", "create_index"],
    body: "CREATE INDEX ${1:idx_name} ON ${2:table} (${3:column});$0",
    docI18nKey: "editor.snippets.create_index.doc",
    visibleIn: ["unknown"],
  },
]);

/**
 * 17 built-ins total: 8  + 9 .
 * User snippets from `useSnippets.userSnippets` are merged in by
 * `useSnippets.getMerged()` — that's where prefix-collision dedup happens.
 */
export const BUILTIN_SNIPPETS: readonly SnippetTemplate[] = Object.freeze([
  ...SPRINT_7_BUILTINS,
  ...BUILTIN_SNIPPET_EXTENSIONS,
]);
