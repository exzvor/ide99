// — introspect transforms (Definition → *Form) for function /
// procedure / trigger.
//
// Pure structural assertions — UUIDs are validated by shape only since
// `crypto.randomUUID()` makes exact-value freezing pointless.

import { describe, expect, test } from "vitest";
import type {
  FunctionDefinition,
  ProcedureDefinition,
  TriggerDefinition,
} from "../../../lib/tauri";
import { fromDefinition as functionFromDefinition } from "./functionState";
import { fromDefinition as procedureFromDefinition } from "./procedureState";
import { fromDefinition as triggerFromDefinition } from "./triggerState";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// functionState
// ---------------------------------------------------------------------------

describe("functionState.fromDefinition", () => {
  test("simple sql function: schema/name/lang/params/return mapped 1:1", () => {
    const def: FunctionDefinition = {
      schema: "public",
      name: "add",
      language: "sql",
      parameters: [
        { name: "a", mode: "in", typeText: "integer", default: null },
        { name: "b", mode: "in", typeText: "integer", default: null },
      ],
      returnKind: "scalar",
      returnType: "integer",
      body: "SELECT a + b",
      volatility: "immutable",
      parallelSafety: "safe",
      securityDefiner: false,
      cost: null,
      estimatedRows: null,
      comment: null,
    };
    const form = functionFromDefinition(def);
    expect(form.schema).toBe("public");
    expect(form.name).toBe("add");
    expect(form.language).toBe("sql");
    expect(form.languageOther).toBeUndefined();
    expect(form.parameters).toHaveLength(2);
    expect(form.parameters[0]).toMatchObject({
      name: "a",
      mode: "in",
      type: "integer",
      default: null,
    });
    expect(form.parameters[0].id).toMatch(UUID_RE);
    expect(form.parameters[1].id).toMatch(UUID_RE);
    expect(form.parameters[0].id).not.toBe(form.parameters[1].id);
    expect(form.returnKind).toBe("scalar");
    expect(form.returnType).toBe("integer");
    expect(form.body).toBe("SELECT a + b");
    expect(form.volatility).toBe("immutable");
    expect(form.parallelSafety).toBe("safe");
    expect(form.securityDefiner).toBe(false);
  });

  test("plpgsql function with default param keeps the default expression", () => {
    const def: FunctionDefinition = {
      schema: "public",
      name: "greet",
      language: "plpgsql",
      parameters: [{ name: "name", mode: "in", typeText: "text", default: "'world'" }],
      returnKind: "scalar",
      returnType: "text",
      body: "BEGIN RETURN 'hello, ' || name; END;",
      volatility: "volatile",
      parallelSafety: "unsafe",
      securityDefiner: false,
      cost: null,
      estimatedRows: null,
      comment: null,
    };
    const form = functionFromDefinition(def);
    expect(form.language).toBe("plpgsql");
    expect(form.parameters[0].default).toBe("'world'");
    expect(form.body).toContain("BEGIN");
  });

  test("setof function preserves estimatedRows", () => {
    const def: FunctionDefinition = {
      schema: "public",
      name: "list_users",
      language: "sql",
      parameters: [],
      returnKind: "setof",
      returnType: "users",
      body: "SELECT * FROM users",
      volatility: "stable",
      parallelSafety: "safe",
      securityDefiner: false,
      cost: 100,
      estimatedRows: 1000,
      comment: null,
    };
    const form = functionFromDefinition(def);
    expect(form.returnKind).toBe("setof");
    expect(form.estimatedRows).toBe(1000);
    expect(form.cost).toBe(100);
  });

  test("trigger-return function: returnKind=trigger, returnType undefined", () => {
    const def: FunctionDefinition = {
      schema: "public",
      name: "audit_trigger",
      language: "plpgsql",
      parameters: [],
      returnKind: "trigger",
      returnType: null,
      body: "BEGIN RETURN NEW; END;",
      volatility: "volatile",
      parallelSafety: "unsafe",
      securityDefiner: false,
      cost: null,
      estimatedRows: null,
      comment: "row-level audit",
    };
    const form = functionFromDefinition(def);
    expect(form.returnKind).toBe("trigger");
    expect(form.returnType).toBeUndefined();
    expect(form.comment).toBe("row-level audit");
  });

  test("non-sql/plpgsql language collapses to `other` with name preserved", () => {
    const def: FunctionDefinition = {
      schema: "public",
      name: "py_thing",
      language: "plpython3u",
      parameters: [],
      returnKind: "scalar",
      returnType: "text",
      body: "return 'hi'",
      volatility: "volatile",
      parallelSafety: "unsafe",
      securityDefiner: false,
      cost: null,
      estimatedRows: null,
      comment: null,
    };
    const form = functionFromDefinition(def);
    expect(form.language).toBe("other");
    expect(form.languageOther).toBe("plpython3u");
  });
});

