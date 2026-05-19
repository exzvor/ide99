// — owner: .
//
// Pre-flight check helper that runs four metadata queries in parallel before
// generating a `pg_repack` command. Returns `null` on any query failure
// (typically permission denied or missing extension surface) so the dialog can
// degrade gracefully.
import { queryExecute } from "../../lib/tauri";

export type PreflightResult = {
  hasPk: boolean;
  tableSize: string;
  indexCount: number;
  fkCount: number;
};

export async function runPreflightCheck(  connId: string,
  schema: string,
  table: string,
): Promise<PreflightResult | null> {
  const escapedSchema = schema.replace(/'/g, "''");
  const escapedTable = table.replace(/'/g, "''");
  const qual = `'${escapedSchema}.${escapedTable}'`;
  const queries = [
    `SELECT EXISTS(SELECT 1 FROM pg_index WHERE indrelid = ${qual}::regclass AND indisprimary) AS has_pk`,
    `SELECT pg_size_pretty(pg_total_relation_size(${qual}::regclass)) AS table_size`,
    `SELECT count(*)::int FROM pg_index WHERE indrelid = ${qual}::regclass`,
    `SELECT count(*)::int FROM pg_constraint WHERE conrelid = ${qual}::regclass AND contype = 'f'`,
  ];
  try {
    const results = await Promise.all(queries.map((sql) => queryExecute(connId, sql)));
    const hasPkCell = results[0]?.rows[0]?.[0];
    return {
      hasPk: hasPkCell === "t" || hasPkCell === "true",
      tableSize: results[1]?.rows[0]?.[0] ?? "—",
      indexCount: Number.parseInt(results[2]?.rows[0]?.[0] ?? "0", 10),
      fkCount: Number.parseInt(results[3]?.rows[0]?.[0] ?? "0", 10),
    };
  } catch {
    return null;
  }
}
