/**
 * — Monaco completion provider.
 *
 * `rankAndBuild` is the only Monaco-coupled piece outside `index.ts`; it
 * produces ready-to-render `languages.CompletionItem` arrays from a pure
 * Scope + Snapshot + snippets array. The Monaco `CompletionItemProvider`
 * wrapper at the bottom delegates to it so the ranking logic stays unit-testable.
 */

import type { editor, languages } from "monaco-editor";
import type { AutocompleteSnapshot } from "../../../lib/tauri";
import { useJsonbInference } from "../../jsonb/inference";
import { useAutocompleteCache } from "./cache";
import { BUILTIN_FUNCTIONS } from "./functions";
import { type CompletionPath, buildJsonbCompletions } from "./jsonbCompletions";
import { analyzeScope } from "./scope";
import { BUILTIN_SNIPPETS } from "./snippets";
import type { Scope, SnippetTemplate } from "./types";

// CompletionItemKind values are stable Monaco enum constants.
const KIND_PROPERTY = 9; // languages.CompletionItemKind.Property
const KIND_CLASS = 6; // languages.CompletionItemKind.Class
const KIND_FUNCTION = 1; // languages.CompletionItemKind.Function
const KIND_KEYWORD = 17; // languages.CompletionItemKind.Keyword
const KIND_SNIPPET = 27; // languages.CompletionItemKind.Snippet
const INSERT_AS_SNIPPET = 4; // languages.CompletionItemInsertTextRule.InsertAsSnippet

type RawItem = Omit<languages.CompletionItem, "range"> & {
  /** Numeric tier for sorting. Lower = higher in the list. */
  tier: number;
};

const tierWidth = 4;
const sortKey = (tier: number, label: string) =>
  `${tier.toString().padStart(tierWidth, "0")}_${label.toLowerCase()}`;

export function rankAndBuild(  scope: Scope,
  snapshot: AutocompleteSnapshot,
  snippets: readonly SnippetTemplate[],
  retrigger?: () => void,
): { suggestions: languages.CompletionItem[]; incomplete: boolean } {
  const items: RawItem[] = [];

  const trigger = scope.trigger;
  if (trigger.kind === "jsonb-path") {
    const target = resolveJsonbColumn(scope, snapshot, trigger.alias, trigger.column);
    if (!target) {
      // Column doesn't resolve to a known JSONB column — silently abort jsonb-path.
      return finalise([], false);
    }
    const cached = useJsonbInference.getState().getCached(target.connId, target.fqn);
    if (!cached) {
      // Fire-and-forget: request the schema; retrigger Monaco when it lands.
      if (retrigger) {
        useJsonbInference.getState().request(target.connId, target.fqn, retrigger);
      } else {
        useJsonbInference.getState().request(target.connId, target.fqn);
      }
      return { suggestions: [], incomplete: true };
    }
    const completions = buildJsonbCompletions(      cached,
      trigger.path as CompletionPath,
      trigger.partial,
);
    for (const c of completions) {
      items.push({
        label: c.label,
        kind: KIND_PROPERTY,
        insertText: c.insertText,
        detail: c.detail,
        documentation: c.documentation,
        sortText: sortKey(c.tier, c.label),
        tier: c.tier,
      });
    }
    return finalise(items, false);
  }

  if (trigger.kind === "alias-dot") {
    // Try CTE first
    const cte = scope.ctes.find((c) => c.name.toLowerCase() === trigger.alias.toLowerCase());
    if (cte?.columns) {
      for (const col of cte.columns) items.push(makeColumn(col, "", true, 0));
      return finalise(items, false);
    }
    // FROM alias
    const from = scope.fromAliases.find(      (a) => a.alias.toLowerCase() === trigger.alias.toLowerCase(),
);
    if (from) {
      if (from.columns) {
        for (const col of from.columns) items.push(makeColumn(col, "", true, 1000));
      } else if (from.relation) {
        const rel = findRelation(snapshot, from.relation.schema, from.relation.name);
        if (rel) {
          for (const col of rel.columns) {
            items.push(makeColumn(col.name, col.dataType, col.nullable, 1000));
          }
        }
      }
      return finalise(items, false);
    }
    // Schema-dot fallback (no alias matched; treat as schema)
    const schema = trigger.alias;
    for (const rel of snapshot.relations) {
      if (rel.schema.toLowerCase() === schema.toLowerCase()) {
        items.push(makeRelation(rel, 2000, /* qualified */ false));
      }
    }
    return finalise(items, false);
  }

  // FROM/JOIN clause: tables/views by search_path priority + CTE names
  if (scope.clause === "from" || scope.clause === "join") {
    for (const c of scope.ctes) {
      items.push({
        label: c.name,
        kind: KIND_CLASS,
        insertText: c.name,
        detail: "CTE",
        sortText: sortKey(0, c.name),
        tier: 0,
      });
    }
    for (const rel of snapshot.relations) {
      const schemaIdx = snapshot.searchPath.findIndex(        (s) => s.toLowerCase() === rel.schema.toLowerCase(),
);
      const tier = schemaIdx === 0 ? 2000 : 3000;
      items.push(makeRelation(rel, tier, schemaIdx > 0));
    }
    addSnippets(items, scope, snippets, /* explicitOnly */ false);
    addKeywords(items, ["SELECT", "WITH", "FROM", "JOIN", "LEFT", "INNER"]);
    return finalise(items, false);
  }

  // Default — SELECT-list, WHERE, GROUP BY, etc.: surface FROM-alias columns + functions + keywords
  for (const a of scope.fromAliases) {
    if (a.columns) {
      for (const c of a.columns) items.push(makeColumn(c, "", true, 1000));
    } else if (a.relation) {
      const rel = findRelation(snapshot, a.relation.schema, a.relation.name);
      if (rel) {
        for (const c of rel.columns) items.push(makeColumn(c.name, c.dataType, c.nullable, 1000));
      }
    }
  }
  for (const c of scope.ctes) {
    if (c.columns) for (const col of c.columns) items.push(makeColumn(col, "", true, 0));
  }
  for (const f of BUILTIN_FUNCTIONS) {
    items.push({
      label: f.name,
      kind: KIND_FUNCTION,
      insertText: `${f.name}($0)`,
      insertTextRules: INSERT_AS_SNIPPET,
      detail: f.signature,
      sortText: sortKey(5000, f.name),
      tier: 5000,
    });
  }
  addKeywords(items, ["AND", "OR", "NOT", "IS", "NULL", "AS", "BETWEEN", "IN", "EXISTS"]);
  addSnippets(items, scope, snippets, /* explicitOnly */ false);
  return finalise(items, false);
}

