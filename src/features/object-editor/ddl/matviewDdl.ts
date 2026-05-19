// — pure CREATE MATERIALIZED VIEW / DROP+CREATE / REFRESH generator.
//
// Postgres can't ALTER the body of a matview in place, so any body change
// requires DROP + CREATE. We surface this with `matview_recreate` warning
// because dependent indexes and grants get blown away.

import { qualifiedName, quoteIdent } from "./helpers";
import type { DdlResult, DdlWarning, MatviewForm } from "./types";

export function generateMatviewDdl(initial: MatviewForm | null, current: MatviewForm): DdlResult {
  if (initial === null) {
    return { sql: createSql(current), warnings: [], errors: [] };
  }

  const warnings: DdlWarning[] = [];
  const bodyChanged = initial.body !== current.body;
  const nameChanged = initial.name !== current.name;
  const withDataChanged = initial.withData !== current.withData;

  if (!bodyChanged && !nameChanged && !withDataChanged) {
    return { sql: "", warnings, errors: [] };
  }

  if (bodyChanged) {
    warnings.push({
      code: "matview_recreate",
      message: "Body change requires DROP + CREATE; dependent indexes will be lost",
    });
    const chunks: string[] = [];
    chunks.push(`DROP MATERIALIZED VIEW IF EXISTS ${qualifiedName(initial.schema, initial.name)};`);
    chunks.push(createSql({ ...current, withData: true }));
    return { sql: chunks.join("\n"), warnings, errors: [] };
  }

  // Body unchanged. Handle rename + withData toggle separately.
  const chunks: string[] = [];
  if (nameChanged) {
    chunks.push(
      `ALTER MATERIALIZED VIEW ${qualifiedName(initial.schema, initial.name)} RENAME TO ${quoteIdent(current.name)};`,
    );
  }
  if (withDataChanged) {
    const ref = qualifiedName(current.schema, current.name);
    chunks.push(
      current.withData
        ? `REFRESH MATERIALIZED VIEW ${ref};`
        : `REFRESH MATERIALIZED VIEW ${ref} WITH NO DATA;`,
    );
  }
  return { sql: chunks.join("\n"), warnings, errors: [] };
}

function createSql(m: MatviewForm): string {
  const ref = qualifiedName(m.schema, m.name);
  return `CREATE MATERIALIZED VIEW ${ref} AS\n${m.body}\n${m.withData ? "WITH DATA" : "WITH NO DATA"};`;
}