// ---------------------------------------------------------------------------
// procedureState
// ---------------------------------------------------------------------------

describe("procedureState.fromDefinition", () => {
  test("simple plpgsql procedure", () => {
    const def: ProcedureDefinition = {
      schema: "public",
      name: "do_work",
      language: "plpgsql",
      parameters: [{ name: "id", mode: "in", typeText: "bigint", default: null }],
      body: "BEGIN PERFORM work(id); END;",
      securityDefiner: false,
      comment: null,
    };
    const form = procedureFromDefinition(def);
    expect(form.schema).toBe("public");
    expect(form.name).toBe("do_work");
    expect(form.language).toBe("plpgsql");
    expect(form.parameters).toHaveLength(1);
    expect(form.parameters[0].id).toMatch(UUID_RE);
    expect(form.parameters[0].mode).toBe("in");
    expect(form.body).toContain("PERFORM");
    expect(form.securityDefiner).toBe(false);
  });

  test("procedure with SECURITY DEFINER preserved", () => {
    const def: ProcedureDefinition = {
      schema: "admin",
      name: "rotate_keys",
      language: "plpgsql",
      parameters: [],
      body: "BEGIN /* ... */ END;",
      securityDefiner: true,
      comment: "elevated",
    };
    const form = procedureFromDefinition(def);
    expect(form.securityDefiner).toBe(true);
    expect(form.comment).toBe("elevated");
  });
});

// ---------------------------------------------------------------------------
// triggerState
// ---------------------------------------------------------------------------

describe("triggerState.fromDefinition", () => {
  test("BEFORE INSERT FOR EACH ROW: timing/events/forEach mapped", () => {
    const def: TriggerDefinition = {
      schema: "public",
      name: "trg_before_insert",
      tableSchema: "public",
      tableName: "users",
      timing: "before",
      events: { insert: true, update: false, delete: false, truncate: false },
      updateColumns: [],
      forEach: "row",
      whenClause: null,
      functionSchema: "public",
      functionName: "audit_trigger",
      enabled: true,
    };
    const form = triggerFromDefinition(def);
    expect(form.schema).toBe("public");
    expect(form.name).toBe("trg_before_insert");
    expect(form.table).toEqual({ schema: "public", name: "users" });
    expect(form.timing).toBe("before");
    expect(form.events.insert).toBe(true);
    expect(form.events.update).toBe(false);
    expect(form.forEach).toBe("row");
    expect(form.whenClause).toBeNull();
    expect(form.functionRef).toEqual({ schema: "public", name: "audit_trigger" });
    expect(form.enabled).toBe(true);
  });

  test("WHEN clause + UPDATE OF columns preserved", () => {
    const def: TriggerDefinition = {
      schema: "public",
      name: "trg_status_change",
      tableSchema: "public",
      tableName: "orders",
      timing: "after",
      events: { insert: false, update: true, delete: false, truncate: false },
      updateColumns: ["status", "total"],
      forEach: "row",
      whenClause: "(NEW.status IS DISTINCT FROM OLD.status)",
      functionSchema: "audit",
      functionName: "log_change",
      enabled: true,
    };
    const form = triggerFromDefinition(def);
    expect(form.events.update).toBe(true);
    expect(form.updateColumns).toEqual(["status", "total"]);
    expect(form.whenClause).toBe("(NEW.status IS DISTINCT FROM OLD.status)");
    expect(form.functionRef.schema).toBe("audit");
  });

  test("disabled state preserved", () => {
    const def: TriggerDefinition = {
      schema: "public",
      name: "trg_disabled",
      tableSchema: "public",
      tableName: "orders",
      timing: "after",
      events: { insert: true, update: false, delete: false, truncate: false },
      updateColumns: [],
      forEach: "statement",
      whenClause: null,
      functionSchema: "public",
      functionName: "noop",
      enabled: false,
    };
    const form = triggerFromDefinition(def);
    expect(form.enabled).toBe(false);
    expect(form.forEach).toBe("statement");
  });
});
