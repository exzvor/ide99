// — : tests for the create_parent SQL builder.
// Pure function — no fixtures, no mocks. Asserts:
// * Minimal form (no premake, no retention) emits a single-statement SELECT.
// * Premake adds the optional p_premake argument.
// * Retention appends an UPDATE on partman.part_config.
// * Single quotes inside the parent_table literal are escaped as ''.
import { describe, expect, it } from "vitest";
import { type CreateParentForm, buildCreateParentSql } from "../createParentSql";

function baseForm(overrides: Partial<CreateParentForm> = {}): CreateParentForm {
  return {
    parentTable: "public.events",
    controlColumn: "created_at",
    partitionType: "native",
    partitionInterval: "1 day",
    ...overrides,
  };
}

describe("buildCreateParentSql", () => {
  it("emits create_parent without premake or retention block when both are absent", () => {
    const sql = buildCreateParentSql(baseForm());
    expect(sql).toContain("SELECT partman.create_parent(");
    expect(sql).toContain("p_parent_table => 'public.events'");
    expect(sql).toContain("p_control => 'created_at'");
    // do NOT emit p_type — partman 5.x rejects 'native' and
    // defaults to 'range', which covers the wizard's flow.
    expect(sql).not.toContain("p_type");
    expect(sql).toContain("p_interval => '1 day'");
    expect(sql).not.toContain("p_premake");
    expect(sql).not.toContain("UPDATE partman.part_config");
  });

  it("includes p_premake when premakeCount is provided", () => {
    const sql = buildCreateParentSql(baseForm({ premakeCount: 8 }));
    expect(sql).toContain("p_premake => 8");
  });

  it("appends an UPDATE on partman.part_config when retention is set", () => {
    const sql = buildCreateParentSql(baseForm({ retention: "6 months" }));
    expect(sql).toContain("UPDATE partman.part_config SET");
    expect(sql).toContain("retention = '6 months'");
    expect(sql).toContain("retention_keep_table = false");
    expect(sql).toContain("WHERE parent_table = 'public.events'");
  });

  it("escapes single quotes in parent_table and other string literals", () => {
    const sql = buildCreateParentSql(      baseForm({ parentTable: "public.events's data", retention: "6 months" }),
);
    // First occurrence in create_parent.
    expect(sql).toContain("p_parent_table => 'public.events''s data'");
    // Same escape inside the retention UPDATE.
    expect(sql).toContain("WHERE parent_table = 'public.events''s data'");
  });

  it("emits both premake and retention together when both supplied", () => {
    const sql = buildCreateParentSql(baseForm({ premakeCount: 4, retention: "30 days" }));
    expect(sql).toContain("p_premake => 4");
    expect(sql).toContain("UPDATE partman.part_config SET");
    expect(sql).toContain("retention = '30 days'");
  });
});
