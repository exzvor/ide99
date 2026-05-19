// — introspect transforms (Definition → *Form).
//
// Each transform is pure and deterministic except for the fresh UUIDs we
// stamp on columns / constraints / indexes. Tests assert structural shape
// (without freezing exact UUID values).

import { describe, expect, test } from "vitest";
import type {
  IndexDefinition,
  MatviewDefinition,
  SequenceDefinition,
  TableDefinition,
  ViewDefinition,
} from "../../../lib/tauri";
import { fromDefinition as indexFromDefinition } from "./indexState";
import { fromDefinition as matviewFromDefinition } from "./matviewState";
import { fromDefinition as sequenceFromDefinition } from "./sequenceState";
import { fromDefinition as tableFromDefinition } from "./tableState";
import { fromDefinition as viewFromDefinition } from "./viewState";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("tableState.fromDefinition", () => {
  test("simple table: maps schema/name/columns; assigns fresh UUIDs", () => {
    const def: TableDefinition = {
      schema: "public",
      name: "users",
      comment: "App users",
      columns: [
        {
          name: "id",
          typeText: "BIGINT",
          nullable: false,
          default: "nextval('users_id_seq')",
          generated: null,
          comment: null,
          ordinal: 1,
        },
        {
          name: "email",
          typeText: "TEXT",
          nullable: false,
          default: null,
          generated: null,
          comment: "Login email",
          ordinal: 2,
        },
      ],
      constraints: [
        {
          name: "users_pkey",
          kind: "pk",
          definition: "PRIMARY KEY (id)",
          columns: ["id"],
          refSchema: null,
          refTable: null,
          refColumns: [],
          expression: null,
        },
      ],
      indexes: [],
      rlsEnabled: false,
      partition: null,
    };
    const form = tableFromDefinition(def);
    expect(form.schema).toBe("public");
    expect(form.name).toBe("users");
    expect(form.comment).toBe("App users");
    expect(form.columns).toHaveLength(2);
    expect(form.columns[0]?.name).toBe("id");
    expect(form.columns[0]?.id).toMatch(UUID_RE);
    expect(form.columns[1]?.id).toMatch(UUID_RE);
    expect(form.columns[0]?.id).not.toBe(form.columns[1]?.id);
    expect(form.constraints).toHaveLength(1);
    expect(form.constraints[0]?.kind).toBe("pk");
    expect(form.rls).toEqual({ enabled: false, policies: [] });
    expect(form.partition).toBeNull();
  });

  test("table with FK: pulls structured refSchema/refTable/refColumns", () => {
    const def: TableDefinition = {
      schema: "public",
      name: "orders",
      comment: null,
      columns: [
        {
          name: "user_id",
          typeText: "BIGINT",
          nullable: false,
          default: null,
          generated: null,
          comment: null,
          ordinal: 1,
        },
      ],
      constraints: [
        {
          name: "orders_user_fk",
          kind: "fk",
          definition: "FOREIGN KEY (user_id) REFERENCES public.users(id)",
          columns: ["user_id"],
          refSchema: "public",
          refTable: "users",
          refColumns: ["id"],
          expression: null,
        },
      ],
      indexes: [],
      rlsEnabled: false,
      partition: null,
    };
    const form = tableFromDefinition(def);
    expect(form.constraints).toHaveLength(1);
    const c = form.constraints[0];
    expect(c?.kind).toBe("fk");
    if (c?.kind === "fk") {
      expect(c.refSchema).toBe("public");
      expect(c.refTable).toBe("users");
      expect(c.refColumns).toEqual(["id"]);
      expect(c.name).toBe("orders_user_fk");
      // ON DELETE / ON UPDATE not surfaced — left undefined so the generator
      // emits no clauses (preserves catalog defaults).
      expect(c.onDelete).toBeUndefined();
      expect(c.onUpdate).toBeUndefined();
    }
  });

  test("table with RLS enabled: surfaced via rls.enabled=true", () => {
    const def: TableDefinition = {
      schema: "secure",
      name: "secrets",
      comment: null,
      columns: [],
      constraints: [],
      indexes: [],
      rlsEnabled: true,
      partition: null,
    };
    const form = tableFromDefinition(def);
    expect(form.rls.enabled).toBe(true);
    expect(form.rls.policies).toEqual([]);
  });

  test("table with generated column: preserves generated.kind/expression", () => {
    const def: TableDefinition = {
      schema: "public",
      name: "products",
      comment: null,
      columns: [
        {
          name: "price_cents",
          typeText: "INTEGER",
          nullable: false,
          default: null,
          generated: null,
          comment: null,
          ordinal: 1,
        },
        {
          name: "price_dollars",
          typeText: "NUMERIC(10, 2)",
          nullable: true,
          default: null,
          generated: { kind: "stored", expression: "price_cents / 100.0" },
          comment: null,
          ordinal: 2,
        },
      ],
      constraints: [],
      indexes: [],
      rlsEnabled: false,
      partition: null,
    };
    const form = tableFromDefinition(def);
    expect(form.columns[1]?.generated).toEqual({
      kind: "stored",
      expression: "price_cents / 100.0",
    });
  });

  test("table with partition info: surfaced verbatim", () => {
    const def: TableDefinition = {
      schema: "analytics",
      name: "events",
      comment: null,
      columns: [],
      constraints: [],
      indexes: [],
      rlsEnabled: false,
      partition: { strategy: "range", key: "RANGE (created_at)" },
    };
    const form = tableFromDefinition(def);
    expect(form.partition).toEqual({ strategy: "range", key: "RANGE (created_at)" });
  });
});

