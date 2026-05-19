// — : snapshot tests for the CREATE MATERIALIZED VIEW
// continuous-aggregate SQL builder.
import { describe, expect, it } from "vitest";
import {
  type ContinuousAggregateForm,
  buildContinuousAggregateSql,
} from "../continuousAggregateSql";

describe("buildContinuousAggregateSql", () => {
  it("emits the minimal form with WITH NO DATA and a single GROUP BY column", () => {
    const form: ContinuousAggregateForm = {
      viewName: '"public"."hourly_metrics"',
      sourceHypertable: '"public"."metrics"',
      timeColumn: "ts",
      bucketInterval: "1 hour",
      aggregationsExpression: "count(*) AS n, avg(temperature) AS avg_t",
      groupByExtra: "",
      withData: false,
    };
    const sql = buildContinuousAggregateSql(form);
    expect(sql).toBe(      'CREATE MATERIALIZED VIEW "public"."hourly_metrics"\n' +
        "WITH (timescaledb.continuous) AS\n" +
        "SELECT\n" +
        "  time_bucket(INTERVAL '1 hour', ts) AS bucket,\n" +
        "  count(*) AS n, avg(temperature) AS avg_t\n" +
        'FROM "public"."metrics"\n' +
        "GROUP BY bucket\n" +
        "WITH NO DATA;",
);
  });

  it("appends groupByExtra to both SELECT and GROUP BY", () => {
    const form: ContinuousAggregateForm = {
      viewName: '"public"."hourly_metrics"',
      sourceHypertable: '"public"."metrics"',
      timeColumn: "ts",
      bucketInterval: "1 hour",
      aggregationsExpression: "avg(temperature) AS avg_t",
      groupByExtra: "device_id",
      withData: false,
    };
    const sql = buildContinuousAggregateSql(form);
    expect(sql).toBe(      'CREATE MATERIALIZED VIEW "public"."hourly_metrics"\n' +
        "WITH (timescaledb.continuous) AS\n" +
        "SELECT\n" +
        "  time_bucket(INTERVAL '1 hour', ts) AS bucket,\n" +
        "  device_id,\n" +
        "  avg(temperature) AS avg_t\n" +
        'FROM "public"."metrics"\n' +
        "GROUP BY bucket, device_id\n" +
        "WITH NO DATA;",
);
  });

  it("emits WITH DATA when withData=true", () => {
    const form: ContinuousAggregateForm = {
      viewName: '"public"."hourly_metrics"',
      sourceHypertable: '"public"."metrics"',
      timeColumn: "ts",
      bucketInterval: "1 hour",
      aggregationsExpression: "count(*) AS n",
      groupByExtra: "",
      withData: true,
    };
    const sql = buildContinuousAggregateSql(form);
    expect(sql).toBe(      'CREATE MATERIALIZED VIEW "public"."hourly_metrics"\n' +
        "WITH (timescaledb.continuous) AS\n" +
        "SELECT\n" +
        "  time_bucket(INTERVAL '1 hour', ts) AS bucket,\n" +
        "  count(*) AS n\n" +
        'FROM "public"."metrics"\n' +
        "GROUP BY bucket\n" +
        "WITH DATA;",
);
  });
});
