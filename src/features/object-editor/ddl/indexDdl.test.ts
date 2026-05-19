import { describe, expect, test } from "vitest";
import { generateIndexDdl } from "./indexDdl";
import type { IndexForm } from "./types";

const baseIdx = (over: Partial<IndexForm> = {}): IndexForm => ({
  id: "ix1",
  name: "ix_test",
  schema: "public",
  table: "items",
  method: "btree",
  unique: false,
  columns: [{ expr: "name" }],
  include: [],
  predicate: null,
  withOptions: {},
  ...over,
});

describe("generateIndexDdl — create mode", () => {
  test("simple btree index with explicit name", () => {
    const result = generateIndexDdl(null, baseIdx());
    expect(result.errors).toEqual([]);
    expect(result.sql).toBe("CREATE INDEX ix_test ON public.items USING btree (name);");
  });

  test("unique partial index with INCLUDE + opclass + DESC NULLS LAST", () => {
    const idx = baseIdx({
      name: "ix_partial",
      unique: true,
      method: "btree",
      columns: [
        { expr: "lower(email)", direction: "desc", nulls: "last", opclass: "text_pattern_ops" },
      ],
      include: ["created_at", "status"],
      predicate: "deleted_at IS NULL",
    });
    const result = generateIndexDdl(null, idx);
    expect(result.sql).toBe(
      "CREATE UNIQUE INDEX ix_partial ON public.items USING btree (lower(email) text_pattern_ops DESC NULLS LAST) INCLUDE (created_at, status) WHERE deleted_at IS NULL;",
    );
  });

  test("create-mode without name → omits name (Postgres auto-generates)", () => {
    const result = generateIndexDdl(null, baseIdx({ name: "" }));
    expect(result.sql).toBe("CREATE INDEX ON public.items USING btree (name);");
  });
});

describe("generateIndexDdl — edit mode", () => {
  test("rename-only → ALTER INDEX RENAME TO", () => {
    const initial = baseIdx({ name: "old_ix" });
    const current = baseIdx({ name: "new_ix" });
    const result = generateIndexDdl(initial, current);
    expect(result.warnings).toEqual([]);
    expect(result.sql).toBe("ALTER INDEX public.old_ix RENAME TO new_ix;");
  });

  test("change method → drop + create with warning", () => {
    const initial = baseIdx({ method: "btree" });
    const current = baseIdx({ method: "hash" });
    const result = generateIndexDdl(initial, current);
    expect(result.warnings.find((w) => w.code === "index_recreate")).toBeTruthy();
    expect(result.sql.split("\n")).toEqual([
      "DROP INDEX public.ix_test;",
      "CREATE INDEX ix_test ON public.items USING hash (name);",
    ]);
  });

  test("no diff → empty sql", () => {
    const idx = baseIdx();
    const result = generateIndexDdl(idx, { ...idx });
    expect(result.sql).toBe("");
  });
});

describe("S26 — pgvector index methods", () => {
  test("emits CREATE INDEX … USING hnsw with WITH (ef_construction, m)", () => {
    const form: IndexForm = baseIdx({
      name: "items_embedding_hnsw",
      method: "hnsw",
      columns: [{ expr: "embedding vector_l2_ops" }],
      withOptions: { m: 16, ef_construction: 64 },
    });
    const out = generateIndexDdl(null, form);
    expect(out.errors).toEqual([]);
    expect(out.sql).toContain("USING hnsw");
    expect(out.sql).toContain("WITH (ef_construction = 64, m = 16)");
  });

  test("emits CREATE INDEX … USING ivfflat with WITH (lists)", () => {
    const form: IndexForm = baseIdx({
      name: "docs_v_ivf",
      table: "docs",
      method: "ivfflat",
      columns: [{ expr: "v vector_cosine_ops" }],
      withOptions: { lists: 200 },
    });
    const out = generateIndexDdl(null, form);
    expect(out.errors).toEqual([]);
    expect(out.sql).toContain("USING ivfflat");
    expect(out.sql).toContain("WITH (lists = 200)");
  });

  test("omits WITH (...) when withOptions is empty", () => {
    const form = baseIdx({
      name: "users_email_idx",
      table: "users",
      method: "btree",
      columns: [{ expr: "email" }],
      withOptions: {},
    });
    const out = generateIndexDdl(null, form);
    expect(out.sql).not.toContain("WITH (");
  });
});
