// — owner: .
// Pure builder for retention-policy SQL.
export type RetentionPolicyForm = {
  qualifiedTable: string;
  dropAfter: string;
  mode: "create" | "drop";
};

function escSql(value: string): string {
  return value.replace(/'/g, "''");
}

export function buildRetentionPolicySql(form: RetentionPolicyForm): string {
  if (form.mode === "drop") {
    return `SELECT remove_retention_policy('${escSql(form.qualifiedTable)}');`;
  }
  return (
    `SELECT add_retention_policy('${escSql(form.qualifiedTable)}', ` +
    `INTERVAL '${escSql(form.dropAfter)}');`
  );
}
