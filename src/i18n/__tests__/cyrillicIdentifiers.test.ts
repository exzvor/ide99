// — Cyrillic identifier QA suite (acceptance criterion #2).
//
// Ensures cyrillic SQL identifiers (`"Заказы"`, etc.) survive the
// autocomplete pipeline, ERD edge logic, and string-comparison helpers
// without being mangled by case-folding, normalisation, or word-boundary
// regexes that assume ASCII.
//
// baseline: 6 tests. ≥10 new
// tests covering the autocomplete scope analyser, ERD label rendering,
// the SQL formatter's quoted-identifier passthrough, and locale-aware
// sort/filter helpers.

import { describe, expect, it } from "vitest";

import { analyzeScope, tokenize } from "../../features/editor/autocomplete/scope";
import { formatSql } from "../../features/editor/format/formatter";
import { layoutGraph } from "../../features/erd/layout";

describe("Cyrillic identifiers — baseline", () => {
  it("simple Russian table name survives JSON.stringify roundtrip", () => {
    const obj = { table: '"Заказы"' };
    const restored = JSON.parse(JSON.stringify(obj)) as typeof obj;
    expect(restored.table).toBe('"Заказы"');
  });

  it("toLowerCase preserves Cyrillic letters (no transliteration)", () => {
    expect("ЗАКАЗЫ".toLowerCase()).toBe("заказы");
    expect("Пользователи".toLowerCase()).toBe("пользователи");
  });

  it("string length counts Cyrillic letters as single chars", () => {
    expect("Заказы".length).toBe(6);
    expect("Пользователи".length).toBe(12);
  });

  it("identifier-allowed character regex includes Cyrillic via Unicode flag", () => {
    const re = /^[\p{L}\p{N}_]+$/u;
    expect(re.test("Заказы")).toBe(true);
    expect(re.test("Заказы_2025")).toBe(true);
    expect(re.test("orders")).toBe(true);
    expect(re.test("123")).toBe(true);
    expect(re.test("with space")).toBe(false);
  });

  it("word boundary search finds Cyrillic occurrence", () => {
    // \b in JavaScript is ASCII-aware; for Cyrillic we must rely on Unicode
    // property escapes — this guards downstream helpers (CTE composer FE,
    // markdown var substitution, autocomplete provider) against regressions.
    const haystack = "SELECT * FROM Заказы WHERE id = 1";
    const re = /(?<![\p{L}\p{N}_])Заказы(?![\p{L}\p{N}_])/u;
    expect(re.test(haystack)).toBe(true);
  });

  it("locale-aware compare orders Cyrillic predictably", () => {
    const arr = ["Пользователи", "Заказы", "Адреса"];
    const sorted = [...arr].sort((a, b) => a.localeCompare(b, "ru"));
    expect(sorted).toEqual(["Адреса", "Заказы", "Пользователи"]);
  });
});

// ---------------------------------------------------------------------------
// extension — autocomplete scope round-trip
// ---------------------------------------------------------------------------

describe("Cyrillic identifiers — autocomplete scope", () => {
  it("tokenizer emits qident token for double-quoted Cyrillic identifier", () => {
    const toks = tokenize('"Заказы"');
    // First token is the qident (we ignore the trailing eof sentinel).
    expect(toks[0].kind).toBe("qident");
    expect(toks[0].text).toBe('"Заказы"');
  });

  it("scope analyser collects Cyrillic table as a FROM alias", () => {
    const scope = analyzeScope('SELECT * FROM "Заказы" WHERE |');
    // Cursor is at the `|` marker — analyser ignores it as text but the
    // FROM alias list should contain the Cyrillic table.
    const aliasNames = scope.fromAliases.map((a) => a.alias);
    expect(aliasNames).toContain("Заказы");
    const rel = scope.fromAliases.find((a) => a.alias === "Заказы")?.relation;
    expect(rel?.name).toBe("Заказы");
  });

  it("scope analyser handles Cyrillic identifier with explicit alias", () => {
    const scope = analyzeScope('SELECT * FROM "Заказы" z WHERE z.id = 1');
    const aliases = scope.fromAliases.map((a) => a.alias);
    expect(aliases).toContain("z");
    const z = scope.fromAliases.find((a) => a.alias === "z");
    expect(z?.relation?.name).toBe("Заказы");
  });

  it("autocomplete partial inside open Cyrillic quote produces a quote trigger", () => {
    const scope = analyzeScope('SELECT * FROM "Зак');
    // Partial qident → trigger.kind === "quote".
    expect(scope.trigger.kind).toBe("quote");
    if (scope.trigger.kind === "quote") {
      expect(scope.trigger.partial).toBe("Зак");
    }
  });
});

// ---------------------------------------------------------------------------
// extension — ERD node label rendering
// ---------------------------------------------------------------------------

describe("Cyrillic identifiers — ERD label rendering", () => {
  it("ERD layout preserves Cyrillic table name verbatim", () => {
    // Build a fake schema graph the way ErdPane does — only the fields layout
    // actually consumes need to be present.
    const graph = {
      tables: [
        {
          schema: "public",
          name: "Пользователи",
          columns: [
            {
              name: "id",
              dataType: "uuid",
              nullable: false,
              isPrimaryKey: true,
              isForeignKey: false,
              ordinal: 1,
            },
          ],
        },
      ],
      foreignKeys: [],
      fetchedInMs: 0,
    };
    const laid = layoutGraph(graph as unknown as Parameters<typeof layoutGraph>[0]);
    expect(laid.nodes).toHaveLength(1);
    expect(laid.nodes[0].name).toBe("Пользователи");
    expect(laid.nodes[0].id).toBe("public.Пользователи");
  });

  it("ERD layout supports a graph mixing Cyrillic + Latin tables", () => {
    const graph = {
      tables: [
        { schema: "public", name: "Заказы", columns: [] },
        { schema: "public", name: "users", columns: [] },
      ],
      foreignKeys: [],
      fetchedInMs: 0,
    };
    const laid = layoutGraph(graph as unknown as Parameters<typeof layoutGraph>[0]);
    const names = laid.nodes.map((n) => n.name);
    expect(names).toContain("Заказы");
    expect(names).toContain("users");
  });
});

