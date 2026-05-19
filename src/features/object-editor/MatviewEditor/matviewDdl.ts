// — local minimal CREATE/DROP+CREATE MATERIALIZED VIEW generator.
// TODO(B3->B2 integrate): swap to `ddl/matviewDdl.ts` once B2 lands.

import { quoteIdent } from "../ddl/helpers";
import type { DdlResult, MatviewForm } from "../ddl/types";

export function generateMatviewDdl(initial: MatviewForm | null, current: MatviewForm): DdlResult {
  if (initial === null) {
    return { sql: createSql(current), warnings: [], errors: [] };
  }
  if (
    initial.body === current.body &&
    initial.name === current.name &&
    initial.schema === current.schema &&
    initial.withData === current.withData
  ) {
    return { sql: "", warnings: [], errors: [] };
  }
  // Body change → DROP + CREATE (PG can't ALTER a matview's defining query).
  if (initial.body !== current.body) {
    const drop = `DROP MATERIALIZED VIEW ${initial.schema}.${quoteIdent(initial.name)};`;
    return { sql: `${drop}\n${createSql(current)}`, warnings: [], errors: [] };
  }
  // Rename only (body unchanged).
  if (initial.name !== current.name) {
    return {
      sql: `ALTER MATERIALIZED VIEW ${initial.schema}.${quoteIdent(initial.name)} RENAME TO ${quoteIdent(current.name)};`,
      warnings: [],
      errors: [],
    };
  }
  // withData change without body change is a no-op (REFRESH is the runtime
  // operation; spec says we don't surface that here).
  return { sql: "", warnings: [], errors: [] };
}

function createSql(v: MatviewForm): string {
  const tail = v.withData ? "WITH DATA" : "WITH NO DATA";
  return `CREATE MATERIALIZED VIEW ${v.schema}.${quoteIdent(v.name)} AS\n${v.body}\n${tail};`;
}
