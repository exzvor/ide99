import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { analyzeScope, tokenize } from "./scope";

const sqlIdent = fc.stringMatching(/^[A-Za-z][A-Za-z0-9_]{0,11}$/);
const sqlAtom = fc.oneof(  fc.constant("SELECT * FROM t"),
  fc.constant("WITH x AS (SELECT 1) SELECT * FROM x"),
  fc.constant("INSERT INTO t (a) VALUES (1)"),
  fc.constant("UPDATE t SET a = 1"),
  fc.constant("DELETE FROM t"),
  fc.constant("/* comment */"),
  fc.constant("-- line comment"),
  fc.constant("'plain string'"),
  fc.constant("$$dollar quoted$$"),
  fc.constant("$tag$ tagged $tag$"),
);

const noisyChars = fc.stringMatching(/^[ \t\n,;()."'$@*+=-]{0,40}$/);

describe("analyzeScope — property tests", () => {
  it("never throws for any junk prefix", () => {
    fc.assert(      fc.property(fc.string({ maxLength: 200 }), (s) => {
        expect(() => analyzeScope(s)).not.toThrow();
      }),
      { numRuns: 200 },
);
  });

  it("never throws for atoms concatenated with noise", () => {
    fc.assert(      fc.property(fc.array(fc.oneof(sqlAtom, noisyChars), { maxLength: 8 }), (parts) => {
        const sql = parts.join(" ");
        expect(() => analyzeScope(sql)).not.toThrow();
      }),
      { numRuns: 200 },
);
  });

  it("tokenize returns tokens whose start/end span the input contiguously", () => {
    fc.assert(      fc.property(fc.string({ maxLength: 200 }), (s) => {
        const toks = tokenize(s);
        for (let i = 1; i < toks.length; i++) {
          if (toks[i - 1].end !== toks[i].start) return false;
        }
        return true;
      }),
      { numRuns: 200 },
);
  });

  it("never reports an alias the input does not contain", () => {
    fc.assert(      fc.property(fc.array(sqlIdent, { minLength: 1, maxLength: 4 }), (idents) => {
        const sql = `SELECT * FROM ${idents.join(", ")} WHERE `;
        const scope = analyzeScope(sql);
        for (const a of scope.fromAliases) {
          if (!sql.toLowerCase().includes(a.alias.toLowerCase())) return false;
        }
        return true;
      }),
      { numRuns: 100 },
);
  });

  it("appending one character only changes clause across documented transitions", () => {
    const allowed = new Set([
      "select-list",
      "from",
      "join",
      "where",
      "group-by",
      "order-by",
      "having",
      "set",
      "values",
      "unknown",
    ]);
    fc.assert(      fc.property(        fc.constantFrom("SELECT * ", "SELECT * FROM ", "SELECT * FROM t WHERE "),
        fc.constantFrom("a", " ", ".", "FROM ", "WHERE ", "GROUP "),
        (base, addition) => {
          const before = analyzeScope(base);
          const after = analyzeScope(base + addition);
          if (!allowed.has(after.clause)) return false;
          if (!allowed.has(before.clause)) return false;
          return true;
        },
),
      { numRuns: 80 },
);
  });
});
