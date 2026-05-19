// — : snapshot tests for the create_hypertable SQL builder.
// Determinism via toBe(...) string equality so the editor-tab text stays stable.
import { describe, expect, it } from "vitest";
import { type HypertableForm, buildCreateHypertableSql } from "../hypertableSql";

describe("buildCreateHypertableSql", () => {
  it("emits the minimal form with only required args", () => {
    const form: HypertableForm = {
      qualifiedTable: '"public"."metrics"',
      timeColumn: "ts",
      chunkTimeInterval: "7 days",
    };
    const sql = buildCreateHypertableSql(form);
    expect(sql).toBe(      "SELECT create_hypertable(\n" +
        '  \'"public"."metrics"\',\n' +
        "  'ts',\n" +
        "  chunk_time_interval => INTERVAL '7 days'\n" +
        ");",
);
  });

  it("emits all four advanced fields in the documented order", () => {
    const form: HypertableForm = {
      qualifiedTable: '"public"."metrics"',
      timeColumn: "ts",
      chunkTimeInterval: "1 day",
      partitioningColumn: "device_id",
      migrateData: true,
      ifNotExists: true,
      createDefaultIndexes: false,
    };
    const sql = buildCreateHypertableSql(form);
    expect(sql).toBe(      "SELECT create_hypertable(\n" +
        '  \'"public"."metrics"\',\n' +
        "  'ts',\n" +
        "  chunk_time_interval => INTERVAL '1 day',\n" +
        "  partitioning_column => 'device_id',\n" +
        "  migrate_data => true,\n" +
        "  if_not_exists => true,\n" +
        "  create_default_indexes => false\n" +
        ");",
);
  });

  it("emits migrate_data => false (false is a valid value, only undefined is skipped)", () => {
    const form: HypertableForm = {
      qualifiedTable: '"public"."metrics"',
      timeColumn: "ts",
      chunkTimeInterval: "7 days",
      migrateData: false,
    };
    const sql = buildCreateHypertableSql(form);
    expect(sql).toBe(      "SELECT create_hypertable(\n" +
        '  \'"public"."metrics"\',\n' +
        "  'ts',\n" +
        "  chunk_time_interval => INTERVAL '7 days',\n" +
        "  migrate_data => false\n" +
        ");",
);
  });

  it("escapes single quotes in qualifiedTable via the SQL doubling rule", () => {
    const form: HypertableForm = {
      qualifiedTable: '"public"."Bob\'s table"',
      timeColumn: "ts",
      chunkTimeInterval: "7 days",
    };
    const sql = buildCreateHypertableSql(form);
    expect(sql).toBe(      "SELECT create_hypertable(\n" +
        "  '\"public\".\"Bob''s table\"',\n" +
        "  'ts',\n" +
        "  chunk_time_interval => INTERVAL '7 days'\n" +
        ");",
);
  });
});
