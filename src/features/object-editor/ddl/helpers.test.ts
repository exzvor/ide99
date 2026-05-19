import { describe, expect, test } from "vitest";
import {
  formatColumnDef,
  formatConstraintDef,
  formatType,
  joinList,
  qualifiedName,
  quoteIdent,
} from "./helpers";
import type { ColumnForm, ConstraintForm } from "./types";

describe("quoteIdent", () => {
  test("lowercase ident: no quoting needed", () => {
    expect(quoteIdent("foo")).toBe("foo");
    expect(quoteIdent("created_at")).toBe("created_at");
    expect(quoteIdent("_x")).toBe("_x");
    expect(quoteIdent("col1")).toBe("col1");
  });

  test("uppercase or mixed-case ident: quoted", () => {
    expect(quoteIdent("Foo")).toBe('"Foo"');
    expect(quoteIdent("BAR")).toBe('"BAR"');
  });

  test("with spaces or special chars: quoted with escaped quotes", () => {
    expect(quoteIdent("with space")).toBe('"with space"');
    expect(quoteIdent('weird"name')).toBe('"weird""name"');
    expect(quoteIdent("dot.in")).toBe('"dot.in"');
  });

  test("reserved keyword: quoted", () => {
    expect(quoteIdent("user")).toBe('"user"');
    expect(quoteIdent("USER")).toBe('"USER"');
    expect(quoteIdent("select")).toBe('"select"');
    expect(quoteIdent("table")).toBe('"table"');
    expect(quoteIdent("order")).toBe('"order"');
  });

  test("starts with digit: quoted", () => {
    expect(quoteIdent("1col")).toBe('"1col"');
  });
});

describe("qualifiedName (regression)", () => {
  test("safe schema + safe name: bare", () => {
    expect(qualifiedName("public", "users")).toBe("public.users");
  });

  test("schema with dash: both quoted", () => {
    expect(qualifiedName("my-schema", "users")).toBe('"my-schema".users');
  });

  test("uppercase schema: both quoted", () => {
    expect(qualifiedName("MySchema", "MyTable")).toBe('"MySchema"."MyTable"');
  });

  test("cyrillic schema: quoted", () => {
    expect(qualifiedName("кириллица", "таблица")).toBe('"кириллица"."таблица"');
  });

  test("schema with embedded quote: doubled", () => {
    expect(qualifiedName('weird"schema', "x")).toBe('"weird""schema".x');
  });

  test("reserved-keyword schema: quoted", () => {
    expect(qualifiedName("user", "x")).toBe('"user".x');
  });
});

describe("formatType", () => {
  test("uppercases simple type", () => {
    expect(formatType("text")).toBe("TEXT");
    expect(formatType("  integer  ")).toBe("INTEGER");
  });

  test("preserves modifiers like (n) and []", () => {
    expect(formatType("varchar(50)")).toBe("VARCHAR(50)");
    expect(formatType("numeric(10, 2)")).toBe("NUMERIC(10, 2)");
    expect(formatType("text[]")).toBe("TEXT[]");
  });
});

describe("joinList", () => {
  test("joins with default comma sep", () => {
    expect(joinList(["a", "b", "c"])).toBe("a, b, c");
  });

  test("custom sep", () => {
    expect(joinList(["a", "b"], " AND ")).toBe("a AND b");
  });

  test("empty array yields empty string", () => {
    expect(joinList([])).toBe("");
  });
});

describe("formatColumnDef", () => {
  test("basic col: nullable, no default, no generated (lowercase → unquoted)", () => {
    const col: ColumnForm = {
      id: "1",
      name: "title",
      typeText: "text",
      nullable: true,
      default: null,
      generated: null,
      comment: null,
    };
    expect(formatColumnDef(col)).toBe("title TEXT");
  });

  test("NOT NULL + DEFAULT + uppercase quoted name", () => {
    const col: ColumnForm = {
      id: "1",
      name: "Created",
      typeText: "timestamp",
      nullable: false,
      default: "now()",
      generated: null,
      comment: null,
    };
    expect(formatColumnDef(col)).toBe('"Created" TIMESTAMP NOT NULL DEFAULT now()');
  });

  test("generated stored column", () => {
    const col: ColumnForm = {
      id: "1",
      name: "full_name",
      typeText: "text",
      nullable: false,
      default: null,
      generated: { kind: "stored", expression: "first || ' ' || last" },
      comment: null,
    };
    expect(formatColumnDef(col)).toBe(      `full_name TEXT NOT NULL GENERATED ALWAYS AS (first || ' ' || last) STORED`,
);
  });
});

describe("formatConstraintDef", () => {
  test("PRIMARY KEY (lowercase ident → unquoted)", () => {
    const c: ConstraintForm = { id: "1", kind: "pk", columns: ["id"] };
    expect(formatConstraintDef(c)).toBe("PRIMARY KEY (id)");
  });

  test("UNIQUE with name (all lowercase → unquoted)", () => {
    const c: ConstraintForm = { id: "1", kind: "unique", name: "uq_email", columns: ["email"] };
    expect(formatConstraintDef(c)).toBe("CONSTRAINT uq_email UNIQUE (email)");
  });

  test("UNIQUE quoting kicks in for reserved keyword col", () => {
    const c: ConstraintForm = { id: "1", kind: "unique", columns: ["user"] };
    expect(formatConstraintDef(c)).toBe('UNIQUE ("user")');
  });

  test("FOREIGN KEY with ON DELETE CASCADE / ON UPDATE NO ACTION", () => {
    const c: ConstraintForm = {
      id: "1",
      kind: "fk",
      name: "fk_owner",
      columns: ["owner_id"],
      refSchema: "public",
      refTable: "users",
      refColumns: ["id"],
      onDelete: "cascade",
      onUpdate: "no_action",
    };
    expect(formatConstraintDef(c)).toBe(      "CONSTRAINT fk_owner FOREIGN KEY (owner_id) REFERENCES public.users (id) ON DELETE CASCADE ON UPDATE NO ACTION",
);
  });

  test("FOREIGN KEY with set_null/set_default", () => {
    const c: ConstraintForm = {
      id: "1",
      kind: "fk",
      columns: ["a"],
      refSchema: "public",
      refTable: "t",
      refColumns: ["b"],
      onDelete: "set_null",
      onUpdate: "set_default",
    };
    expect(formatConstraintDef(c)).toBe(      "FOREIGN KEY (a) REFERENCES public.t (b) ON DELETE SET NULL ON UPDATE SET DEFAULT",
);
  });

  test("CHECK constraint", () => {
    const c: ConstraintForm = { id: "1", kind: "check", expression: "age >= 0" };
    expect(formatConstraintDef(c)).toBe("CHECK (age >= 0)");
  });
});
