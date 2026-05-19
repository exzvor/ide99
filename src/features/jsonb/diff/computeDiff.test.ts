import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DIFF_OPS_THRESHOLD, computeDiff } from "./computeDiff";

describe("computeDiff — unit matrix", () => {
  it("identical → empty", () => {
    const v = { a: 1, b: "x" };
    const d = computeDiff(v, v);
    expect(d.ops).toHaveLength(0);
    expect(d.fullReplace).toBe(false);
  });

  it("single leaf change → 1 set op", () => {
    const d = computeDiff({ a: 1, b: "x" }, { a: 1, b: "y" });
    expect(d.ops).toHaveLength(1);
    expect(d.ops[0]).toEqual({ kind: "set", path: ["b"], value: "y" });
  });

  it("deep nested path", () => {
    const d = computeDiff({ a: { b: { c: 1 } } }, { a: { b: { c: 2 } } });
    expect(d.ops[0]).toMatchObject({ kind: "set", path: ["a", "b", "c"], value: 2 });
  });

  it("add key → set", () => {
    const d = computeDiff({ a: 1 }, { a: 1, b: 2 });
    expect(d.ops[0]).toMatchObject({ kind: "set", path: ["b"] });
  });

  it("delete key → delete", () => {
    const d = computeDiff({ a: 1, b: 2 }, { a: 1 });
    expect(d.ops[0]).toEqual({ kind: "delete", path: ["b"] });
  });

  it("9 leaves changed → fullReplace", () => {
    const old: Record<string, number> = {};
    const next: Record<string, number> = {};
    for (let i = 0; i < 9; i++) {
      old[`k${i}`] = 0;
      next[`k${i}`] = 1;
    }
    const d = computeDiff(old, next);
    expect(d.fullReplace).toBe(true);
    expect(d.ops).toHaveLength(0);
    expect(d.fullValue).toEqual(next);
  });

  it("root scalar change → fullReplace", () => {
    const d = computeDiff("hello", "world");
    expect(d.fullReplace).toBe(true);
  });

  it("root type change → fullReplace", () => {
    const d = computeDiff({ a: 1 }, [1, 2, 3]);
    expect(d.fullReplace).toBe(true);
  });

  it("array length change → fullReplace", () => {
    const d = computeDiff({ items: [1, 2, 3] }, { items: [1, 2, 3, 4] });
    expect(d.fullReplace).toBe(true);
  });

  it("object reorder same kv → empty", () => {
    const a = JSON.parse('{"a":1,"b":2}');
    const b = JSON.parse('{"b":2,"a":1}');
    const d = computeDiff(a, b);
    expect(d.ops).toHaveLength(0);
    expect(d.fullReplace).toBe(false);
  });

  it("threshold constant matches Rust", () => {
    expect(DIFF_OPS_THRESHOLD).toBe(8);
  });
});

describe("computeDiff — property", () => {
  const arbJson: fc.Arbitrary<unknown> = fc.letrec((tie) => ({
    json: fc.oneof(
      { maxDepth: 4 },
      fc.constant(null),
      fc.boolean(),
      fc.integer({ min: -1000, max: 1000 }),
      fc.string({ maxLength: 8 }),
      fc.array(tie("json"), { maxLength: 4 }),
      fc.dictionary(fc.string({ maxLength: 4 }), tie("json"), { maxKeys: 4 }),
    ),
  })).json as fc.Arbitrary<unknown>;

  function clone<T>(v: T): T {
    return JSON.parse(JSON.stringify(v));
  }
  function setPath(cur: unknown, path: ReadonlyArray<string>, value: unknown): unknown {
    if (path.length === 0) return value;
    const [head, ...tail] = path;
    if (head === undefined) return value;
    if (Array.isArray(cur)) {
      const idx = Number(head);
      const next = cur.slice();
      next[idx] = setPath(cur[idx], tail, value);
      return next;
    }
    if (cur !== null && typeof cur === "object") {
      const next = { ...(cur as Record<string, unknown>) };
      next[head] = setPath(next[head], tail, value);
      return next;
    }
    return value;
  }
  function delPath(cur: unknown, path: ReadonlyArray<string>): unknown {
    if (path.length === 0) return cur;
    if (path.length === 1) {
      if (cur !== null && typeof cur === "object" && !Array.isArray(cur)) {
        const next = { ...(cur as Record<string, unknown>) };
        delete next[path[0] as string];
        return next;
      }
      return cur;
    }
    const [head, ...tail] = path;
    if (head === undefined) return cur;
    // Recurse through arrays too — a delete path can pass through an
    // array index on its way to the leaf object key (counterexample
    // surfaced by fast-check seed -1075439904 on Linux CI).
    if (Array.isArray(cur)) {
      const idx = Number(head);
      const next = cur.slice();
      next[idx] = delPath(cur[idx], tail);
      return next;
    }
    if (cur !== null && typeof cur === "object") {
      const next = { ...(cur as Record<string, unknown>) };
      next[head] = delPath(next[head], tail);
      return next;
    }
    return cur;
  }
  function applyDiff(old: unknown, diff: ReturnType<typeof computeDiff>): unknown {
    if (diff.fullReplace) return diff.fullValue;
    let cur = clone(old);
    for (const op of diff.ops) {
      if (op.kind === "set") cur = setPath(cur, op.path, op.value);
      else cur = delPath(cur, op.path);
    }
    return cur;
  }

  it("round-trip", () => {
    fc.assert(
      fc.property(arbJson, arbJson, (a, b) => {
        const d = computeDiff(a, b);
        const applied = applyDiff(a, d);
        expect(applied).toEqual(b);
      }),
      { numRuns: 200 },
    );
  });

  it("identical → empty", () => {
    fc.assert(
      fc.property(arbJson, (v) => {
        const d = computeDiff(v, v);
        expect(d.fullReplace).toBe(false);
        expect(d.ops).toHaveLength(0);
      }),
      { numRuns: 200 },
    );
  });
});
