// — pure CREATE OR REPLACE VIEW / ALTER VIEW generator.

import { qualifiedName, quoteIdent } from "./helpers";
import type { DdlResult, ViewForm } from "./types";

export function generateViewDdl(initial: ViewForm | null, current: ViewForm): DdlResult {
  if (initial === null) {
    return { sql: createOrReplace(current), warnings: [], errors: [] };
  }
  if (    initial.body === current.body &&
    initial.name === current.name &&
    initial.schema === current.schema
) {
    return { sql: "", warnings: [], errors: [] };
  }
  const chunks: string[] = [];
  // Rename first so subsequent CREATE OR REPLACE uses the new name.
  if (initial.name !== current.name) {
    chunks.push(      `ALTER VIEW ${qualifiedName(initial.schema, initial.name)} RENAME TO ${quoteIdent(current.name)};`,
);
  }
  chunks.push(createOrReplace(current));
  return { sql: chunks.join("\n"), warnings: [], errors: [] };
}

function createOrReplace(v: ViewForm): string {
  return `CREATE OR REPLACE VIEW ${qualifiedName(v.schema, v.name)} AS\n${v.body};`;
}
