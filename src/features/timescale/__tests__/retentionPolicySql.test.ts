// — : snapshot tests for retention policy SQL builder.
import { describe, expect, it } from "vitest";
import { type RetentionPolicyForm, buildRetentionPolicySql } from "../retentionPolicySql";

describe("buildRetentionPolicySql", () => {
  it("create-mode emits add_retention_policy with INTERVAL literal", () => {
    const form: RetentionPolicyForm = {
      qualifiedTable: '"public"."metrics"',
      dropAfter: "30 days",
      mode: "create",
    };
    expect(buildRetentionPolicySql(form)).toBe(      "SELECT add_retention_policy('\"public\".\"metrics\"', INTERVAL '30 days');",
);
  });

  it("drop-mode emits remove_retention_policy", () => {
    const form: RetentionPolicyForm = {
      qualifiedTable: '"public"."metrics"',
      dropAfter: "ignored",
      mode: "drop",
    };
    expect(buildRetentionPolicySql(form)).toBe(      'SELECT remove_retention_policy(\'"public"."metrics"\');',
);
  });
});
