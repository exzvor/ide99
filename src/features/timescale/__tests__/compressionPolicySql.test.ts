// — : snapshot tests for compression policy SQL builder.
import { describe, expect, it } from "vitest";
import { type CompressionPolicyForm, buildCompressionPolicySql } from "../compressionPolicySql";

describe("buildCompressionPolicySql", () => {
  it("create-mode with full options emits ALTER TABLE + add_compression_policy", () => {
    const form: CompressionPolicyForm = {
      qualifiedTable: '"public"."metrics"',
      segmentBy: "device_id",
      orderBy: "ts DESC",
      compressAfter: "7 days",
      mode: "create",
    };
    const sql = buildCompressionPolicySql(form);
    expect(sql).toBe(
      'ALTER TABLE "public"."metrics" SET (\n' +
        "  timescaledb.compress,\n" +
        "  timescaledb.compress_segmentby = 'device_id',\n" +
        "  timescaledb.compress_orderby = 'ts DESC'\n" +
        ");\n" +
        "SELECT add_compression_policy('\"public\".\"metrics\"', INTERVAL '7 days');",
    );
  });

  it("create-mode minimal (no segmentBy / no orderBy) keeps only timescaledb.compress flag", () => {
    const form: CompressionPolicyForm = {
      qualifiedTable: '"public"."metrics"',
      compressAfter: "7 days",
      mode: "create",
    };
    const sql = buildCompressionPolicySql(form);
    expect(sql).toBe(
      'ALTER TABLE "public"."metrics" SET (\n' +
        "  timescaledb.compress\n" +
        ");\n" +
        "SELECT add_compression_policy('\"public\".\"metrics\"', INTERVAL '7 days');",
    );
  });

  it("drop-mode emits remove_compression_policy", () => {
    const form: CompressionPolicyForm = {
      qualifiedTable: '"public"."metrics"',
      compressAfter: "ignored",
      mode: "drop",
    };
    const sql = buildCompressionPolicySql(form);
    expect(sql).toBe('SELECT remove_compression_policy(\'"public"."metrics"\');');
  });
});
