// — owner: .
// Pure builder for CREATE MATERIALIZED VIEW … WITH (timescaledb.continuous).
// Bucket interval is inlined as INTERVAL '<value>' literal; aggregations and
// groupByExtra are inlined verbatim — they're free-text fields owned by the
// power user (the wizard validates non-empty before submit).
export type ContinuousAggregateForm = {
  viewName: string;
  sourceHypertable: string;
  timeColumn: string;
  bucketInterval: string;
  aggregationsExpression: string;
  groupByExtra: string;
  withData: boolean;
};

function escSql(value: string): string {
  return value.replace(/'/g, "''");
}

export function buildContinuousAggregateSql(form: ContinuousAggregateForm): string {
  const hasExtra = form.groupByExtra.trim() !== "";
  const lines: string[] = [];
  lines.push(`CREATE MATERIALIZED VIEW ${form.viewName}`);
  lines.push("WITH (timescaledb.continuous) AS");
  lines.push("SELECT");
  lines.push(    `  time_bucket(INTERVAL '${escSql(form.bucketInterval)}', ${form.timeColumn}) AS bucket,`,
);
  if (hasExtra) {
    lines.push(`  ${form.groupByExtra},`);
  }
  lines.push(`  ${form.aggregationsExpression}`);
  lines.push(`FROM ${form.sourceHypertable}`);
  lines.push(hasExtra ? `GROUP BY bucket, ${form.groupByExtra}` : "GROUP BY bucket");
  lines.push(form.withData ? "WITH DATA;" : "WITH NO DATA;");
  return lines.join("\n");
}
