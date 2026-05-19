// — : snapshot tests for continuous-aggregate refresh
// policy SQL builder.
import { describe, expect, it } from "vitest";
import { type RefreshPolicyForm, buildRefreshPolicySql } from "../refreshPolicySql";

describe("buildRefreshPolicySql", () => {
  it("create-mode emits add_continuous_aggregate_policy with three INTERVAL params", () => {
    const form: RefreshPolicyForm = {
      qualifiedView: '"public"."hourly_metrics"',
      startOffset: "30 days",
      endOffset: "1 hour",
      scheduleInterval: "1 hour",
      mode: "create",
    };
    const sql = buildRefreshPolicySql(form);
    expect(sql).toBe(
      "SELECT add_continuous_aggregate_policy(\n" +
        '  \'"public"."hourly_metrics"\',\n' +
        "  start_offset => INTERVAL '30 days',\n" +
        "  end_offset => INTERVAL '1 hour',\n" +
        "  schedule_interval => INTERVAL '1 hour'\n" +
        ");",
    );
  });

  it("drop-mode emits remove_continuous_aggregate_policy", () => {
    const form: RefreshPolicyForm = {
      qualifiedView: '"public"."hourly_metrics"',
      startOffset: "ignored",
      endOffset: "ignored",
      scheduleInterval: "ignored",
      mode: "drop",
    };
    expect(buildRefreshPolicySql(form)).toBe(
      'SELECT remove_continuous_aggregate_policy(\'"public"."hourly_metrics"\');',
    );
  });
});
