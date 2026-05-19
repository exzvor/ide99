// — tests for generateFunctionDdl.

import { describe, expect, test } from "vitest";
import { generateFunctionDdl } from "./functionDdl";
import type { FunctionForm, FunctionParameter } from "./types";

const baseFn = (over: Partial<FunctionForm> = {}): FunctionForm => ({
  schema: "public",
  name: "my_fn",
  language: "sql",
  parameters: [],
  returnKind: "scalar",
  returnType: "integer",
  body: "SELECT 1",
  volatility: "volatile",
  parallelSafety: "unsafe",
  securityDefiner: false,
  cost: null,
  estimatedRows: null,
  comment: null,
  ...over,
});

const param = (over: Partial<FunctionParameter> = {}): FunctionParameter => ({
  id: over.id ?? "p1",
  name: over.name ?? "a",
  mode: over.mode ?? "in",
  type: over.type ?? "integer",
  default: over.default ?? null,
});

// ────────────────── B2.T1 — create-mode ──────────────────

describe("generateFunctionDdl — create mode", () => {
  test("empty form → validation errors", () => {
    const result = generateFunctionDdl(null, baseFn({ name: "", body: "", returnType: "" }));
    expect(result.sql).toBe("");
    const codes = result.errors.map((e) => e.code).sort();
    expect(codes).toContain("name_required");
    expect(codes).toContain("body_required");
    expect(codes).toContain("return_type_required");
  });

  test("minimal sql function", () => {
    const fn = baseFn({
      name: "add",
      parameters: [
        param({ id: "p1", name: "x", type: "integer" }),
        param({ id: "p2", name: "y", type: "integer" }),
      ],
      returnType: "integer",
      body: "SELECT x + y",
    });
    const result = generateFunctionDdl(null, fn);
    expect(result.errors).toEqual([]);
    expect(result.sql).toBe(
      "CREATE OR REPLACE FUNCTION public.add(\n    x IN integer,\n    y IN integer\n) RETURNS integer AS $function$\nSELECT x + y\n$function$ LANGUAGE sql;",
    );
  });

  test("full plpgsql function with default param + IMMUTABLE + SECURITY DEFINER + COST + ROWS (setof) + comment", () => {
    const fn = baseFn({
      name: "find_users",
      language: "plpgsql",
      parameters: [
        param({ id: "p1", name: "min_age", type: "integer" }),
        param({ id: "p2", name: "country", type: "text", default: "'US'" }),
      ],
      returnKind: "setof",
      returnType: "users",
      body: "BEGIN RETURN QUERY SELECT * FROM users WHERE age >= min_age AND country = country; END;",
      volatility: "immutable",
      securityDefiner: true,
      cost: 50,
      estimatedRows: 100,
      comment: "Bob's user finder",
    });
    const result = generateFunctionDdl(null, fn);
    expect(result.errors).toEqual([]);
    expect(result.sql).toBe(
      `CREATE OR REPLACE FUNCTION public.find_users(\n    min_age IN integer,\n    country IN text DEFAULT 'US'\n) RETURNS SETOF users AS $function$\nBEGIN RETURN QUERY SELECT * FROM users WHERE age >= min_age AND country = country; END;\n$function$ LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER COST 50 ROWS 100;\nCOMMENT ON FUNCTION public.find_users(integer, text) IS 'Bob''s user finder';`,
    );
  });

  test("trigger-returning function", () => {
    const fn = baseFn({
      name: "audit_trg",
      language: "plpgsql",
      parameters: [],
      returnKind: "trigger",
      returnType: undefined,
      body: "BEGIN RETURN NEW; END;",
    });
    const result = generateFunctionDdl(null, fn);
    expect(result.errors).toEqual([]);
    expect(result.sql).toBe(
      "CREATE OR REPLACE FUNCTION public.audit_trg() RETURNS TRIGGER AS $function$\nBEGIN RETURN NEW; END;\n$function$ LANGUAGE plpgsql;",
    );
  });

  test('"other" language emits LANGUAGE plpython3u from languageOther (lowercased)', () => {
    const fn = baseFn({
      name: "py_thing",
      language: "other",
      languageOther: "PLPython3U",
      returnType: "integer",
      body: "return 1",
    });
    const result = generateFunctionDdl(null, fn);
    expect(result.errors).toEqual([]);
    expect(result.sql.endsWith("LANGUAGE plpython3u;")).toBe(true);
  });
});

// ────────────────── B2.T2 — edit-mode + signature ──────────────────

describe("generateFunctionDdl — edit mode", () => {
  test("no diff → empty sql", () => {
    const fn = baseFn({
      name: "f",
      parameters: [param({ id: "p1", name: "a", type: "integer" })],
      body: "SELECT a",
    });
    const result = generateFunctionDdl(fn, { ...fn });
    expect(result.sql).toBe("");
    expect(result.errors).toEqual([]);
  });

  test("rename only → ALTER FUNCTION ... RENAME TO", () => {
    const initial = baseFn({
      name: "old_fn",
      parameters: [param({ id: "p1", name: "a", type: "integer" })],
      body: "SELECT a",
    });
    const current = baseFn({
      ...initial,
      name: "new_fn",
    });
    const result = generateFunctionDdl(initial, current);
    expect(result.sql).toBe("ALTER FUNCTION public.old_fn(integer) RENAME TO new_fn;");
    expect(result.warnings).toEqual([]);
  });

  test("signature change → DROP + CREATE OR REPLACE + warning", () => {
    const initial = baseFn({
      name: "f",
      parameters: [param({ id: "p1", name: "a", type: "integer" })],
      body: "SELECT a",
    });
    const current = baseFn({
      name: "f",
      parameters: [
        param({ id: "p1", name: "a", type: "integer" }),
        param({ id: "p2", name: "b", type: "text" }),
      ],
      body: "SELECT a",
    });
    const result = generateFunctionDdl(initial, current);
    const codes = result.warnings.map((w) => w.code);
    expect(codes).toContain("function_signature_changed");
    expect(result.sql.startsWith("DROP FUNCTION public.f(integer);\n")).toBe(true);
    expect(result.sql.includes("CREATE OR REPLACE FUNCTION public.f(")).toBe(true);
  });
});
