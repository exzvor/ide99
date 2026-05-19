import { describe, expect, it } from "vitest";
import { buildPreview } from "./preview";

describe("buildPreview", () => {
  it("reindexTable", () => {
    const r = buildPreview({
      kind: "reindexTable",
      schema: "public",
      table: "users",
      sizeBytes: 1_200_000_000,
    });
    expect(r.sql).toBe('REINDEX TABLE CONCURRENTLY "public"."users"');
    expect(r.confirmTarget).toBe("users");
    expect(r.impact).toBe("health.actions.impact.reindex");
    expect(r.impactArgs?.size).toMatch(/GB|MB/);
  });

  it("vacuum", () => {
    const r = buildPreview({ kind: "vacuum", schema: "public", table: "users" });
    expect(r.sql).toBe('VACUUM "public"."users"');
    expect(r.confirmTarget).toBe("users");
  });

  it("analyze", () => {
    const r = buildPreview({ kind: "analyze", schema: "public", table: "users" });
    expect(r.sql).toBe('ANALYZE "public"."users"');
    expect(r.impact).toBe("health.actions.impact.analyze");
  });

  it("dropIndex", () => {
    const r = buildPreview({
      kind: "dropIndex",
      schema: "public",
      index: "idx_users_email",
      onTable: "users",
      sizeBytes: 250 * 1024 * 1024,
    });
    expect(r.sql).toBe('DROP INDEX CONCURRENTLY "public"."idx_users_email"');
    expect(r.confirmTarget).toBe("idx_users_email");
  });

  it("killPid (cancel)", () => {
    const r = buildPreview({ kind: "killPid", pid: 12345 });
    expect(r.sql).toBe("SELECT pg_cancel_backend(12345)");
    expect(r.confirmTarget).toBe("12345");
    expect(r.impact).toBe("health.actions.impact.kill_cancel");
  });

  it("killPid (terminate)", () => {
    const r = buildPreview({ kind: "killPid", pid: 12345, terminate: true });
    expect(r.sql).toBe("SELECT pg_terminate_backend(12345)");
    expect(r.impact).toBe("health.actions.impact.kill_terminate");
  });

  it("escapes embedded double-quotes in identifiers", () => {
    const r = buildPreview({ kind: "vacuum", schema: 'we"ird', table: "t" });
    expect(r.sql).toBe('VACUUM "we""ird"."t"');
  });

  it("explain throws — handled outside preview", () => {
    expect(() => buildPreview({ kind: "explain", sql: "SELECT 1" } as never)).toThrow();
  });
});
