// — pure CREATE/ALTER SEQUENCE generator.
//
// Defaults (per Postgres `CREATE SEQUENCE` docs):
// - INCREMENT 1
// - MINVALUE 1 (for ascending; NULL means "use Postgres default")
// - MAXVALUE = type-specific upper bound (we treat null as "default", omit)
// - START = MINVALUE for asc / MAXVALUE for desc; null means default, omit
// - CACHE 1
// - NO CYCLE
//
// "Hide default-equal options" rule: when generating CREATE we omit any
// option whose value equals the Postgres default — keeps preview noise low.

import { qualifiedName, quoteIdent } from "./helpers";
import type { DdlResult, SequenceForm } from "./types";

export function generateSequenceDdl(  initial: SequenceForm | null,
  current: SequenceForm,
): DdlResult {
  if (initial === null) {
    return { sql: createSql(current), warnings: [], errors: [] };
  }
  return { sql: diffSql(initial, current), warnings: [], errors: [] };
}

function ref(s: SequenceForm): string {
  return qualifiedName(s.schema, s.name);
}

function createSql(s: SequenceForm): string {
  const parts: string[] = [`CREATE SEQUENCE ${ref(s)}`];
  parts.push(`AS ${s.dataType}`);
  if (s.start !== null) parts.push(`START ${s.start}`);
  if (s.increment !== 1) parts.push(`INCREMENT ${s.increment}`);
  if (s.minValue !== null && s.minValue !== 1) parts.push(`MINVALUE ${s.minValue}`);
  if (s.maxValue !== null) parts.push(`MAXVALUE ${s.maxValue}`);
  if (s.cache !== 1) parts.push(`CACHE ${s.cache}`);
  if (s.cycle) parts.push("CYCLE");
  if (s.ownedBy !== null) {
    parts.push(      `OWNED BY ${qualifiedName(s.ownedBy.schema, s.ownedBy.table)}.${quoteIdent(s.ownedBy.column)}`,
);
  }
  return `${parts.join(" ")};`;
}

function diffSql(a: SequenceForm, b: SequenceForm): string {
  const chunks: string[] = [];
  const oldRef = ref(a);
  // (1) Rename first.
  if (a.name !== b.name) {
    chunks.push(`ALTER SEQUENCE ${oldRef} RENAME TO ${quoteIdent(b.name)};`);
  }
  const newRef = qualifiedName(b.schema, b.name);

  if (a.dataType !== b.dataType) chunks.push(`ALTER SEQUENCE ${newRef} AS ${b.dataType};`);
  if (a.start !== b.start && b.start !== null) {
    chunks.push(`ALTER SEQUENCE ${newRef} START ${b.start};`);
  }
  if (a.increment !== b.increment) {
    chunks.push(`ALTER SEQUENCE ${newRef} INCREMENT ${b.increment};`);
  }
  if (a.minValue !== b.minValue) {
    chunks.push(      `ALTER SEQUENCE ${newRef} ${b.minValue === null ? "NO MINVALUE" : `MINVALUE ${b.minValue}`};`,
);
  }
  if (a.maxValue !== b.maxValue) {
    chunks.push(      `ALTER SEQUENCE ${newRef} ${b.maxValue === null ? "NO MAXVALUE" : `MAXVALUE ${b.maxValue}`};`,
);
  }
  if (a.cache !== b.cache) chunks.push(`ALTER SEQUENCE ${newRef} CACHE ${b.cache};`);
  if (a.cycle !== b.cycle) {
    chunks.push(`ALTER SEQUENCE ${newRef} ${b.cycle ? "CYCLE" : "NO CYCLE"};`);
  }
  if (JSON.stringify(a.ownedBy) !== JSON.stringify(b.ownedBy)) {
    if (b.ownedBy === null) {
      chunks.push(`ALTER SEQUENCE ${newRef} OWNED BY NONE;`);
    } else {
      chunks.push(        `ALTER SEQUENCE ${newRef} OWNED BY ${qualifiedName(b.ownedBy.schema, b.ownedBy.table)}.${quoteIdent(b.ownedBy.column)};`,
);
    }
  }
  return chunks.join("\n");
}
