// — owner: .
// Pure builder for continuous-aggregate refresh-policy SQL.
export type RefreshPolicyForm = {
  qualifiedView: string;
  startOffset: string;
  endOffset: string;
  scheduleInterval: string;
  mode: "create" | "drop";
};

function escSql(value: string): string {
  return value.replace(/'/g, "''");
}

export function buildRefreshPolicySql(form: RefreshPolicyForm): string {
  if (form.mode === "drop") {
    return `SELECT remove_continuous_aggregate_policy('${escSql(form.qualifiedView)}');`;
  }
  const lines: string[] = [];
  lines.push("SELECT add_continuous_aggregate_policy(");
  lines.push(`  '${escSql(form.qualifiedView)}',`);
  lines.push(`  start_offset => INTERVAL '${escSql(form.startOffset)}',`);
  lines.push(`  end_offset => INTERVAL '${escSql(form.endOffset)}',`);
  lines.push(`  schedule_interval => INTERVAL '${escSql(form.scheduleInterval)}'`);
  lines.push(");");
  return lines.join("\n");
}
