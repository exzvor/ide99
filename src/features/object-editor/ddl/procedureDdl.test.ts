// — tests for generateProcedureDdl.

import { describe, expect, test } from "vitest";
import { generateProcedureDdl } from "./procedureDdl";
import type { FunctionParameter, ProcedureForm } from "./types";

const baseProc = (over: Partial<ProcedureForm> = {}): ProcedureForm => ({
  schema: "public",
  name: "my_proc",
  language: "plpgsql",
  parameters: [],
  body: "BEGIN END;",
  securityDefiner: false,
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

describe("generateProcedureDdl", () => {
  test("minimal create", () => {
    const proc = baseProc({
      name: "do_thing",
      parameters: [param({ id: "p1", name: "x", type: "integer" })],
      body: "BEGIN PERFORM x; END;",
    });
    const result = generateProcedureDdl(null, proc);
    expect(result.errors).toEqual([]);
    expect(result.sql).toBe(
      "CREATE OR REPLACE PROCEDURE public.do_thing(\n    x IN integer\n) AS $procedure$\nBEGIN PERFORM x; END;\n$procedure$ LANGUAGE plpgsql;",
    );
  });

  test("body change → CREATE OR REPLACE (single statement)", () => {
    const initial = baseProc({
      name: "p",
      parameters: [param({ id: "p1", name: "a", type: "integer" })],
      body: "BEGIN PERFORM a; END;",
    });
    const current = baseProc({
      ...initial,
      body: "BEGIN PERFORM a + 1; END;",
    });
    const result = generateProcedureDdl(initial, current);
    expect(result.warnings).toEqual([]);
    expect(result.sql.startsWith("CREATE OR REPLACE PROCEDURE public.p(")).toBe(true);
    expect(result.sql.includes("BEGIN PERFORM a + 1; END;")).toBe(true);
    expect(result.sql.startsWith("DROP")).toBe(false);
  });

  test("signature change → DROP + CREATE + warning", () => {
    const initial = baseProc({
      name: "p",
      parameters: [param({ id: "p1", name: "a", type: "integer" })],
      body: "BEGIN END;",
    });
    const current = baseProc({
      name: "p",
      parameters: [
        param({ id: "p1", name: "a", type: "integer" }),
        param({ id: "p2", name: "b", type: "text" }),
      ],
      body: "BEGIN END;",
    });
    const result = generateProcedureDdl(initial, current);
    const codes = result.warnings.map((w) => w.code);
    expect(codes).toContain("procedure_signature_changed");
    expect(result.sql.startsWith("DROP PROCEDURE public.p(integer);\n")).toBe(true);
    expect(result.sql.includes("CREATE OR REPLACE PROCEDURE public.p(")).toBe(true);
  });
});
