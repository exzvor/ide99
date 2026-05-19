import { describe, expect, it } from "vitest";
import { generateTypeDdl } from "./typeDdl";
import type { CompositeTypeForm, DomainTypeForm, EnumTypeForm, RangeTypeForm } from "./types";

// ---------------------------------------------------------------------------
// Enum
// ---------------------------------------------------------------------------

const enumForm = (overrides: Partial<EnumTypeForm> = {}): EnumTypeForm => ({
  schema: "public",
  name: "color",
  values: [
    { id: "v1", value: "red" },
    { id: "v2", value: "green" },
    { id: "v3", value: "blue" },
  ],
  comment: null,
  ...overrides,
});

describe("generateTypeDdl — enum", () => {
  it("create with 3 values emits CREATE TYPE … AS ENUM", () => {
    const r = generateTypeDdl({ kind: "enum", initial: null, form: enumForm() });
    expect(r.sql).toBe("CREATE TYPE public.color AS ENUM ('red', 'green', 'blue');");
    expect(r.warnings).toHaveLength(0);
  });

  it("append value at end emits ADD VALUE", () => {
    const init = enumForm();
    const cur = enumForm({
      values: [...init.values, { id: "v4", value: "yellow" }],
    });
    const r = generateTypeDdl({ kind: "enum", initial: init, form: cur });
    expect(r.sql).toContain("ALTER TYPE public.color ADD VALUE 'yellow' AFTER 'blue'");
    expect(r.warnings).toHaveLength(0);
  });

  it("insert value mid-list emits ADD VALUE … AFTER previous", () => {
    const init = enumForm();
    const cur = enumForm({
      values: [
        { id: "v1", value: "red" },
        { id: "vNew", value: "orange" },
        { id: "v2", value: "green" },
        { id: "v3", value: "blue" },
      ],
    });
    const r = generateTypeDdl({ kind: "enum", initial: init, form: cur });
    expect(r.sql).toContain("ADD VALUE 'orange' AFTER 'red'");
  });

  it("reorder existing values warns + DROP+CREATE", () => {
    const init = enumForm();
    const cur = enumForm({
      values: [
        { id: "v3", value: "blue" },
        { id: "v2", value: "green" },
        { id: "v1", value: "red" },
      ],
    });
    const r = generateTypeDdl({ kind: "enum", initial: init, form: cur });
    expect(r.warnings.some((w) => w.code === "enum_recreate_required")).toBe(true);
    expect(r.sql).toContain("DROP TYPE public.color CASCADE;");
    expect(r.sql).toContain("CREATE TYPE public.color AS ENUM");
  });

  it("rename value (id matched, value changed) warns + DROP+CREATE", () => {
    const init = enumForm();
    const cur = enumForm({
      values: [
        { id: "v1", value: "crimson" },
        { id: "v2", value: "green" },
        { id: "v3", value: "blue" },
      ],
    });
    const r = generateTypeDdl({ kind: "enum", initial: init, form: cur });
    expect(r.warnings.some((w) => w.code === "enum_recreate_required")).toBe(true);
    expect(r.sql).toContain("DROP TYPE public.color CASCADE;");
  });
});

// ---------------------------------------------------------------------------
// Composite
// ---------------------------------------------------------------------------

const compositeForm = (overrides: Partial<CompositeTypeForm> = {}): CompositeTypeForm => ({
  schema: "public",
  name: "address",
  fields: [
    { id: "f1", fieldName: "street", typeText: "TEXT" },
    { id: "f2", fieldName: "zip", typeText: "TEXT" },
  ],
  comment: null,
  ...overrides,
});

