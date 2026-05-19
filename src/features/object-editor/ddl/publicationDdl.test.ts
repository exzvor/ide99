import { describe, expect, it } from "vitest";
import { generatePublicationDdl } from "./publicationDdl";
import type { PublicationForm } from "./types";

const baseForm = (overrides: Partial<PublicationForm> = {}): PublicationForm => ({
  name: "p1",
  mode: "tables",
  schemas: [],
  tables: [],
  publishInsert: true,
  publishUpdate: true,
  publishDelete: true,
  publishTruncate: true,
  publishViaPartitionRoot: false,
  comment: null,
  ...overrides,
});

describe("generatePublicationDdl", () => {
  it("create with mode=tables and 2 tables, ops insert+update emits FOR TABLE + WITH publish", () => {
    const r = generatePublicationDdl(
      null,
      baseForm({
        tables: [
          { id: "t1", schema: "public", name: "users" },
          { id: "t2", schema: "public", name: "orders" },
        ],
        publishInsert: true,
        publishUpdate: true,
        publishDelete: false,
        publishTruncate: false,
      }),
    );
    expect(r.sql).toContain("CREATE PUBLICATION p1");
    expect(r.sql).toContain("FOR TABLE public.users, public.orders");
    expect(r.sql).toContain("WITH (publish = 'insert,update')");
    expect(r.errors).toHaveLength(0);
  });

  it("create with mode=all_tables emits FOR ALL TABLES (no WITH when default ops)", () => {
    const r = generatePublicationDdl(null, baseForm({ mode: "all_tables" }));
    expect(r.sql).toBe("CREATE PUBLICATION p1 FOR ALL TABLES;");
  });

  it("create with mode=schemas and 2 schemas emits FOR TABLES IN SCHEMA", () => {
    const r = generatePublicationDdl(
      null,
      baseForm({ mode: "schemas", schemas: ["public", "audit"] }),
    );
    expect(r.sql).toContain("FOR TABLES IN SCHEMA public, audit");
  });

  it("rename emits ALTER PUBLICATION RENAME TO", () => {
    const init = baseForm();
    const cur = baseForm({ name: "p1_renamed" });
    const r = generatePublicationDdl(init, cur);
    expect(r.sql).toContain("ALTER PUBLICATION p1 RENAME TO p1_renamed;");
  });

  it("tables list add emits ADD TABLE", () => {
    const init = baseForm({
      tables: [{ id: "t1", schema: "public", name: "users" }],
    });
    const cur = baseForm({
      tables: [
        { id: "t1", schema: "public", name: "users" },
        { id: "t2", schema: "public", name: "orders" },
      ],
    });
    const r = generatePublicationDdl(init, cur);
    expect(r.sql).toBe("ALTER PUBLICATION p1 ADD TABLE public.orders;");
  });

  it("tables list drop emits DROP TABLE", () => {
    const init = baseForm({
      tables: [
        { id: "t1", schema: "public", name: "users" },
        { id: "t2", schema: "public", name: "orders" },
      ],
    });
    const cur = baseForm({
      tables: [{ id: "t1", schema: "public", name: "users" }],
    });
    const r = generatePublicationDdl(init, cur);
    expect(r.sql).toBe("ALTER PUBLICATION p1 DROP TABLE public.orders;");
  });

  it("schemas list add emits ADD TABLES IN SCHEMA", () => {
    const init = baseForm({ mode: "schemas", schemas: ["public"] });
    const cur = baseForm({ mode: "schemas", schemas: ["public", "audit"] });
    const r = generatePublicationDdl(init, cur);
    expect(r.sql).toBe("ALTER PUBLICATION p1 ADD TABLES IN SCHEMA audit;");
  });

  it("schemas list drop emits DROP TABLES IN SCHEMA", () => {
    const init = baseForm({ mode: "schemas", schemas: ["public", "audit"] });
    const cur = baseForm({ mode: "schemas", schemas: ["public"] });
    const r = generatePublicationDdl(init, cur);
    expect(r.sql).toBe("ALTER PUBLICATION p1 DROP TABLES IN SCHEMA audit;");
  });

  it("publish-ops change emits SET (publish=...)", () => {
    const init = baseForm();
    const cur = baseForm({
      publishInsert: true,
      publishUpdate: false,
      publishDelete: false,
      publishTruncate: false,
    });
    const r = generatePublicationDdl(init, cur);
    expect(r.sql).toBe("ALTER PUBLICATION p1 SET (publish = 'insert');");
  });

  it("publishViaPartitionRoot toggle emits SET (publish_via_partition_root)", () => {
    const init = baseForm();
    const cur = baseForm({ publishViaPartitionRoot: true });
    const r = generatePublicationDdl(init, cur);
    expect(r.sql).toBe("ALTER PUBLICATION p1 SET (publish_via_partition_root = true);");
  });

  it("mode change tables → all_tables warns + DROP+CREATE", () => {
    const init = baseForm({ mode: "tables" });
    const cur = baseForm({ mode: "all_tables" });
    const r = generatePublicationDdl(init, cur);
    expect(r.warnings.some((w) => w.code === "publication_recreate_required")).toBe(true);
    expect(r.sql).toContain("DROP PUBLICATION p1;");
    expect(r.sql).toContain("CREATE PUBLICATION p1 FOR ALL TABLES");
  });

  it("mode change schemas → tables warns + DROP+CREATE", () => {
    const init = baseForm({ mode: "schemas", schemas: ["public"] });
    const cur = baseForm({
      mode: "tables",
      tables: [{ id: "t1", schema: "public", name: "users" }],
    });
    const r = generatePublicationDdl(init, cur);
    expect(r.warnings.some((w) => w.code === "publication_recreate_required")).toBe(true);
    expect(r.sql).toContain("DROP PUBLICATION p1;");
    expect(r.sql).toContain("CREATE PUBLICATION p1 FOR TABLE public.users");
  });

  it("no diff emits empty sql", () => {
    const f = baseForm();
    const r = generatePublicationDdl(f, f);
    expect(r.sql).toBe("");
  });

  it("create with default ops (all four) and partition root toggled emits WITH", () => {
    const r = generatePublicationDdl(
      null,
      baseForm({
        mode: "all_tables",
        publishViaPartitionRoot: true,
      }),
    );
    expect(r.sql).toBe(
      "CREATE PUBLICATION p1 FOR ALL TABLES WITH (publish_via_partition_root = true);",
    );
  });
});