describe("viewState.fromDefinition", () => {
  test("simple view: maps schema/name/body verbatim", () => {
    const def: ViewDefinition = {
      schema: "public",
      name: "active_users",
      body: " SELECT u.id\n   FROM users u\n  WHERE u.active;",
      comment: null,
    };
    const form = viewFromDefinition(def);
    expect(form).toEqual({
      schema: "public",
      name: "active_users",
      body: " SELECT u.id\n   FROM users u\n  WHERE u.active;",
    });
  });
});

describe("matviewState.fromDefinition", () => {
  test("populated matview: withData=true", () => {
    const def: MatviewDefinition = {
      schema: "reporting",
      name: "daily_signups",
      body: "SELECT date_trunc('day', created_at) AS day, count(*) FROM users GROUP BY 1",
      populated: true,
      comment: null,
    };
    const form = matviewFromDefinition(def);
    expect(form.withData).toBe(true);
    expect(form.body).toContain("date_trunc");
  });

  test("unpopulated matview: withData=false (re-apply will populate)", () => {
    const def: MatviewDefinition = {
      schema: "reporting",
      name: "stale_mv",
      body: "SELECT 1",
      populated: false,
      comment: null,
    };
    const form = matviewFromDefinition(def);
    // We mirror the catalog state — withData reflects whether the matview is
    // currently populated. UI may default this differently for new edits.
    expect(form.withData).toBe(false);
  });
});

describe("indexState.fromDefinition", () => {
  test("index with INCLUDE: include array preserved, columns mapped to expr", () => {
    const def: IndexDefinition = {
      schema: "public",
      name: "idx_users_email",
      table: "users",
      method: "btree",
      unique: true,
      primary: false,
      columns: ["email"],
      include: ["created_at", "is_active"],
      predicate: null,
      definition:
        "CREATE UNIQUE INDEX idx_users_email ON public.users USING btree (email) INCLUDE (created_at, is_active)",
    };
    const form = indexFromDefinition(def);
    expect(form.id).toMatch(UUID_RE);
    expect(form.method).toBe("btree");
    expect(form.unique).toBe(true);
    expect(form.columns).toEqual([{ expr: "email" }]);
    expect(form.include).toEqual(["created_at", "is_active"]);
    expect(form.predicate).toBeNull();
  });

  test("index with predicate: predicate carried through", () => {
    const def: IndexDefinition = {
      schema: "public",
      name: "idx_users_active",
      table: "users",
      method: "btree",
      unique: false,
      primary: false,
      columns: ["email"],
      include: [],
      predicate: "(deleted_at IS NULL)",
      definition:
        "CREATE INDEX idx_users_active ON public.users USING btree (email) WHERE (deleted_at IS NULL)",
    };
    const form = indexFromDefinition(def);
    expect(form.predicate).toBe("(deleted_at IS NULL)");
    expect(form.unique).toBe(false);
  });
});

describe("sequenceState.fromDefinition", () => {
  test("full options: all fields carried through", () => {
    // Use MAX_SAFE_INTEGER for the upper bound — the schema models numeric
    // bigints as JS `number`, so a literal pg-bigint MAX (2^63-1) would lose
    // precision at parse time. The transform copies the value verbatim, so
    // any safe integer is sufficient to assert pass-through behaviour.
    const safeMax = Number.MAX_SAFE_INTEGER;
    const def: SequenceDefinition = {
      schema: "public",
      name: "users_id_seq",
      dataType: "bigint",
      start: 1,
      increment: 1,
      minValue: 1,
      maxValue: safeMax,
      cache: 50,
      cycle: false,
      ownedBy: { schema: "public", table: "users", column: "id" },
    };
    const form = sequenceFromDefinition(def);
    expect(form).toEqual({
      schema: "public",
      name: "users_id_seq",
      dataType: "bigint",
      start: 1,
      increment: 1,
      minValue: 1,
      maxValue: safeMax,
      cache: 50,
      cycle: false,
      ownedBy: { schema: "public", table: "users", column: "id" },
    });
  });
});
