// — pure builders for the partman maintenance / drop helpers.
// Single-quote escape only; no identifier quoting (partman convention).

export function buildRunMaintenanceSql(): string {
  return "SELECT partman.run_maintenance_proc();";
}

export function buildUndoPartitionSql(input: {
  parentTable: string;
  keepTable: boolean;
}): string {
  const escaped = input.parentTable.replace(/'/g, "''");
  return `SELECT partman.undo_partition(  p_parent_table => '${escaped}',
  p_keep_table => ${input.keepTable}
);`;
}
