// — pure CREATE PUBLICATION / ALTER PUBLICATION generator.
//
// Postgres publications partition into three target modes — `all_tables`,
// `schemas` (FOR TABLES IN SCHEMA …), and `tables` (FOR TABLE …). Switching
// between modes is not in-place — it requires DROP+CREATE.

import { quoteIdent } from "./helpers";
import type { DdlResult, DdlWarning, PublicationForm, QualifiedNameForm } from "./types";

export function generatePublicationDdl(  initial: PublicationForm | null,
  current: PublicationForm,
): DdlResult {
  if (!initial) return createDdl(current);
  if (initial.mode !== current.mode) return recreateDdl(initial, current);
  return alterDdl(initial, current);
}

function createDdl(f: PublicationForm): DdlResult {
  const head = `CREATE PUBLICATION ${quoteIdent(f.name)} ${formatTarget(f)}`;
  const withClause = withClauseFor(f);
  const sql = withClause ? `${head} ${withClause};` : `${head};`;
  return { sql, warnings: [], errors: [] };
}

function recreateDdl(initial: PublicationForm, current: PublicationForm): DdlResult {
  const drop = `DROP PUBLICATION ${quoteIdent(initial.name)};`;
  const create = createDdl(current).sql;
  return {
    sql: `${drop}\n${create}`,
    warnings: [
      {
        code: "publication_recreate_required",
        message:
          "Switching publication target mode (FOR ALL TABLES / TABLES IN SCHEMA / TABLE list) requires DROP+CREATE.",
      },
    ],
    errors: [],
  };
}

function alterDdl(initial: PublicationForm, current: PublicationForm): DdlResult {
  const stmts: string[] = [];
  const warnings: DdlWarning[] = [];
  if (initial.name !== current.name) {
    stmts.push(      `ALTER PUBLICATION ${quoteIdent(initial.name)} RENAME TO ${quoteIdent(current.name)};`,
);
  }

  const name = quoteIdent(current.name);

  if (current.mode === "tables") {
    const beforeKey = (q: QualifiedNameForm) => `${q.schema}.${q.name}`;
    const beforeSet = new Set(initial.tables.map(beforeKey));
    const afterSet = new Set(current.tables.map(beforeKey));
    const toAdd = current.tables.filter((q) => !beforeSet.has(beforeKey(q)));
    const toDrop = initial.tables.filter((q) => !afterSet.has(beforeKey(q)));
    if (toAdd.length > 0) {
      stmts.push(`ALTER PUBLICATION ${name} ADD TABLE ${toAdd.map(formatQualified).join(", ")};`);
    }
    if (toDrop.length > 0) {
      stmts.push(`ALTER PUBLICATION ${name} DROP TABLE ${toDrop.map(formatQualified).join(", ")};`);
    }
  }

  if (current.mode === "schemas") {
    const before = new Set(initial.schemas);
    const after = new Set(current.schemas);
    const toAdd = current.schemas.filter((s) => !before.has(s));
    const toDrop = initial.schemas.filter((s) => !after.has(s));
    if (toAdd.length > 0) {
      stmts.push(        `ALTER PUBLICATION ${name} ADD TABLES IN SCHEMA ${toAdd.map(quoteIdent).join(", ")};`,
);
    }
    if (toDrop.length > 0) {
      stmts.push(        `ALTER PUBLICATION ${name} DROP TABLES IN SCHEMA ${toDrop.map(quoteIdent).join(", ")};`,
);
    }
  }

  const opsBefore = formatPublishOps(initial);
  const opsAfter = formatPublishOps(current);
  if (opsBefore !== opsAfter) {
    stmts.push(`ALTER PUBLICATION ${name} SET (publish = '${opsAfter}');`);
  }
  if (initial.publishViaPartitionRoot !== current.publishViaPartitionRoot) {
    stmts.push(      `ALTER PUBLICATION ${name} SET (publish_via_partition_root = ${current.publishViaPartitionRoot});`,
);
  }

  return { sql: stmts.join("\n"), warnings, errors: [] };
}

function formatTarget(f: PublicationForm): string {
  if (f.mode === "all_tables") return "FOR ALL TABLES";
  if (f.mode === "schemas") return `FOR TABLES IN SCHEMA ${f.schemas.map(quoteIdent).join(", ")}`;
  return `FOR TABLE ${f.tables.map(formatQualified).join(", ")}`;
}

function formatQualified(q: QualifiedNameForm): string {
  return `${quoteIdent(q.schema)}.${quoteIdent(q.name)}`;
}

function formatPublishOps(f: PublicationForm): string {
  const ops: string[] = [];
  if (f.publishInsert) ops.push("insert");
  if (f.publishUpdate) ops.push("update");
  if (f.publishDelete) ops.push("delete");
  if (f.publishTruncate) ops.push("truncate");
  return ops.join(",");
}

function withClauseFor(f: PublicationForm): string {
  const parts: string[] = [];
  const ops = formatPublishOps(f);
  if (ops !== "insert,update,delete,truncate") parts.push(`publish = '${ops}'`);
  if (f.publishViaPartitionRoot) parts.push("publish_via_partition_root = true");
  return parts.length > 0 ? `WITH (${parts.join(", ")})` : "";
}
