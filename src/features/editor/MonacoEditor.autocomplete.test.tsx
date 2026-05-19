import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AutocompleteSnapshot } from "../../lib/tauri";
import { useAutocompleteCache } from "./autocomplete/cache";
import { __resetAutocompleteRegistration } from "./autocomplete/index";
import { buildProvider } from "./autocomplete/provider";

/**
 * — Monaco end-to-end suggestion-list assertions.
 *
 * Why we don't drive Monaco's real suggestion controller here:
 * the existing test suite mocks `@monaco-editor/react` with a `<textarea>`
 * proxy and a hand-stubbed Monaco namespace (see MonacoEditor.test.tsx).
 * The real `editor.action.triggerSuggest` lives in Monaco's worker, which
 * can't run in jsdom. So instead we drive `buildProvider({...}).provideCompletionItems`
 * directly against fake `model` objects and assert on the resulting suggestions
 * — the same path the registered provider takes when Monaco fires it. This
 * exercises scope analysis + cache + rankAndBuild end-to-end.
 *
 * The `provider.test.ts` and `scope.test.ts` files cover the unit-level
 * assertions; this file is the wiring/coverage proof for the AC scenarios
 * exactly as written in the spec.
 */

const fixtureSnapshot: AutocompleteSnapshot = {
  connId: "c1",
  searchPath: ["public"],
  relations: [
    {
      schema: "public",
      name: "users",
      kind: "table",
      columns: [
        { name: "id", dataType: "bigint", nullable: false, isJsonb: false },
        { name: "email", dataType: "text", nullable: true, isJsonb: false },
      ],
    },
    {
      schema: "public",
      name: "Заказы",
      kind: "table",
      columns: [
        { name: "ИД", dataType: "bigint", nullable: false, isJsonb: false },
        { name: "Дата", dataType: "timestamptz", nullable: false, isJsonb: false },
      ],
    },
  ],
  loadedAt: 0,
};

function seedCache(): void {
  useAutocompleteCache.setState({
    snapshots: { c1: fixtureSnapshot },
    inflight: {},
    errors: {},
  });
}

/**
 * A minimum `editor.ITextModel` shim that satisfies the methods provider.ts
 * actually calls. After the provider passes the full buffer
 * + cursor offset (via `getValue` / `getOffsetAt`) so the analyzer can see
 * FROM aliases that appear after the cursor; for tests, the cursor sits at
 * the end of the SQL fragment and the offset equals the prefix length.
 */
function fakeModel(sql: string, cursorPos = sql.length) {
  return {
    getValue: () => sql,
    getOffsetAt: () => cursorPos,
    getValueInRange: () => sql.slice(0, cursorPos),
    getWordUntilPosition: () => {
      const upTo = sql.slice(0, cursorPos);
      const match = upTo.match(/[A-Za-z_][A-Za-z0-9_]*$/);
      const word = match ? match[0] : "";
      const startColumn = upTo.length - word.length + 1;
      return { word, startColumn, endColumn: upTo.length + 1 };
    },
  } as unknown as Parameters<
    NonNullable<ReturnType<typeof buildProvider>["provideCompletionItems"]>
  >[0];
}

function position(sql: string) {
  // Position the caret at end-of-prefix. Provider only reads lineNumber/column.
  return { lineNumber: 1, column: sql.length + 1 } as unknown as Parameters<
    NonNullable<ReturnType<typeof buildProvider>["provideCompletionItems"]>
  >[1];
}

async function suggestionsFor(sql: string): Promise<string[]> {
  const provider = buildProvider({
    getActiveConnId: () => "c1",
    getActiveEditor: () => null,
  });
  const fn = provider.provideCompletionItems;
  if (!fn) return [];
  const result = await fn(fakeModel(sql), position(sql), {} as never, {} as never);
  if (!result) return [];
  const list = "suggestions" in result ? result.suggestions : result;
  return list.map((s) => String(s.label));
}

