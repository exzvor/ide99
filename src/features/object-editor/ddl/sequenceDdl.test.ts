import { describe, expect, test } from "vitest";
import { generateSequenceDdl } from "./sequenceDdl";
import type { SequenceForm } from "./types";

const baseSeq = (over: Partial<SequenceForm> = {}): SequenceForm => ({
  schema: "public",
  name: "my_seq",
  dataType: "bigint",
  start: null,
  increment: 1,
  minValue: null,
  maxValue: null,
  cache: 1,
  cycle: false,
  ownedBy: null,
  ...over,
});

describe("generateSequenceDdl — create mode", () => {
  test("all defaults → minimal CREATE", () => {
    const result = generateSequenceDdl(null, baseSeq());
    expect(result.errors).toEqual([]);
    expect(result.sql).toBe("CREATE SEQUENCE public.my_seq AS bigint;");
  });

  test("non-default options emitted; defaults hidden", () => {
    const seq = baseSeq({
      dataType: "integer",
      start: 100,
      increment: 5,
      cache: 50,
      cycle: true,
      ownedBy: { schema: "public", table: "items", column: "id" },
    });
    const result = generateSequenceDdl(null, seq);
    expect(result.sql).toBe(
      "CREATE SEQUENCE public.my_seq AS integer START 100 INCREMENT 5 CACHE 50 CYCLE OWNED BY public.items.id;",
    );
  });

  test("MINVALUE non-default emitted (≠ 1)", () => {
    const result = generateSequenceDdl(null, baseSeq({ minValue: 10 }));
    expect(result.sql).toBe("CREATE SEQUENCE public.my_seq AS bigint MINVALUE 10;");
  });
});

describe("generateSequenceDdl — edit mode", () => {
  test("rename only", () => {
    const initial = baseSeq({ name: "old_seq" });
    const current = baseSeq({ name: "new_seq" });
    const result = generateSequenceDdl(initial, current);
    expect(result.sql).toBe("ALTER SEQUENCE public.old_seq RENAME TO new_seq;");
  });

  test("multiple ALTER chunks per changed field", () => {
    const initial = baseSeq({ increment: 1, cache: 1, cycle: false });
    const current = baseSeq({ increment: 5, cache: 50, cycle: true });
    const result = generateSequenceDdl(initial, current);
    const lines = result.sql.split("\n");
    expect(lines).toContain("ALTER SEQUENCE public.my_seq INCREMENT 5;");
    expect(lines).toContain("ALTER SEQUENCE public.my_seq CACHE 50;");
    expect(lines).toContain("ALTER SEQUENCE public.my_seq CYCLE;");
  });

  test("toggle cycle off → NO CYCLE", () => {
    const initial = baseSeq({ cycle: true });
    const current = baseSeq({ cycle: false });
    const result = generateSequenceDdl(initial, current);
    expect(result.sql).toBe("ALTER SEQUENCE public.my_seq NO CYCLE;");
  });
});