function makeColumn(name: string, dataType: string, nullable: boolean, tier: number): RawItem {
  return {
    label: name,
    kind: KIND_PROPERTY,
    insertText: name,
    detail: dataType ? `${dataType}${nullable ? "" : " NOT NULL"}` : undefined,
    sortText: sortKey(tier, name),
    tier,
  };
}

function makeRelation(  rel: AutocompleteSnapshot["relations"][number],
  tier: number,
  qualified: boolean,
): RawItem {
  return {
    label: rel.name,
    kind: KIND_CLASS,
    insertText: qualified ? `${rel.schema}.${rel.name}` : rel.name,
    detail: `${rel.kind} · ${rel.schema}`,
    sortText: sortKey(tier, rel.name),
    tier,
  };
}

function resolveJsonbColumn(  scope: Scope,
  snapshot: AutocompleteSnapshot,
  alias: string | null,
  column: string,
): { connId: string; fqn: { schema: string; table: string; column: string } } | null {
  // 1) Primary path — walk fromAliases. Always preferred when there's a FROM
  // clause because the user is unambiguous about which relation they meant.
  for (const fa of scope.fromAliases) {
    if (alias !== null && fa.alias.toLowerCase() !== alias.toLowerCase()) continue;
    if (!fa.relation) continue;
    const rel = findRelation(snapshot, fa.relation.schema, fa.relation.name);
    if (!rel) continue;
    const col = rel.columns.find((c) => c.name.toLowerCase() === column.toLowerCase() && c.isJsonb);
    if (col) {
      return {
        connId: snapshot.connId,
        fqn: { schema: rel.schema, table: rel.name, column: col.name },
      };
    }
  }

  // 2) fallback — no FROM clause yet (e.g. user typed
  // `SELECT data->>'` without finishing the query). Walk snapshot in
  // search_path order and offer suggestions if exactly ONE relation in the
  // search path has a JSONB column with this name. Multiple matches → bail
  // out (we don't want to surface the wrong table's keys).
  if (alias === null && scope.fromAliases.length === 0) {
    type Match = {
      connId: string;
      fqn: { schema: string; table: string; column: string };
    };
    const firstMatch: Match | null = null;
    for (const sch of snapshot.searchPath) {
      const matchesInSchema: Match[] = [];
      for (const rel of snapshot.relations) {
        if (rel.schema.toLowerCase() !== sch.toLowerCase()) continue;
        const col = rel.columns.find(          (c) => c.name.toLowerCase() === column.toLowerCase() && c.isJsonb,
);
        if (col) {
          matchesInSchema.push({
            connId: snapshot.connId,
            fqn: { schema: rel.schema, table: rel.name, column: col.name },
          });
        }
      }
      if (matchesInSchema.length === 1) {
        // First schema in search path with exactly one match wins.
        return matchesInSchema[0]!;
      }
      if (matchesInSchema.length > 1) {
        // Ambiguous in this schema — refuse to guess.
        return null;
      }
      // matchesInSchema.length === 0 → continue walking the search path.
      void firstMatch;
    }
  }

  return null;
}

