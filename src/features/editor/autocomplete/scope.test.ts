import { describe, expect, it } from "vitest";
import { type Token, analyzeScope, tokenize } from "./scope";

const labels = (toks: Token[]): string[] =>
  toks.filter((t) => t.kind !== "eof").map((t) => `${t.kind}:${t.text}`);

describe("tokenize", () => {
  it("emits keywords case-insensitively but preserves casing in text", () => {
    expect(labels(tokenize("Select id From t"))).toEqual([
      "keyword:Select",
      "ws: ",
      "ident:id",
      "ws: ",
      "keyword:From",
      "ws: ",
      "ident:t",
    ]);
  });

  it("recognises quoted identifiers including Cyrillic + spaces", () => {
    expect(labels(tokenize('"Заказы"."Дата"'))).toEqual([
      'qident:"Заказы"',
      "punct:.",
      'qident:"Дата"',
    ]);
  });

  it("treats single-quoted strings as one token, including doubled quote escape", () => {
    expect(labels(tokenize("'O''Brien'"))).toEqual(["string:'O''Brien'"]);
  });

  it("skips line comments", () => {
    expect(labels(tokenize("SELECT 1 -- ignore\nFROM t"))).toEqual([
      "keyword:SELECT",
      "ws: ",
      "number:1",
      "ws: ",
      "comment:-- ignore",
      "ws:\n",
      "keyword:FROM",
      "ws: ",
      "ident:t",
    ]);
  });

  it("skips nested block comments", () => {
    expect(labels(tokenize("a /* /* nested */ */ b"))).toEqual([
      "ident:a",
      "ws: ",
      "comment:/* /* nested */ */",
      "ws: ",
      "ident:b",
    ]);
  });

  it("captures dollar-quoted bodies including the tag", () => {
    expect(labels(tokenize("$tag$ body $tag$"))).toEqual(["string:$tag$ body $tag$"]);
  });

  it("does not crash on an unterminated string at EOF", () => {
    const toks = tokenize("'unterminated");
    expect(toks[0].kind).toBe("string");
    expect(toks[0].text.startsWith("'")).toBe(true);
  });

  it("does not crash on an unterminated dollar-quoted string", () => {
    const toks = tokenize("$tag$ body");
    expect(toks[0].kind).toBe("string");
  });

  it("recognises a leading dot as punct, not part of a number", () => {
    expect(labels(tokenize("a.b"))).toEqual(["ident:a", "punct:.", "ident:b"]);
  });

  it("emits eof at the end (last token kind 'eof' has empty text)", () => {
    const toks = tokenize("a");
    expect(toks[toks.length - 1].kind).toBe("eof");
    expect(toks[toks.length - 1].text).toBe("");
  });
});

