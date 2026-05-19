import type { JsonbDiff, RowKey } from "../../../lib/tauri";

const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;
const litStr = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** Build the human-readable, value-inlined SQL for the diff-preview pane.
 * Authoritative parameterized SQL is built backend-side — this string is
 * display only. Returns an empty string when there is nothing to save (no
 * changes and not a full replace) or when the row key is read-only. */
export function previewSql(args: {
  rowKey: RowKey;
  column: string;
  diff: JsonbDiff;
}): string {
  const { rowKey, column, diff } = args;
  if (rowKey.kind === "readOnly") return "";
  if (!diff.fullReplace && diff.ops.length === 0) return "";

  const fq = `${ident(rowKey.schema)}.${ident(rowKey.table)}`;

  let setExpr: string;
  if (diff.fullReplace) {
    const json = JSON.stringify(diff.fullValue ?? null);
    setExpr = `${ident(column)} = ${litStr(json)}::jsonb`;
  } else {
    let expr = ident(column);
    for (const op of diff.ops) {
      const pathArr = `ARRAY[${op.path.map((p) => litStr(p)).join(",")}]::text[]`;
      if (op.kind === "set") {
        expr = `jsonb_set(${expr}, ${pathArr}, ${litStr(JSON.stringify(op.value))}::jsonb, true)`;
      } else {
        expr = `${expr} #- ${pathArr}`;
      }
    }
    setExpr = `${ident(column)} = ${expr}`;
  }

  let where: string;
  if (rowKey.kind === "pk") {
    where = rowKey.columns
      .map((c) => (c.value === null ? `${ident(c.name)} IS NULL` : `${ident(c.name)} = ${c.value}`))
      .join(" AND ");
  } else {
    where = `ctid = ${litStr(rowKey.ctid)}`;
  }

  return `UPDATE ${fq} SET ${setExpr} WHERE ${where}`;
}