function findRelation(  snapshot: AutocompleteSnapshot,
  schema: string | undefined,
  name: string,
): AutocompleteSnapshot["relations"][number] | undefined {
  if (schema) {
    return snapshot.relations.find(      (r) =>
        r.name.toLowerCase() === name.toLowerCase() &&
        r.schema.toLowerCase() === schema.toLowerCase(),
);
  }
  // No schema: walk search_path order.
  for (const sch of snapshot.searchPath) {
    const r = snapshot.relations.find(      (rel) =>
        rel.name.toLowerCase() === name.toLowerCase() &&
        rel.schema.toLowerCase() === sch.toLowerCase(),
);
    if (r) return r;
  }
  return undefined;
}

function addSnippets(  items: RawItem[],
  scope: Scope,
  snippets: readonly SnippetTemplate[],
  explicitOnly: boolean,
): void {
  for (const s of snippets) {
    const visible = !s.visibleIn || s.visibleIn.includes(scope.clause);
    if (!visible && !explicitOnly) continue;
    items.push({
      label: s.label,
      kind: KIND_SNIPPET,
      insertText: s.body,
      insertTextRules: INSERT_AS_SNIPPET,
      detail: "snippet",
      sortText: sortKey(7000, s.id),
      tier: 7000,
      filterText: [s.label, ...s.prefixes].join(" "),
    });
  }
}

function addKeywords(items: RawItem[], words: string[]): void {
  for (const w of words) {
    items.push({
      label: w,
      kind: KIND_KEYWORD,
      insertText: w,
      sortText: sortKey(6000, w),
      tier: 6000,
    });
  }
}

function finalise(  items: RawItem[],
  incomplete: boolean,
): { suggestions: languages.CompletionItem[]; incomplete: boolean } {
  // Stable sort by (tier, label) so the returned array order matches the
  // user-visible Monaco ordering driven by sortText. Monaco re-sorts by
  // sortText anyway, but consumers (and tests) expect items[0] to be the
  // top-ranked suggestion.
  const sorted = [...items].sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    return String(a.label).localeCompare(String(b.label));
  });
  const suggestions = sorted.map(({ tier: _tier, ...rest }) => rest as languages.CompletionItem);
  return { suggestions, incomplete };
}

// ---------------------------------------------------------------------------
// Monaco wrapper
// ---------------------------------------------------------------------------

export interface ProviderHooks {
  getActiveConnId: () => string | null;
  getActiveEditor: () => editor.ICodeEditor | null;
}

export function buildProvider(hooks: ProviderHooks): languages.CompletionItemProvider {
  const retriggerSuggest = (): void => {
    const ed = hooks.getActiveEditor();
    ed?.trigger("autocomplete", "editor.action.triggerSuggest", {});
  };

  return {
    triggerCharacters: [".", '"', "'"],
    provideCompletionItems(model, position): languages.ProviderResult<languages.CompletionList> {
      const connId = hooks.getActiveConnId();
      if (!connId) return { suggestions: [] };
      // Use the WHOLE buffer + cursor offset so FROM aliases written AFTER
      // the cursor (typical when the user backfills a SELECT-list once the
      // skeleton is already typed) still resolve correctly ().
      // Falling back to a prefix slice — the previous behaviour — left
      // alias-dot pointing into the abyss whenever the FROM clause sat on
      // a line below the caret.
      const fullText = model.getValue();
      const cursorOffset = model.getOffsetAt(position);
      const scope = analyzeScope(fullText, cursorOffset);
      const snapshot = useAutocompleteCache.getState().getSnapshot(connId);
      if (!snapshot) {
        const onResolved = () => {
          const ed = hooks.getActiveEditor();
          ed?.trigger("autocomplete", "editor.action.triggerSuggest", {});
        };
        void useAutocompleteCache.getState().loadSnapshot(connId, onResolved);
        return { suggestions: [], incomplete: true };
      }
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      const built = rankAndBuild(scope, snapshot, BUILTIN_SNIPPETS, retriggerSuggest);
      return {
        suggestions: built.suggestions.map((s) => ({ ...s, range })),
        incomplete: built.incomplete,
      };
    },
  };
}