describe("analyzeScope — table-driven", () => {
  type Fixture = {
    name: string;
    /** Use `|` to mark the cursor; helper splits on it. */
    sql: string;
    expect: Partial<{
      ctes: Array<{ name: string; columns?: string[] }>;
      fromAliases: Array<{
        alias: string;
        relation?: { schema?: string; name: string };
        columns?: string[];
      }>;
      clause: string;
      trigger: { kind: string; alias?: string; schema?: string; partial?: string };
      prefix: string;
    }>;
  };

  const fixtures: Fixture[] = [
    {
      name: "empty buffer",
      sql: "|",
      expect: { clause: "unknown", trigger: { kind: "ctrl-space" }, prefix: "" },
    },
    {
      name: "after SELECT",
      sql: "SELECT |",
      expect: { clause: "select-list", trigger: { kind: "ctrl-space" } },
    },
    {
      name: "after FROM with alias",
      sql: "SELECT * FROM users u WHERE u.|",
      expect: {
        clause: "where",
        fromAliases: [{ alias: "u", relation: { name: "users" } }],
        trigger: { kind: "alias-dot", alias: "u" },
      },
    },
    {
      name: "WITH CTE single",
      sql: "WITH x AS (SELECT id, name FROM users) SELECT x.|",
      expect: {
        ctes: [{ name: "x", columns: ["id", "name"] }],
        clause: "select-list",
        trigger: { kind: "alias-dot", alias: "x" },
      },
    },
    {
      name: "WITH CTE multiple",
      sql: "WITH a AS (SELECT 1 AS x), b AS (SELECT 2 AS y) SELECT |",
      expect: {
        ctes: [
          { name: "a", columns: ["x"] },
          { name: "b", columns: ["y"] },
        ],
        clause: "select-list",
      },
    },
    {
      name: "subquery with alias",
      sql: "SELECT * FROM (SELECT id, name FROM users) sub WHERE sub.|",
      expect: {
        clause: "where",
        fromAliases: [{ alias: "sub", columns: ["id", "name"] }],
        trigger: { kind: "alias-dot", alias: "sub" },
      },
    },
    {
      name: "LATERAL with alias",
      sql: "SELECT * FROM t1, LATERAL (SELECT max(t1.x) AS m FROM t2) lt WHERE lt.|",
      expect: {
        clause: "where",
        trigger: { kind: "alias-dot", alias: "lt" },
      },
    },
    {
      name: "schema-qualified FROM",
      sql: "SELECT * FROM app.orders o WHERE |",
      expect: {
        clause: "where",
        fromAliases: [{ alias: "o", relation: { schema: "app", name: "orders" } }],
      },
    },
    {
      name: "Cyrillic quoted identifier alias-dot",
      sql: 'SELECT * FROM "Заказы" WHERE "Заказы"."|',
      expect: {
        clause: "where",
        trigger: { kind: "quote", partial: "" },
      },
    },
    {
      name: "partial identifier prefix",
      sql: "SELECT * FROM users u WHERE u.em|",
      expect: { clause: "where", trigger: { kind: "letter" }, prefix: "em" },
    },
    {
      name: "INSERT clause",
      sql: "INSERT INTO users (name) VALUES (|",
      expect: { clause: "values" },
    },
    {
      name: "UPDATE SET",
      sql: "UPDATE users SET |",
      expect: { clause: "set" },
    },
    {
      name: "GROUP BY clause",
      sql: "SELECT count(*) FROM t GROUP BY |",
      expect: { clause: "group-by" },
    },
    {
      name: "ORDER BY clause",
      sql: "SELECT * FROM t ORDER BY |",
      expect: { clause: "order-by" },
    },
    {
      name: "HAVING clause",
      sql: "SELECT count(*) FROM t GROUP BY a HAVING |",
      expect: { clause: "having" },
    },
    {
      name: "JOIN ON clause keeps FROM aliases",
      sql: "SELECT * FROM a JOIN b ON a.id = b.|",
      expect: {
        trigger: { kind: "alias-dot", alias: "b" },
        fromAliases: [
          { alias: "a", relation: { name: "a" } },
          { alias: "b", relation: { name: "b" } },
        ],
      },
    },
    {
      name: "unterminated paren still produces inner scope",
      sql: "SELECT * FROM (SELECT id FROM t) sub WHERE sub.|",
      expect: { clause: "where", trigger: { kind: "alias-dot", alias: "sub" } },
    },
    {
      name: "nested CTE inside CTE",
      sql: "WITH outer AS (WITH inner AS (SELECT 1 AS i) SELECT i FROM inner) SELECT |",
      expect: { clause: "select-list" },
    },
    {
      name: "comments inside SQL ignored",
      sql: "SELECT /* foo */ * -- bar\nFROM users u WHERE u.|",
      expect: {
        trigger: { kind: "alias-dot", alias: "u" },
        fromAliases: [{ alias: "u" }],
      },
    },
    {
      name: "dollar-quoted body skipped",
      sql: "SELECT $$body$$ FROM t WHERE |",
      expect: { clause: "where" },
    },
  ];

  for (const fx of fixtures) {
    it(fx.name, () => {
      const cursor = fx.sql.indexOf("|");
      const prefix = fx.sql.slice(0, cursor);
      const scope = analyzeScope(prefix);
      if (fx.expect.clause) expect(scope.clause).toBe(fx.expect.clause);
      if (fx.expect.trigger) expect(scope.trigger).toMatchObject(fx.expect.trigger);
      if (fx.expect.prefix !== undefined) expect(scope.prefix).toBe(fx.expect.prefix);
      if (fx.expect.ctes) {
        expect(scope.ctes.map((c) => ({ name: c.name, columns: c.columns }))).toEqual(
          fx.expect.ctes,
        );
      }
      if (fx.expect.fromAliases) {
        const got = scope.fromAliases.map((a) => ({
          alias: a.alias,
          relation: a.relation,
          columns: a.columns,
        }));
        for (let i = 0; i < fx.expect.fromAliases.length; i++) {
          expect(got[i]).toMatchObject(fx.expect.fromAliases[i]);
        }
      }
    });
  }
});

