import { describe, expect, it } from "vitest";
import type { QueryShape } from "../../../lib/parser";
import { decideShapeApply } from "./applyFromAst";

const flat: QueryShape = {
  baseSelect: { schema: null, table: "u", columns: [] },
  filters: [],
  sort: null,
  limit: null,
  unrepresentableTail: null,
  whereSpan: null,
  orderBySpan: null,
  limitSpan: null,
  fromEnd: 0,
};

describe("decideShapeApply", () => {
  it("returns apply when current is null", () => {
    const d = decideShapeApply(null, flat);
    expect(d.type).toBe("apply");
    expect(d.newShape).toEqual(flat);
  });

  it("returns skip-unrepresentable when parsed has unrepresentableTail", () => {
    const parsed: QueryShape = { ...flat, unrepresentableTail: "non-flat-from" };
    const d = decideShapeApply(flat, parsed);
    expect(d.type).toBe("skip-unrepresentable");
    expect(d.unrepresentable).toBe("non-flat-from");
    expect(d.newShape).toBeUndefined();
  });

  it("returns noop-equal when current and parsed are deeply equal", () => {
    // Use distinct object references but same content to verify deep compare.
    const a: QueryShape = { ...flat, filters: [{ column: "id", op: "eq", value: 1 }] };
    const b: QueryShape = { ...flat, filters: [{ column: "id", op: "eq", value: 1 }] };
    const d = decideShapeApply(a, b);
    expect(d.type).toBe("noop-equal");
  });

  it("returns apply when filters differ", () => {
    const a: QueryShape = { ...flat, filters: [{ column: "id", op: "eq", value: 1 }] };
    const b: QueryShape = { ...flat, filters: [{ column: "id", op: "eq", value: 2 }] };
    const d = decideShapeApply(a, b);
    expect(d.type).toBe("apply");
    expect(d.newShape).toEqual(b);
  });

  it("returns apply when sort differs", () => {
    const a: QueryShape = { ...flat, sort: { column: "id", dir: "asc" } };
    const b: QueryShape = { ...flat, sort: { column: "id", dir: "desc" } };
    expect(decideShapeApply(a, b).type).toBe("apply");
  });

  it("returns apply when limit differs", () => {
    const a: QueryShape = { ...flat, limit: 10 };
    const b: QueryShape = { ...flat, limit: 20 };
    expect(decideShapeApply(a, b).type).toBe("apply");
  });

  it("returns apply when baseSelect.table differs", () => {
    const a: QueryShape = { ...flat, baseSelect: { schema: null, table: "users", columns: [] } };
    const b: QueryShape = { ...flat, baseSelect: { schema: null, table: "orders", columns: [] } };
    expect(decideShapeApply(a, b).type).toBe("apply");
  });

  it("ignores span/fromEnd differences when computing equality", () => {
    // Spans / fromEnd are positional metadata; they should not force a re-apply
    // because the user-visible shape (filters/sort/limit/baseSelect) is identical.
    const a: QueryShape = { ...flat, fromEnd: 19, whereSpan: { start: 1, end: 2 } };
    const b: QueryShape = { ...flat, fromEnd: 27, whereSpan: { start: 5, end: 9 } };
    expect(decideShapeApply(a, b).type).toBe("noop-equal");
  });
});
