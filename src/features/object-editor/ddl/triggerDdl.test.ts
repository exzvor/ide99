// — tests for generateTriggerDdl.

import { describe, expect, test } from "vitest";
import { generateTriggerDdl } from "./triggerDdl";
import type { TriggerForm } from "./types";

const baseTrg = (over: Partial<TriggerForm> = {}): TriggerForm => ({
  schema: "public",
  name: "my_trg",
  table: { schema: "public", name: "users" },
  timing: "before",
  events: { insert: true, update: false, delete: false, truncate: false },
  updateColumns: [],
  forEach: "row",
  whenClause: null,
  functionRef: { schema: "public", name: "fn" },
  enabled: true,
  ...over,
});

describe("generateTriggerDdl — validation", () => {
  test("empty form errors", () => {
    const result = generateTriggerDdl(
      null,
      baseTrg({
        name: "",
        events: { insert: false, update: false, delete: false, truncate: false },
        functionRef: { schema: "public", name: "" },
      }),
    );
    expect(result.sql).toBe("");
    const codes = result.errors.map((e) => e.code);
    expect(codes).toContain("name_required");
    expect(codes).toContain("at_least_one_event");
    expect(codes).toContain("function_required");
  });

  test("WHEN + statement → error", () => {
    const result = generateTriggerDdl(
      null,
      baseTrg({ forEach: "statement", whenClause: "NEW.x > 0" }),
    );
    const codes = result.errors.map((e) => e.code);
    expect(codes).toContain("when_requires_for_each_row");
  });
});

describe("generateTriggerDdl — create mode", () => {
  test("minimal trigger create (BEFORE INSERT, FOR EACH ROW)", () => {
    const result = generateTriggerDdl(null, baseTrg());
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.sql).toBe(
      "CREATE TRIGGER my_trg\n    BEFORE INSERT ON public.users\n    FOR EACH ROW\n    EXECUTE FUNCTION public.fn();",
    );
  });

  test("all 4 events trigger", () => {
    const result = generateTriggerDdl(
      null,
      baseTrg({
        events: { insert: true, update: true, delete: true, truncate: true },
        forEach: "statement",
      }),
    );
    expect(result.errors).toEqual([]);
    expect(result.sql).toBe(
      "CREATE TRIGGER my_trg\n    BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.users\n    FOR EACH STATEMENT\n    EXECUTE FUNCTION public.fn();",
    );
  });

  test("UPDATE OF columns", () => {
    const result = generateTriggerDdl(
      null,
      baseTrg({
        events: { insert: false, update: true, delete: false, truncate: false },
        updateColumns: ["col1", "col2"],
      }),
    );
    expect(result.errors).toEqual([]);
    expect(result.sql.includes("UPDATE OF col1, col2")).toBe(true);
  });

  test("INSTEAD OF emits warning, no error", () => {
    const result = generateTriggerDdl(null, baseTrg({ timing: "instead_of" }));
    expect(result.errors).toEqual([]);
    const codes = result.warnings.map((w) => w.code);
    expect(codes).toContain("instead_of_typically_views");
    expect(result.sql.includes("INSTEAD OF INSERT")).toBe(true);
  });

  test("WHEN clause emitted in CREATE", () => {
    const result = generateTriggerDdl(null, baseTrg({ whenClause: "NEW.x > 0" }));
    expect(result.errors).toEqual([]);
    expect(result.sql.includes("WHEN (NEW.x > 0)")).toBe(true);
  });

  test("disabled trigger appends ALTER TABLE DISABLE TRIGGER", () => {
    const result = generateTriggerDdl(null, baseTrg({ enabled: false }));
    expect(result.errors).toEqual([]);
    expect(result.sql.endsWith("ALTER TABLE public.users DISABLE TRIGGER my_trg;")).toBe(true);
  });
});

describe("generateTriggerDdl — edit mode", () => {
  test("rename only → ALTER TRIGGER RENAME", () => {
    const initial = baseTrg({ name: "old_trg" });
    const current = baseTrg({ name: "new_trg" });
    const result = generateTriggerDdl(initial, current);
    expect(result.warnings).toEqual([]);
    expect(result.sql).toBe("ALTER TRIGGER old_trg ON public.users RENAME TO new_trg;");
  });

  test("enabled toggle only → ALTER TABLE DISABLE TRIGGER", () => {
    const initial = baseTrg({ enabled: true });
    const current = baseTrg({ enabled: false });
    const result = generateTriggerDdl(initial, current);
    expect(result.warnings).toEqual([]);
    expect(result.sql).toBe("ALTER TABLE public.users DISABLE TRIGGER my_trg;");
  });

  test("timing change → DROP + CREATE + warning", () => {
    const initial = baseTrg({ timing: "before" });
    const current = baseTrg({ timing: "after" });
    const result = generateTriggerDdl(initial, current);
    const codes = result.warnings.map((w) => w.code);
    expect(codes).toContain("trigger_recreate");
    expect(result.sql.startsWith("DROP TRIGGER my_trg ON public.users;\n")).toBe(true);
    expect(result.sql.includes("AFTER INSERT ON public.users")).toBe(true);
  });
});
