import { describe, expect, test } from "vitest";
import { generateTableDdl } from "./tableDdl";
import type { ColumnForm, IndexForm, TableForm } from "./types";

const col = (  over: Partial<ColumnForm> & { id: string; name: string; typeText: string },
): ColumnForm => ({
  nullable: true,
  default: null,
  generated: null,
  comment: null,
  ...over,
});

const baseTable = (over: Partial<TableForm> = {}): TableForm => ({
  schema: "public",
  name: "items",
  comment: null,
  columns: [],
  constraints: [],
  indexes: [],
  rls: { enabled: false, policies: [] },
  partition: null,
  ...over,
});

// ────────────────── create-mode (T2) ──────────────────

describe("generateTableDdl — create mode", () => {
  test("empty form (no name) → error, empty sql", () => {
    const result = generateTableDdl(null, baseTable({ name: "" }));
    expect(result.sql).toBe("");
    expect(result.errors.find((e) => e.code === "name_required")).toBeTruthy();
  });

  test("duplicate column names → error", () => {
    const result = generateTableDdl(      null,
      baseTable({
        columns: [
          col({ id: "1", name: "x", typeText: "int" }),
          col({ id: "2", name: "x", typeText: "text" }),
        ],
      }),
);
    expect(result.sql).toBe("");
    expect(result.errors.find((e) => e.code === "duplicate_column")).toBeTruthy();
  });

  test("PK referencing unknown column → error", () => {
    const result = generateTableDdl(      null,
      baseTable({
        columns: [col({ id: "1", name: "id", typeText: "int" })],
        constraints: [{ id: "c1", kind: "pk", columns: ["missing"] }],
      }),
);
    expect(result.errors.find((e) => e.code === "pk_unknown_column")).toBeTruthy();
  });

  test("empty CHECK expression → error", () => {
    const result = generateTableDdl(      null,
      baseTable({
        columns: [col({ id: "1", name: "id", typeText: "int" })],
        constraints: [{ id: "c1", kind: "check", expression: "  " }],
      }),
);
    expect(result.errors.find((e) => e.code === "empty_check")).toBeTruthy();
  });

  test("minimal table (1 col) → CREATE TABLE", () => {
    const result = generateTableDdl(      null,
      baseTable({
        columns: [col({ id: "1", name: "id", typeText: "int", nullable: false })],
      }),
);
    expect(result.errors).toEqual([]);
    expect(result.sql).toBe("CREATE TABLE public.items (\n    id INT NOT NULL\n);");
  });

  test("full table with PK + FK + UNIQUE + CHECK + comment + generated col", () => {
    const result = generateTableDdl(      null,
      baseTable({
        comment: "All the items",
        columns: [
          col({ id: "1", name: "id", typeText: "bigint", nullable: false }),
          col({ id: "2", name: "name", typeText: "text", nullable: false }),
          col({ id: "3", name: "owner_id", typeText: "bigint", nullable: false }),
          col({
            id: "4",
            name: "label",
            typeText: "text",
            nullable: false,
            generated: { kind: "stored", expression: "upper(name)" },
          }),
        ],
        constraints: [
          { id: "c1", kind: "pk", columns: ["id"] },
          { id: "c2", kind: "unique", columns: ["name"] },
          {
            id: "c3",
            kind: "fk",
            columns: ["owner_id"],
            refSchema: "public",
            refTable: "users",
            refColumns: ["id"],
            onDelete: "cascade",
          },
          { id: "c4", kind: "check", expression: "char_length(name) > 0" },
        ],
      }),
);
    expect(result.errors).toEqual([]);
    expect(result.sql).toContain("CREATE TABLE public.items");
    expect(result.sql).toContain("id BIGINT NOT NULL");
    expect(result.sql).toContain("label TEXT NOT NULL GENERATED ALWAYS AS (upper(name)) STORED");
    expect(result.sql).toContain("PRIMARY KEY (id)");
    expect(result.sql).toContain("UNIQUE (name)");
    expect(result.sql).toContain(      "FOREIGN KEY (owner_id) REFERENCES public.users (id) ON DELETE CASCADE",
);
    expect(result.sql).toContain("CHECK (char_length(name) > 0)");
    expect(result.sql).toContain("COMMENT ON TABLE public.items IS 'All the items'");
  });

  test("comment with single quote escaped + index inline + RLS enabled", () => {
    const idx: IndexForm = {
      id: "i1",
      name: "ix_name",
      schema: "public",
      table: "items",
      method: "btree",
      unique: false,
      columns: [{ expr: "name" }],
      include: [],
      predicate: null,
      withOptions: {},
    };
    const result = generateTableDdl(      null,
      baseTable({
        comment: "Bob's items",
        columns: [col({ id: "1", name: "name", typeText: "text" })],
        indexes: [idx],
        rls: { enabled: true, policies: [] },
      }),
);
    expect(result.errors).toEqual([]);
    expect(result.sql).toContain("COMMENT ON TABLE public.items IS 'Bob''s items'");
    expect(result.sql).toContain("CREATE INDEX ix_name ON public.items USING btree (name)");
    expect(result.sql).toContain("ALTER TABLE public.items ENABLE ROW LEVEL SECURITY");
  });
});

