// — pure builder for `partman.create_parent(...)` plus an optional
// retention setup UPDATE. partman 5 stores parent_table as un-quoted text in
// the form "schema.table", so identifiers are NOT double-quoted here — only
// embedded single quotes are escaped (`'` → `''`).
//
// Note: `p_type` is intentionally NOT emitted. partman 5.x rejects
// `p_type => 'native'` (raises "native is not a valid partitioning type"),
// and the function defaults to `'range'` which covers the wizard's flow.

export type CreateParentForm = {
  parentTable: string;
  controlColumn: string;
  partitionType: "native";
  partitionInterval: string;
  premakeCount?: number;
  retention?: string;
};

function esc(literal: string): string {
  return literal.replace(/'/g, "''");
}

export function buildCreateParentSql(form: CreateParentForm): string {
  const lines: string[] = [
    "SELECT partman.create_parent(",
    `  p_parent_table => '${esc(form.parentTable)}',`,
    `  p_control => '${esc(form.controlColumn)}',`,
    `  p_interval => '${esc(form.partitionInterval)}'`,
  ];
  if (form.premakeCount !== undefined) {
    // Append the comma to the previous line so we keep one arg per line.
    lines[lines.length - 1] += ",";
    lines.push(`  p_premake => ${form.premakeCount}`);
  }
  lines.push(");");

  if (form.retention !== undefined && form.retention !== "") {
    lines.push("");
    lines.push("UPDATE partman.part_config SET");
    lines.push(`  retention = '${esc(form.retention)}',`);
    lines.push("  retention_keep_table = false");
    lines.push(`WHERE parent_table = '${esc(form.parentTable)}';`);
  }

  return lines.join("\n");
}
