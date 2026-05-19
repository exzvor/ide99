/**
 * — Pure unit tests for the TS SQL generator mirror.
 *
 * Mirrors the Rust `sql_gen::tests` to ensure the TS and Rust outputs match.
 */

import { describe, expect, it } from "vitest";
import type { BuilderRequest, PathSegment } from "../../../lib/tauri";
import type { BuilderValue } from "./sqlGenerator";
import { generateLocalPreview } from "./sqlGenerator";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function fqn() {
  return { schema: "public", table: "events", column: "data" };
}

// Local op type used in tests — mirrors BuilderOp shape
type TestOp =
  | { kind: "existence" }
  | { kind: "containment" }
  | {
      kind: "pathExtract";
      mode: { kind: "projection" } | { kind: "comparison"; eqValue: BuilderValue };
    }
  | {
      kind: "pathPredicate";
      comparator: import("../../../lib/tauri").Comparator;
      rhs: BuilderValue;
    };

function req(op: TestOp, path: PathSegment[], value: BuilderValue): BuilderRequest {
  return {
    connId: "c1",
    fqn: fqn(),
    op: op as BuilderRequest["op"],
    path,
    value: value as BuilderRequest["value"],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Existence
// ─────────────────────────────────────────────────────────────────────────────

describe("existence operator", () => {
  it("empty path uses string value", () => {
    const r = req({ kind: "existence" }, [], { kind: "string", value: "mykey" });
    const p = generateLocalPreview(r);
    expect(p).not.toBeNull();
    expect(p?.sql).toContain("? 'mykey'");
    expect(p?.warnings).toHaveLength(0);
  });

  it("single key segment warns about top-level", () => {
    const r = req({ kind: "existence" }, [{ key: "user" }], { kind: "none" });
    const p = generateLocalPreview(r);
    expect(p).not.toBeNull();
    expect(p?.sql).toContain("? 'user'");
    expect(p?.warnings.some((w) => w.kind === "existenceTopLevel")).toBe(true);
  });

  it("deep path (3 levels) uses last key + warns", () => {
    const r = req({ kind: "existence" }, [{ key: "a" }, { key: "b" }, { key: "c" }], {
      kind: "none",
    });
    const p = generateLocalPreview(r);
    expect(p).not.toBeNull();
    expect(p?.sql).toContain("? 'c'");
    expect(p?.warnings.some((w) => w.kind === "existenceTopLevel")).toBe(true);
  });

  it("empty path + none value yields empty key (? '')", () => {
    const r = req({ kind: "existence" }, [], { kind: "none" });
    const p = generateLocalPreview(r);
    expect(p).not.toBeNull();
    expect(p?.sql).toContain("?");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Containment
// ─────────────────────────────────────────────────────────────────────────────

describe("containment operator", () => {
  it("empty path + string value", () => {
    const r = req({ kind: "containment" }, [], { kind: "string", value: "alice" });
    const p = generateLocalPreview(r);
    expect(p).not.toBeNull();
    expect(p?.sql).toContain(`@> '"alice"'::jsonb`);
  });

  it("single key wraps in object", () => {
    const r = req({ kind: "containment" }, [{ key: "user" }], { kind: "string", value: "alice" });
    const p = generateLocalPreview(r);
    expect(p).not.toBeNull();
    expect(p?.sql).toContain(`@> '{"user": "alice"}'::jsonb`);
  });

  it("three level nested", () => {
    const r = req({ kind: "containment" }, [{ key: "a" }, { key: "b" }, { key: "c" }], {
      kind: "number",
      value: "42",
    });
    const p = generateLocalPreview(r);
    expect(p).not.toBeNull();
    expect(p?.sql).toContain(`@> '{"a": {"b": {"c": 42}}}'::jsonb`);
  });

  it("none value uses null", () => {
    const r = req({ kind: "containment" }, [], { kind: "none" });
    const p = generateLocalPreview(r);
    expect(p).not.toBeNull();
    expect(p?.sql).toContain("@> 'null'::jsonb");
  });

  it("null value", () => {
    const r = req({ kind: "containment" }, [], { kind: "null" });
    const p = generateLocalPreview(r);
    expect(p).not.toBeNull();
    expect(p?.sql).toContain("@> 'null'::jsonb");
  });

  it("bool true", () => {
    const r = req({ kind: "containment" }, [], { kind: "bool", value: true });
    const p = generateLocalPreview(r);
    expect(p).not.toBeNull();
    expect(p?.sql).toContain("@> 'true'::jsonb");
  });

  it("bool false", () => {
    const r = req({ kind: "containment" }, [], { kind: "bool", value: false });
    const p = generateLocalPreview(r);
    expect(p).not.toBeNull();
    expect(p?.sql).toContain("@> 'false'::jsonb");
  });

  it("valid json literal", () => {
    const r = req({ kind: "containment" }, [], { kind: "jsonLiteral", value: '{"x":1}' });
    const p = generateLocalPreview(r);
    expect(p).not.toBeNull();
    expect(p?.sql).toContain("@>");
    expect(p?.sql).toContain("::jsonb");
  });

  it("invalid json literal returns null", () => {
    const r = req({ kind: "containment" }, [], { kind: "jsonLiteral", value: "not json" });
    const p = generateLocalPreview(r);
    expect(p).toBeNull();
  });

  it("invalid number returns null", () => {
    const r = req({ kind: "containment" }, [], { kind: "number", value: "abc" });
    const p = generateLocalPreview(r);
    expect(p).toBeNull();
  });

  it("array wildcard wraps in array", () => {
    const r = req({ kind: "containment" }, [{ key: "tags" }, "arraywildcard"], {
      kind: "string",
      value: "rust",
    });
    const p = generateLocalPreview(r);
    expect(p).not.toBeNull();
    expect(p?.sql).toContain(`@> '{"tags": ["rust"]}'::jsonb`);
  });

  it("single quote in string value is escaped", () => {
    const r = req({ kind: "containment" }, [], { kind: "string", value: "O'Reilly" });
    const p = generateLocalPreview(r);
    expect(p).not.toBeNull();
    expect(p?.sql).toContain("O''Reilly");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PathExtract — Projection
// ─────────────────────────────────────────────────────────────────────────────

describe("pathExtract — projection", () => {
  it("empty path", () => {
    const r = req({ kind: "pathExtract", mode: { kind: "projection" } }, [], { kind: "none" });
    const p = generateLocalPreview(r);
    expect(p).not.toBeNull();
    expect(p?.sql).toContain("#>'{}'");
    expect(p?.sql).toContain("AS extracted");
  });

  it("single segment", () => {
    const r = req({ kind: "pathExtract", mode: { kind: "projection" } }, [{ key: "user" }], {
      kind: "none",
    });
    const p = generateLocalPreview(r);
    expect(p).not.toBeNull();
    expect(p?.sql).toContain("#>'{user}'");
  });

  it("three segments", () => {
    const r = req(
      { kind: "pathExtract", mode: { kind: "projection" } },
      [{ key: "a" }, { key: "b" }, { key: "c" }],
      { kind: "none" },
    );
    const p = generateLocalPreview(r);
    expect(p).not.toBeNull();
    expect(p?.sql).toContain("#>'{a,b,c}'");
  });

  it("array wildcard in path", () => {
    const r = req(
      { kind: "pathExtract", mode: { kind: "projection" } },
      [{ key: "tags" }, "arraywildcard"],
      { kind: "none" },
    );
    const p = generateLocalPreview(r);
    expect(p).not.toBeNull();
    expect(p?.sql).toContain("#>'{tags,*}'");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PathExtract — Comparison
// ─────────────────────────────────────────────────────────────────────────────

describe("pathExtract — comparison", () => {
  it("single segment with string value", () => {
    const r = req(
      {
        kind: "pathExtract",
        mode: { kind: "comparison", eqValue: { kind: "string", value: "hello" } },
      },
      [{ key: "name" }],
      { kind: "none" },
    );
    const p = generateLocalPreview(r);
    expect(p).not.toBeNull();
    expect(p?.sql).toContain("#>'{name}' =");
    expect(p?.sql).toContain("::jsonb");
    expect(p?.sql).toContain("WHERE");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PathPredicate
// ─────────────────────────────────────────────────────────────────────────────

describe("pathPredicate operator", () => {
  it("eq with empty path", () => {
    const r = req(
      { kind: "pathPredicate", comparator: "eq", rhs: { kind: "number", value: "5" } },
      [],
      { kind: "none" },
    );
    const p = generateLocalPreview(r);
    expect(p).not.toBeNull();
    expect(p?.sql).toContain("@?");
    expect(p?.sql).toContain("==");
  });

  it("all comparators produce correct symbols", () => {
    const cases: Array<[import("../../../lib/tauri").Comparator, string]> = [
      ["eq", "=="],
      ["ne", "!="],
      ["gt", ">"],
      ["lt", "<"],
      ["ge", ">="],
      ["le", "<="],
      ["likeRegex", "like_regex"],
    ];
    for (const [cmp, symbol] of cases) {
      const r = req(
        { kind: "pathPredicate", comparator: cmp, rhs: { kind: "number", value: "1" } },
        [{ key: "x" }],
        { kind: "none" },
      );
      const p = generateLocalPreview(r);
      expect(p).not.toBeNull();
      expect(p?.sql).toContain(symbol);
    }
  });

  it("three level path", () => {
    const r = req(
      {
        kind: "pathPredicate",
        comparator: "eq",
        rhs: { kind: "string", value: "weekly" },
      },
      [{ key: "user" }, { key: "prefs" }, { key: "notif" }],
      { kind: "none" },
    );
    const p = generateLocalPreview(r);
    expect(p).not.toBeNull();
    expect(p?.sql).toContain("@?");
    expect(p?.sql).toContain('"user"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Depth limit
// ─────────────────────────────────────────────────────────────────────────────

describe("depth limit", () => {
  it("depth 17 returns null", () => {
    const path: PathSegment[] = Array.from({ length: 17 }, (_, i) => ({ key: String(i) }));
    const r = req({ kind: "containment" }, path, { kind: "null" });
    expect(generateLocalPreview(r)).toBeNull();
  });

  it("depth 16 returns warning but not null", () => {
    const path: PathSegment[] = Array.from({ length: 16 }, (_, i) => ({ key: String(i) }));
    const r = req({ kind: "containment" }, path, { kind: "null" });
    const p = generateLocalPreview(r);
    expect(p).not.toBeNull();
    expect(p?.warnings.some((w) => w.kind === "pathTooDeep")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// encodePathArray equivalents
// ─────────────────────────────────────────────────────────────────────────────

describe("encodePathArray via pathExtract", () => {
  it("empty → {}", () => {
    const r = req({ kind: "pathExtract", mode: { kind: "projection" } }, [], { kind: "none" });
    const p = generateLocalPreview(r);
    expect(p?.sql).toContain("#>'{}'");
  });

  it("single → {a}", () => {
    const r = req({ kind: "pathExtract", mode: { kind: "projection" } }, [{ key: "a" }], {
      kind: "none",
    });
    const p = generateLocalPreview(r);
    expect(p?.sql).toContain("#>'{a}'");
  });

  it("multi → {a,b,c}", () => {
    const r = req(
      { kind: "pathExtract", mode: { kind: "projection" } },
      [{ key: "a" }, { key: "b" }, { key: "c" }],
      { kind: "none" },
    );
    const p = generateLocalPreview(r);
    expect(p?.sql).toContain("#>'{a,b,c}'");
  });

  it("wildcard → {tags,*}", () => {
    const r = req(
      { kind: "pathExtract", mode: { kind: "projection" } },
      [{ key: "tags" }, "arraywildcard"],
      { kind: "none" },
    );
    const p = generateLocalPreview(r);
    expect(p?.sql).toContain("#>'{tags,*}'");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Identifier quoting
// ─────────────────────────────────────────────────────────────────────────────

describe("identifier quoting", () => {
  it("normal ident is double-quoted", () => {
    const r = req({ kind: "existence" }, [], { kind: "string", value: "k" });
    const p = generateLocalPreview(r);
    expect(p?.sql).toContain('"public"."events"');
    expect(p?.sql).toContain('"data"');
  });

  it("empty schema returns null", () => {
    const r = req({ kind: "existence" }, [], { kind: "string", value: "k" });
    // Override fqn with empty schema
    const withEmptySchema: BuilderRequest = {
      ...r,
      fqn: { schema: "", table: "events", column: "data" },
    };
    expect(generateLocalPreview(withEmptySchema)).toBeNull();
  });
});