describe("MonacoEditor autocomplete (integration via buildProvider)", () => {
  beforeEach(() => {
    __resetAutocompleteRegistration();
    seedCache();
  });

  it("CTE alias-dot suggests CTE columns", async () => {
    const labels = await suggestionsFor("WITH x AS (SELECT id, name FROM users) SELECT x.");
    expect(labels).toContain("id");
    expect(labels).toContain("name");
  });

  it("FROM alias-dot suggests table columns", async () => {
    const labels = await suggestionsFor("SELECT * FROM users u WHERE u.");
    expect(labels).toContain("id");
    expect(labels).toContain("email");
  });

  it("alias-dot resolves columns even when FROM is BELOW the cursor ()", async () => {
    // Cursor sits at offset 9, right after `SELECT u.`. The FROM clause
    // (with `users u` aliased) lives on the next line, AFTER the caret.
    // Pre-fix the provider only saw text up to the cursor, so `u` had no
    // resolution and the dropdown filled with generic word completions.
    const sql = "SELECT u.\nFROM users u\nWHERE";
    const cursor = "SELECT u.".length;
    const provider = buildProvider({
      getActiveConnId: () => "c1",
      getActiveEditor: () => null,
    });
    const fn = provider.provideCompletionItems;
    if (!fn) throw new Error("provider missing provideCompletionItems");
    const result = await fn(
      fakeModel(sql, cursor),
      { lineNumber: 1, column: cursor + 1 } as Parameters<typeof fn>[1],
      {} as never,
      {} as never,
    );
    const list = result && "suggestions" in result ? result.suggestions : (result ?? []);
    const labels = list.map((s) => String(s.label));
    expect(labels).toContain("id");
    expect(labels).toContain("email");
  });

  it("subquery alias-dot suggests projected columns", async () => {
    const labels = await suggestionsFor(
      "SELECT * FROM (SELECT id, name FROM users) sub WHERE sub.",
    );
    expect(labels).toContain("id");
    expect(labels).toContain("name");
  });

  it("LATERAL alias-dot suggests LATERAL projection", async () => {
    const labels = await suggestionsFor(
      "SELECT * FROM users u, LATERAL (SELECT max(u.id) AS m FROM users) lt WHERE lt.",
    );
    expect(labels).toContain("m");
  });

  it("Cyrillic quoted identifier alias-dot suggests Cyrillic columns", async () => {
    const labels = await suggestionsFor('SELECT * FROM "Заказы" WHERE "Заказы".');
    expect(labels).toContain("ИД");
    expect(labels).toContain("Дата");
  });

  it("empty editor + Ctrl+Space surfaces snippets and keywords", async () => {
    const labels = await suggestionsFor("");
    // SELECT … FROM … WHERE snippet (clause unknown, visibleIn=['unknown']) is in.
    expect(labels.some((l) => l.includes("SELECT"))).toBe(true);
  });

  it("returns empty when no active connection", async () => {
    const provider = buildProvider({
      getActiveConnId: () => null,
      getActiveEditor: () => null,
    });
    const fn = provider.provideCompletionItems;
    expect(fn).toBeDefined();
    const result = await fn?.(fakeModel(""), position(""), {} as never, {} as never);
    const list = result && "suggestions" in result ? result.suggestions : (result ?? []);
    expect(list).toHaveLength(0);
  });

  it("returns empty + triggers background load when snapshot missing", async () => {
    useAutocompleteCache.setState({ snapshots: {}, inflight: {}, errors: {} });
    const loadSpy = vi.spyOn(useAutocompleteCache.getState(), "loadSnapshot");
    const provider = buildProvider({
      getActiveConnId: () => "c1",
      getActiveEditor: () => null,
    });
    const fn = provider.provideCompletionItems;
    expect(fn).toBeDefined();
    const result = await fn?.(fakeModel("SELECT "), position("SELECT "), {} as never, {} as never);
    const list = result && "suggestions" in result ? result.suggestions : (result ?? []);
    expect(list).toHaveLength(0);
    expect(loadSpy).toHaveBeenCalledWith("c1", expect.any(Function));
    loadSpy.mockRestore();
  });
});
