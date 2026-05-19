// — owner: .
// Pure builder for compression-policy SQL. "create" mode emits a two-statement
// script: ALTER TABLE … SET (timescaledb.compress, …) followed by
// add_compression_policy. "drop" mode emits a single remove_compression_policy.
export type CompressionPolicyForm = {
  qualifiedTable: string;
  segmentBy?: string;
  orderBy?: string;
  compressAfter: string;
  mode: "create" | "drop";
};

function escSql(value: string): string {
  return value.replace(/'/g, "''");
}

export function buildCompressionPolicySql(form: CompressionPolicyForm): string {
  if (form.mode === "drop") {
    return `SELECT remove_compression_policy('${escSql(form.qualifiedTable)}');`;
  }

  const settings: string[] = ["timescaledb.compress"];
  if (form.segmentBy !== undefined && form.segmentBy.trim() !== "") {
    settings.push(`timescaledb.compress_segmentby = '${escSql(form.segmentBy)}'`);
  }
  if (form.orderBy !== undefined && form.orderBy.trim() !== "") {
    settings.push(`timescaledb.compress_orderby = '${escSql(form.orderBy)}'`);
  }

  const alterLines: string[] = [];
  alterLines.push(`ALTER TABLE ${form.qualifiedTable} SET (`);
  for (let i = 0; i < settings.length; i++) {
    const sep = i === settings.length - 1 ? "" : ",";
    alterLines.push(`  ${settings[i]}${sep}`);
  }
  alterLines.push(");");
  const alter = alterLines.join("\n");

  const policy =
    `SELECT add_compression_policy('${escSql(form.qualifiedTable)}', ` +
    `INTERVAL '${escSql(form.compressAfter)}');`;
  return `${alter}\n${policy}`;
}