describe("generateTypeDdl — composite", () => {
  it("create with 2 fields emits CREATE TYPE …", () => {
    const r = generateTypeDdl({ kind: "composite", initial: null, form: compositeForm() });
    expect(r.sql).toBe("CREATE TYPE public.address AS (street TEXT, zip TEXT);");
  });

  it("add field emits ALTER TYPE … ADD ATTRIBUTE", () => {
    const init = compositeForm();
    const cur = compositeForm({
      fields: [...init.fields, { id: "f3", fieldName: "city", typeText: "TEXT" }],
    });
    const r = generateTypeDdl({ kind: "composite", initial: init, form: cur });
    expect(r.sql).toBe("ALTER TYPE public.address ADD ATTRIBUTE city TEXT;");
  });

  it("drop field emits ALTER TYPE … DROP ATTRIBUTE", () => {
    const init = compositeForm();
    const cur = compositeForm({
      fields: [{ id: "f1", fieldName: "street", typeText: "TEXT" }],
    });
    const r = generateTypeDdl({ kind: "composite", initial: init, form: cur });
    expect(r.sql).toBe("ALTER TYPE public.address DROP ATTRIBUTE zip;");
  });

  it("rename field (id match) emits ALTER TYPE … RENAME ATTRIBUTE", () => {
    const init = compositeForm();
    const cur = compositeForm({
      fields: [
        { id: "f1", fieldName: "street_addr", typeText: "TEXT" },
        { id: "f2", fieldName: "zip", typeText: "TEXT" },
      ],
    });
    const r = generateTypeDdl({ kind: "composite", initial: init, form: cur });
    expect(r.sql).toBe("ALTER TYPE public.address RENAME ATTRIBUTE street TO street_addr;");
  });

  it("type change emits ALTER TYPE … ALTER ATTRIBUTE TYPE", () => {
    const init = compositeForm();
    const cur = compositeForm({
      fields: [
        { id: "f1", fieldName: "street", typeText: "TEXT" },
        { id: "f2", fieldName: "zip", typeText: "VARCHAR(10)" },
      ],
    });
    const r = generateTypeDdl({ kind: "composite", initial: init, form: cur });
    expect(r.sql).toBe("ALTER TYPE public.address ALTER ATTRIBUTE zip TYPE VARCHAR(10);");
  });

  it("rename type emits ALTER TYPE … RENAME TO", () => {
    const init = compositeForm();
    const cur = compositeForm({ name: "addr2" });
    const r = generateTypeDdl({ kind: "composite", initial: init, form: cur });
    expect(r.sql).toContain("ALTER TYPE public.address RENAME TO addr2;");
  });
});

// ---------------------------------------------------------------------------
// Domain
// ---------------------------------------------------------------------------

const domainForm = (overrides: Partial<DomainTypeForm> = {}): DomainTypeForm => ({
  schema: "public",
  name: "email",
  baseType: "TEXT",
  notNull: false,
  constraints: [],
  comment: null,
  ...overrides,
});

