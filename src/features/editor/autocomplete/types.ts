/**
 * Pure types shared by the lexer, scope tracker, ranker, and Monaco provider.
 *
 * Keeping these in one module means the rest of the autocomplete code can be
 * tested without importing Monaco — the only file that depends on Monaco's
 * types is `provider.ts`.
 */

import type { AutocompleteSnapshot } from "../../../lib/tauri";

export type Clause =
  | "select-list"
  | "from"
  | "join"
  | "where"
  | "group-by"
  | "order-by"
  | "having"
  | "set"
  | "values"
  | "unknown";

export type AutocompletePathSegment = { key: string } | { arrayIndex: number };

export type Trigger =
  | { kind: "alias-dot"; alias: string }
  | { kind: "schema-dot"; schema: string }
  | { kind: "quote"; partial: string }
  | { kind: "ctrl-space" }
  | { kind: "letter" }
  | {
      kind: "jsonb-path";
      alias: string | null;
      column: string;
      path: AutocompletePathSegment[];
      partial: string;
    };

/** A relation visible to the cursor through the FROM/JOIN chain. */
export interface FromAlias {
  /** The alias as written (or the table name if the user omitted AS). */
  alias: string;
  /** Resolved schema/name when the source is a real table/view/CTE; absent for ad-hoc subqueries. */
  relation?: { schema?: string; name: string };
  /** Inline column list when the source is `(SELECT a, b FROM …) sub`. */
  columns?: string[];
}

export interface CteScope {
  name: string;
  /** Projected columns where derivable from the SELECT-list of the CTE body. */
  columns?: string[];
}

export interface Scope {
  ctes: CteScope[];
  fromAliases: FromAlias[];
  clause: Clause;
  trigger: Trigger;
  /** The identifier prefix the user is currently typing (used for filterText). */
  prefix: string;
}

export type SnippetClauseFilter = Clause[];

export interface SnippetTemplate {
  id: string;
  label: string;
  prefixes: string[];
  body: string;
  docI18nKey: string;
  /** Soft filter — when set, only show this snippet unprompted in these clauses. */
  visibleIn?: SnippetClauseFilter;
}

export interface FunctionTemplate {
  name: string;
  signature: string;
  docI18nKey: string;
}

export type { AutocompleteSnapshot };
