// — owner: .
// Pure builder for `SELECT create_hypertable(...)` SQL. All literals inlined
// (matches the inline-only convention used by S26 hybridSearchSql / S27 mapViewSql).
// Single quotes inside string literals are escaped via the standard SQL `'` → `''`
// doubling rule.
export type HypertableForm = {
  qualifiedTable: string;
  timeColumn: string;
  chunkTimeInterval: string;
  partitioningColumn?: string;
  migrateData?: boolean;
  ifNotExists?: boolean;
  createDefaultIndexes?: boolean;
};

function escSql(value: string): string {
  return value.replace(/'/g, "''");
}

export function buildCreateHypertableSql(form: HypertableForm): string {
  const lines: string[] = [];
  lines.push("SELECT create_hypertable(");
  lines.push(`  '${escSql(form.qualifiedTable)}',`);
  lines.push(`  '${escSql(form.timeColumn)}',`);

  // Required arg: chunk_time_interval. Trailing fields conditionally appended.
  const tail: string[] = [];
  tail.push(`chunk_time_interval => INTERVAL '${escSql(form.chunkTimeInterval)}'`);
  if (form.partitioningColumn !== undefined) {
    tail.push(`partitioning_column => '${escSql(form.partitioningColumn)}'`);
  }
  if (form.migrateData !== undefined) {
    tail.push(`migrate_data => ${form.migrateData}`);
  }
  if (form.ifNotExists !== undefined) {
    tail.push(`if_not_exists => ${form.ifNotExists}`);
  }
  if (form.createDefaultIndexes !== undefined) {
    tail.push(`create_default_indexes => ${form.createDefaultIndexes}`);
  }

  for (let i = 0; i < tail.length; i++) {
    const sep = i === tail.length - 1 ? "" : ",";
    lines.push(`  ${tail[i]}${sep}`);
  }
  lines.push(");");
  return lines.join("\n");
}
