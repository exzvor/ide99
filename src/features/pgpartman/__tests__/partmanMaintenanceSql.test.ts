// — : tests for the partman maintenance SQL builders.
import { describe, expect, it } from "vitest";
import { buildRunMaintenanceSql, buildUndoPartitionSql } from "../partmanMaintenanceSql";

describe("buildRunMaintenanceSql", () => {
  it("returns the canonical run_maintenance_proc SELECT", () => {
    expect(buildRunMaintenanceSql()).toBe("SELECT partman.run_maintenance_proc();");
  });
});

describe("buildUndoPartitionSql", () => {
  it("emits keep_table => true when keepTable is true", () => {
    const sql = buildUndoPartitionSql({ parentTable: "public.events", keepTable: true });
    expect(sql).toContain("SELECT partman.undo_partition(");
    expect(sql).toContain("p_parent_table => 'public.events'");
    expect(sql).toContain("p_keep_table => true");
  });

  it("emits keep_table => false when keepTable is false", () => {
    const sql = buildUndoPartitionSql({ parentTable: "public.events", keepTable: false });
    expect(sql).toContain("p_parent_table => 'public.events'");
    expect(sql).toContain("p_keep_table => false");
  });

  it("escapes single quotes in the parent_table literal", () => {
    const sql = buildUndoPartitionSql({
      parentTable: "public.events's data",
      keepTable: true,
    });
    expect(sql).toContain("p_parent_table => 'public.events''s data'");
  });
});