// ────────────────── edit-mode (T3) ──────────────────

describe("generateTableDdl — edit mode", () => {
  test("no diff → empty sql", () => {
    const t = baseTable({ columns: [col({ id: "1", name: "id", typeText: "int" })] });
    const result = generateTableDdl(t, { ...t });
    expect(result.errors).toEqual([]);
    expect(result.sql).toBe("");
  });

  test("rename column → uses new name in subsequent ALTER chunks", () => {
    const initial = baseTable({
      columns: [col({ id: "1", name: "old_name", typeText: "text", nullable: true })],
    });
    const current = baseTable({
      columns: [col({ id: "1", name: "new_name", typeText: "text", nullable: false })],
    });
    const result = generateTableDdl(initial, current);
    const lines = result.sql.split("\n");
    const renameIdx = lines.findIndex((l) => l.includes("RENAME COLUMN"));
    const notNullIdx = lines.findIndex((l) => l.includes("SET NOT NULL"));
    expect(renameIdx).toBeGreaterThanOrEqual(0);
    expect(notNullIdx).toBeGreaterThan(renameIdx);
    expect(lines[renameIdx]).toBe("ALTER TABLE public.items RENAME COLUMN old_name TO new_name;");
    expect(lines[notNullIdx]).toBe("ALTER TABLE public.items ALTER COLUMN new_name SET NOT NULL;");
  });

  test("change type", () => {
    const initial = baseTable({
      columns: [col({ id: "1", name: "x", typeText: "int" })],
    });
    const current = baseTable({
      columns: [col({ id: "1", name: "x", typeText: "bigint" })],
    });
    const result = generateTableDdl(initial, current);
    expect(result.sql).toBe("ALTER TABLE public.items ALTER COLUMN x TYPE BIGINT;");
  });

  test("toggle nullable → SET / DROP NOT NULL", () => {
    const initial = baseTable({
      columns: [col({ id: "1", name: "x", typeText: "int", nullable: false })],
    });
    const current = baseTable({
      columns: [col({ id: "1", name: "x", typeText: "int", nullable: true })],
    });
    const result = generateTableDdl(initial, current);
    expect(result.sql).toBe("ALTER TABLE public.items ALTER COLUMN x DROP NOT NULL;");
  });

  test("rename table", () => {
    const initial = baseTable({ name: "old_t" });
    const current = baseTable({ name: "new_t" });
    const result = generateTableDdl(initial, current);
    expect(result.sql).toBe("ALTER TABLE public.old_t RENAME TO new_t;");
  });

  test("drop column (id removed from current)", () => {
    const initial = baseTable({
      columns: [
        col({ id: "1", name: "keep", typeText: "int" }),
        col({ id: "2", name: "gone", typeText: "text" }),
      ],
    });
    const current = baseTable({
      columns: [col({ id: "1", name: "keep", typeText: "int" })],
    });
    const result = generateTableDdl(initial, current);
    expect(result.sql).toBe("ALTER TABLE public.items DROP COLUMN gone;");
  });

  test("add constraint", () => {
    const initial = baseTable({
      columns: [col({ id: "1", name: "id", typeText: "int" })],
    });
    const current = baseTable({
      columns: [col({ id: "1", name: "id", typeText: "int" })],
      constraints: [{ id: "c1", kind: "pk", columns: ["id"] }],
    });
    const result = generateTableDdl(initial, current);
    expect(result.sql).toBe("ALTER TABLE public.items ADD PRIMARY KEY (id);");
  });

  test("replace index method → drop + create, drop comes before create", () => {
    const oldIdx: IndexForm = {
      id: "ix1",
      name: "ix_name",
      schema: "public",
      table: "items",
      method: "btree",
      unique: false,
      columns: [{ expr: "name" }],
      include: [],
      predicate: null,
      withOptions: {},
    };
    const newIdx: IndexForm = { ...oldIdx, method: "hash" };
    const initial = baseTable({ indexes: [oldIdx] });
    const current = baseTable({ indexes: [newIdx] });
    const result = generateTableDdl(initial, current);
    const lines = result.sql.split("\n");
    const dropIdx = lines.findIndex((l) => l.startsWith("DROP INDEX"));
    const createIdx = lines.findIndex((l) => l.startsWith("CREATE INDEX"));
    expect(dropIdx).toBeGreaterThanOrEqual(0);
    expect(createIdx).toBeGreaterThan(dropIdx);
    expect(lines[dropIdx]).toBe("DROP INDEX public.ix_name;");
    expect(lines[createIdx]).toContain("CREATE INDEX ix_name ON public.items USING hash (name)");
  });
});