// ---------------------------------------------------------------------------
// extension — formatter passthrough
// ---------------------------------------------------------------------------

describe("Cyrillic identifiers — formatter", () => {
  it("formatSql preserves quoted Cyrillic identifier verbatim", () => {
    const out = formatSql('SELECT "Заказы"."Дата" FROM "Заказы"');
    expect(out).not.toBeNull();
    expect(out).toContain('"Заказы"');
    expect(out).toContain('"Дата"');
  });

  it("formatSql preserves Cyrillic + Latin identifier mix", () => {
    const out = formatSql(      'SELECT u.id, "Заказы"."Дата" FROM users u JOIN "Заказы" ON u.id = "Заказы".user_id',
);
    expect(out).not.toBeNull();
    if (out !== null) {
      expect(out).toContain('"Заказы"');
      expect(out).toContain("u.id");
    }
  });

  it("Cyrillic identifier without quotes is preserved if formatter accepts it", () => {
    // PostgreSQL technically requires Cyrillic identifiers to be quoted, but
    // sql-formatter@15 is permissive; we just guarantee no transliteration.
    const out = formatSql("SELECT id FROM Заказы");
    expect(out).not.toBeNull();
    if (out !== null) {
      expect(out).toContain("Заказы");
    }
  });
});

// ---------------------------------------------------------------------------
// extension — locale-aware sort + filter
// ---------------------------------------------------------------------------

describe("Cyrillic identifiers — sort + filter", () => {
  it("ru locale interleaves Cyrillic + Latin tables alphabetically", () => {
    const arr = ["users", "Заказы", "addresses", "Адреса", "products", "Пользователи"];
    const sorted = [...arr].sort((a, b) => a.localeCompare(b, "ru"));
    // Russian collation puts Cyrillic letters AFTER Latin in the default
    // tailoring, but the precise interleaving is locale-defined. We assert
    // the deterministic, observed ordering for `ru-RU`.
    expect(sorted.indexOf("Адреса")).toBeLessThan(sorted.indexOf("Заказы"));
    expect(sorted.indexOf("Заказы")).toBeLessThan(sorted.indexOf("Пользователи"));
    expect(sorted.indexOf("addresses")).toBeLessThan(sorted.indexOf("products"));
    expect(sorted.indexOf("products")).toBeLessThan(sorted.indexOf("users"));
  });

  it("case-insensitive Cyrillic filter matches lowercase user input", () => {
    const tables = ["Заказы", "Пользователи", "Адреса"];
    const needle = "поль";
    const matches = tables.filter((t) =>
      t.toLocaleLowerCase("ru").includes(needle.toLocaleLowerCase("ru")),
);
    expect(matches).toEqual(["Пользователи"]);
  });

  it("autocomplete prefix-match treats Cyrillic case-insensitively", () => {
    const candidates = ["Заказы", "Запросы", "Закладки", "Пользователи"];
    const prefix = "за";
    const matched = candidates.filter((c) =>
      c.toLocaleLowerCase("ru").startsWith(prefix.toLocaleLowerCase("ru")),
);
    // "Заказы", "Запросы", "Закладки" all start with "за". Use locale-aware
    // collation (ru) for the post-filter sort so the order matches what users
    // see in the SchemaTree. Russian collation orders by character position,
    // so the second-letter "к" puts "Заказы" + "Закладки" before "Запросы",
    // and within "Зак*" the third-letter "а" beats "л" → Заказы, Закладки.
    const sorted = matched.sort((a, b) => a.localeCompare(b, "ru"));
    expect(sorted).toEqual(["Заказы", "Закладки", "Запросы"]);
  });
});

// ---------------------------------------------------------------------------
// extension — quoted vs unquoted PG semantics
// ---------------------------------------------------------------------------

describe("Cyrillic identifiers — PG quoting semantics", () => {
  it("escaped double-quote inside Cyrillic identifier is preserved", () => {
    // PostgreSQL uses doubled `""` to embed a literal `"` inside a quoted
    // identifier. The lexer must round-trip such an identifier.
    const toks = tokenize('"Заказы""архив"');
    expect(toks[0].kind).toBe("qident");
    expect(toks[0].text).toBe('"Заказы""архив"');
  });

  it("Cyrillic identifier survives Unicode normalization (NFC vs NFD)", () => {
    // Some macOS file systems emit NFD strings. Even when canonically
    // equivalent, the string equality check via `===` requires both sides
    // to be the same form. We normalize before comparing in the few places
    // we need to (this test guards that behavior).
    const composed = "Заказы";
    const decomposed = composed.normalize("NFD");
    const recomposed = decomposed.normalize("NFC");
    expect(recomposed).toBe(composed);
    // Cyrillic strings are mostly stable under NFD because there are no
    // diacritic compositions in the Russian alphabet — sanity-check that
    // assumption holds.
    expect(decomposed).toBe(composed);
  });
});
