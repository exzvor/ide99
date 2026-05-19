// — CustomTypeDefinitionDto → discriminated CustomTypeFormUnion tests.
//
// Two tests per sub-type (8 total): minimal payload + full payload.

import { describe, expect, it } from "vitest";
import type { CustomTypeDefinitionDto } from "../../../lib/tauri";
import { fromDefinition } from "./typeState";

describe("typeState.fromDefinition — enum", () => {
  it("maps a minimal enum with no values", () => {
    const def: CustomTypeDefinitionDto = {
      kind: "enum",
      schema: "public",
      name: "color",
      values: [],
    };
    const r = fromDefinition(def);
    expect(r.kind).toBe("enum");
    if (r.kind !== "enum") return;
    expect(r.form.schema).toBe("public");
    expect(r.form.name).toBe("color");
    expect(r.form.values).toEqual([]);
    expect(r.form.comment).toBeNull();
  });

  it("stamps unique ids onto enum values and preserves comment", () => {
    const def: CustomTypeDefinitionDto = {
      kind: "enum",
      schema: "audit",
      name: "verdict",
      values: ["pass", "warn", "fail"],
      comment: "decision outcome",
    };
    const r = fromDefinition(def);
    if (r.kind !== "enum") throw new Error("expected enum");
    expect(r.form.values).toHaveLength(3);
    expect(r.form.values[0].value).toBe("pass");
    expect(r.form.values[1].value).toBe("warn");
    expect(r.form.values[2].value).toBe("fail");
    const ids = new Set(r.form.values.map((v) => v.id));
    expect(ids.size).toBe(3);
    expect(r.form.comment).toBe("decision outcome");
  });
});

describe("typeState.fromDefinition — composite", () => {
  it("maps a minimal composite with no fields", () => {
    const def: CustomTypeDefinitionDto = {
      kind: "composite",
      schema: "public",
      name: "addr",
      fields: [],
    };
    const r = fromDefinition(def);
    expect(r.kind).toBe("composite");
    if (r.kind !== "composite") return;
    expect(r.form.fields).toEqual([]);
    expect(r.form.comment).toBeNull();
  });

  it("renames `name` → `fieldName`, normalizes collation, stamps ids", () => {
    const def: CustomTypeDefinitionDto = {
      kind: "composite",
      schema: "public",
      name: "addr",
      fields: [
        { name: "city", typeText: "text", collation: '"C"' },
        { name: "zip", typeText: "text", collation: null },
      ],
      comment: "postal",
    };
    const r = fromDefinition(def);
    if (r.kind !== "composite") throw new Error("expected composite");
    expect(r.form.fields).toHaveLength(2);
    expect(r.form.fields[0].fieldName).toBe("city");
    expect(r.form.fields[0].typeText).toBe("text");
    expect(r.form.fields[0].collation).toBe('"C"');
    expect(r.form.fields[1].collation).toBeUndefined();
    expect(r.form.fields[0].id).not.toBe(r.form.fields[1].id);
    expect(r.form.comment).toBe("postal");
  });
});

describe("typeState.fromDefinition — domain", () => {
  it("maps a minimal domain with no constraints", () => {
    const def: CustomTypeDefinitionDto = {
      kind: "domain",
      schema: "public",
      name: "positive_int",
      baseType: "integer",
      notNull: false,
      constraints: [],
    };
    const r = fromDefinition(def);
    expect(r.kind).toBe("domain");
    if (r.kind !== "domain") return;
    expect(r.form.baseType).toBe("integer");
    expect(r.form.notNull).toBe(false);
    expect(r.form.default).toBeUndefined();
    expect(r.form.collation).toBeUndefined();
    expect(r.form.constraints).toEqual([]);
    expect(r.form.comment).toBeNull();
  });

  it("preserves default/collation, maps constraints with isNew=false", () => {
    const def: CustomTypeDefinitionDto = {
      kind: "domain",
      schema: "public",
      name: "positive_int",
      baseType: "integer",
      notNull: true,
      default: "0",
      collation: '"C"',
      constraints: [
        { name: "must_be_positive", check: "VALUE > 0", notValid: false },
        { name: null, check: "VALUE < 1000000", notValid: true },
      ],
      comment: "non-negative integer",
    };
    const r = fromDefinition(def);
    if (r.kind !== "domain") throw new Error("expected domain");
    expect(r.form.notNull).toBe(true);
    expect(r.form.default).toBe("0");
    expect(r.form.collation).toBe('"C"');
    expect(r.form.constraints).toHaveLength(2);
    expect(r.form.constraints[0].constraintName).toBe("must_be_positive");
    expect(r.form.constraints[0].checkExpression).toBe("VALUE > 0");
    expect(r.form.constraints[0].notValid).toBe(false);
    expect(r.form.constraints[0].isNew).toBe(false);
    expect(r.form.constraints[1].constraintName).toBeUndefined();
    expect(r.form.constraints[1].notValid).toBe(true);
    expect(r.form.constraints[0].id).not.toBe(r.form.constraints[1].id);
    expect(r.form.comment).toBe("non-negative integer");
  });
});

describe("typeState.fromDefinition — range", () => {
  it("maps a minimal range with subtype only", () => {
    const def: CustomTypeDefinitionDto = {
      kind: "range",
      schema: "public",
      name: "int4_range_local",
      subtype: "int4",
    };
    const r = fromDefinition(def);
    expect(r.kind).toBe("range");
    if (r.kind !== "range") return;
    expect(r.form.subtype).toBe("int4");
    expect(r.form.subtypeOpclass).toBeUndefined();
    expect(r.form.collation).toBeUndefined();
    expect(r.form.canonical).toBeUndefined();
    expect(r.form.subtypeDiff).toBeUndefined();
    expect(r.form.multirangeTypeName).toBeUndefined();
    expect(r.form.comment).toBeNull();
  });

  it("preserves every optional auxiliary function and multirange name", () => {
    const def: CustomTypeDefinitionDto = {
      kind: "range",
      schema: "public",
      name: "ts_range",
      subtype: "timestamp",
      subtypeOpclass: "timestamp_ops",
      collation: '"C"',
      canonical: "ts_canonical",
      subtypeDiff: "ts_diff",
      multirangeTypeName: "ts_multirange",
      comment: "typed timestamp range",
    };
    const r = fromDefinition(def);
    if (r.kind !== "range") throw new Error("expected range");
    expect(r.form.subtype).toBe("timestamp");
    expect(r.form.subtypeOpclass).toBe("timestamp_ops");
    expect(r.form.collation).toBe('"C"');
    expect(r.form.canonical).toBe("ts_canonical");
    expect(r.form.subtypeDiff).toBe("ts_diff");
    expect(r.form.multirangeTypeName).toBe("ts_multirange");
    expect(r.form.comment).toBe("typed timestamp range");
  });
});