describe("generateTypeDdl — domain", () => {
  it("create with default + NOT NULL + 1 constraint", () => {
    const r = generateTypeDdl({
      kind: "domain",
      initial: null,
      form: domainForm({
        default: "''",
        notNull: true,
        constraints: [
          {
            id: "c1",
            constraintName: "email_check",
            checkExpression: "VALUE ~ '@'",
            notValid: false,
            isNew: true,
          },
        ],
      }),
    });
    expect(r.sql).toContain("CREATE DOMAIN public.email AS TEXT DEFAULT '' NOT NULL;");
    expect(r.sql).toContain(
      "ALTER DOMAIN public.email ADD CONSTRAINT email_check CHECK (VALUE ~ '@');",
    );
  });

  it("default change emits SET DEFAULT", () => {
    const init = domainForm({ default: "'old'" });
    const cur = domainForm({ default: "'new'" });
    const r = generateTypeDdl({ kind: "domain", initial: init, form: cur });
    expect(r.sql).toBe("ALTER DOMAIN public.email SET DEFAULT 'new';");
  });

  it("default cleared emits DROP DEFAULT", () => {
    const init = domainForm({ default: "'x'" });
    const cur = domainForm();
    const r = generateTypeDdl({ kind: "domain", initial: init, form: cur });
    expect(r.sql).toBe("ALTER DOMAIN public.email DROP DEFAULT;");
  });

  it("NOT NULL toggle emits SET/DROP NOT NULL", () => {
    const init = domainForm({ notNull: false });
    const cur = domainForm({ notNull: true });
    const r = generateTypeDdl({ kind: "domain", initial: init, form: cur });
    expect(r.sql).toBe("ALTER DOMAIN public.email SET NOT NULL;");
  });

  it("add new constraint emits ALTER DOMAIN ADD CONSTRAINT CHECK", () => {
    const init = domainForm();
    const cur = domainForm({
      constraints: [
        {
          id: "c1",
          constraintName: "len_check",
          checkExpression: "length(VALUE) > 0",
          notValid: false,
          isNew: true,
        },
      ],
    });
    const r = generateTypeDdl({ kind: "domain", initial: init, form: cur });
    expect(r.sql).toBe(
      "ALTER DOMAIN public.email ADD CONSTRAINT len_check CHECK (length(VALUE) > 0);",
    );
  });

  it("drop constraint emits ALTER DOMAIN DROP CONSTRAINT", () => {
    const init = domainForm({
      constraints: [
        {
          id: "c1",
          constraintName: "len_check",
          checkExpression: "length(VALUE) > 0",
          notValid: false,
          isNew: false,
        },
      ],
    });
    const cur = domainForm();
    const r = generateTypeDdl({ kind: "domain", initial: init, form: cur });
    expect(r.sql).toBe("ALTER DOMAIN public.email DROP CONSTRAINT len_check;");
  });

  it("rename constraint (id match) emits ALTER DOMAIN RENAME CONSTRAINT", () => {
    const init = domainForm({
      constraints: [
        {
          id: "c1",
          constraintName: "old_name",
          checkExpression: "VALUE > 0",
          notValid: false,
          isNew: false,
        },
      ],
    });
    const cur = domainForm({
      constraints: [
        {
          id: "c1",
          constraintName: "new_name",
          checkExpression: "VALUE > 0",
          notValid: false,
          isNew: false,
        },
      ],
    });
    const r = generateTypeDdl({ kind: "domain", initial: init, form: cur });
    expect(r.sql).toBe("ALTER DOMAIN public.email RENAME CONSTRAINT old_name TO new_name;");
  });
});

// ---------------------------------------------------------------------------
// Range
// ---------------------------------------------------------------------------

const rangeForm = (overrides: Partial<RangeTypeForm> = {}): RangeTypeForm => ({
  schema: "public",
  name: "intspan",
  subtype: "int4",
  comment: null,
  ...overrides,
});

describe("generateTypeDdl — range", () => {
  it("create with subtype int4", () => {
    const r = generateTypeDdl({ kind: "range", initial: null, form: rangeForm() });
    expect(r.sql).toBe("CREATE TYPE public.intspan AS RANGE (subtype = int4);");
  });

  it("subtype change warns + DROP+CREATE", () => {
    const init = rangeForm();
    const cur = rangeForm({ subtype: "int8" });
    const r = generateTypeDdl({ kind: "range", initial: init, form: cur });
    expect(r.warnings.some((w) => w.code === "range_recreate_required")).toBe(true);
    expect(r.sql).toContain("DROP TYPE public.intspan CASCADE;");
    expect(r.sql).toContain("CREATE TYPE public.intspan AS RANGE (subtype = int8);");
  });

  it("add multirange_type_name warns + DROP+CREATE", () => {
    const init = rangeForm();
    const cur = rangeForm({ multirangeTypeName: "intspan_multi" });
    const r = generateTypeDdl({ kind: "range", initial: init, form: cur });
    expect(r.warnings.some((w) => w.code === "range_recreate_required")).toBe(true);
    expect(r.sql).toContain("DROP TYPE public.intspan CASCADE;");
    expect(r.sql).toContain("multirange_type_name = intspan_multi");
  });

  it("rename emits ALTER TYPE … RENAME TO", () => {
    const init = rangeForm();
    const cur = rangeForm({ name: "intspan2" });
    const r = generateTypeDdl({ kind: "range", initial: init, form: cur });
    expect(r.sql).toBe("ALTER TYPE public.intspan RENAME TO intspan2;");
  });

  it("no diff emits empty sql", () => {
    const f = rangeForm();
    const r = generateTypeDdl({ kind: "range", initial: f, form: f });
    expect(r.sql).toBe("");
  });
});