describe("S16 jsonb-path Trigger detection", () => {
  it("detects top-level jsonb path: data->>'<partial>", () => {
    const scope = analyzeScope("SELECT data->>'us FROM events");
    expect(scope.trigger.kind).toBe("jsonb-path");
    if (scope.trigger.kind !== "jsonb-path") return;
    expect(scope.trigger.alias).toBeNull();
    expect(scope.trigger.column).toBe("data");
    expect(scope.trigger.path).toEqual([]);
    expect(scope.trigger.partial).toBe("us");
  });

  it("detects nested path: data->'preferences'->>'<partial>", () => {
    const scope = analyzeScope("SELECT data->'preferences'->>'th FROM events");
    expect(scope.trigger.kind).toBe("jsonb-path");
    if (scope.trigger.kind !== "jsonb-path") return;
    expect(scope.trigger.column).toBe("data");
    expect(scope.trigger.path).toEqual([{ key: "preferences" }]);
    expect(scope.trigger.partial).toBe("th");
  });

  it("detects array index: data->'items'->0->>'<partial>", () => {
    const scope = analyzeScope("SELECT data->'items'->0->>'pri FROM events");
    expect(scope.trigger.kind).toBe("jsonb-path");
    if (scope.trigger.kind !== "jsonb-path") return;
    expect(scope.trigger.path).toEqual([{ key: "items" }, { arrayIndex: 0 }]);
  });

  it("detects alias-prefixed: e.data->>'<partial>", () => {
    const scope = analyzeScope("SELECT e.data->>'us FROM events e");
    expect(scope.trigger.kind).toBe("jsonb-path");
    if (scope.trigger.kind !== "jsonb-path") return;
    expect(scope.trigger.alias).toBe("e");
    expect(scope.trigger.column).toBe("data");
  });

  it("detects single-arrow ->'partial (returns jsonb sub-object)", () => {
    const scope = analyzeScope("SELECT data->'<partial>");
    // Without text after the partial, regex still matches.
    // The detection should fire on either ->' or ->>'.
    expect(scope.trigger.kind).toBe("jsonb-path");
  });

  it("does NOT trigger jsonb-path inside a plain string literal", () => {
    // No `->` before the quote — just an opening quote in a normal SELECT.
    const scope = analyzeScope("SELECT 'us FROM events");
    expect(scope.trigger.kind).not.toBe("jsonb-path");
  });

  it("does NOT trigger jsonb-path on alias-dot (no chain)", () => {
    const scope = analyzeScope("SELECT u.");
    expect(scope.trigger.kind).toBe("alias-dot");
  });

  it("nested deep path: data->'a'->'b'->'c'->>'pa", () => {
    const scope = analyzeScope("SELECT data->'a'->'b'->'c'->>'pa FROM t");
    expect(scope.trigger.kind).toBe("jsonb-path");
    if (scope.trigger.kind !== "jsonb-path") return;
    expect(scope.trigger.path).toEqual([{ key: "a" }, { key: "b" }, { key: "c" }]);
    expect(scope.trigger.partial).toBe("pa");
  });

  it("identPrefix equals the partial for jsonb-path", () => {
    const scope = analyzeScope("SELECT data->>'us FROM events");
    expect(scope.prefix).toBe("us");
  });
});
