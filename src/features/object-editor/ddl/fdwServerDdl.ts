// — pure CREATE SERVER / ALTER SERVER / USER MAPPING generator.
//
// Postgres allows in-place ALTER for `name`, `version`, `OPTIONS`, and the
// per-role USER MAPPING records. Changing `FOREIGN DATA WRAPPER` or `TYPE`
// requires DROP+CREATE — we surface that as a `fdw_recreate_required` warning.

import { quoteIdent, quoteString } from "./helpers";
import type { DdlResult, DdlWarning, FdwServerForm, KvOptionForm } from "./types";

export function generateFdwServerDdl(
  initial: FdwServerForm | null,
  current: FdwServerForm,
): DdlResult {
  if (!initial) {
    return createDdl(current);
  }
  if (initial.fdwName !== current.fdwName || initial.serverType !== current.serverType) {
    const drop = `DROP SERVER ${quoteIdent(initial.name)} CASCADE;`;
    const create = createDdl(current).sql;
    return {
      sql: [drop, create].filter(Boolean).join("\n"),
      warnings: [
        {
          code: "fdw_recreate_required",
          message:
            "Changing the FDW or server type cannot be done in place — Postgres requires DROP+CREATE. Existing user mappings, foreign tables, and dependent objects on this server will be dropped (CASCADE).",
        },
      ],
      errors: [],
    };
  }
  return alterDdl(initial, current);
}

function createDdl(f: FdwServerForm): DdlResult {
  const lines: string[] = [];
  let head = `CREATE SERVER ${quoteIdent(f.name)}`;
  if (f.serverType) head += ` TYPE ${quoteString(f.serverType)}`;
  if (f.version) head += ` VERSION ${quoteString(f.version)}`;
  head += ` FOREIGN DATA WRAPPER ${quoteIdent(f.fdwName)}`;
  if (f.options.length > 0) head += ` OPTIONS (${formatKvList(f.options)})`;
  head += ";";
  lines.push(head);

  for (const m of f.userMappings) {
    let mapping = `CREATE USER MAPPING FOR ${formatRole(m.roleName)} SERVER ${quoteIdent(f.name)}`;
    if (m.options.length > 0) mapping += ` OPTIONS (${formatKvList(m.options)})`;
    mapping += ";";
    lines.push(mapping);
  }
  return { sql: lines.join("\n"), warnings: [], errors: [] };
}

function alterDdl(initial: FdwServerForm, current: FdwServerForm): DdlResult {
  const stmts: string[] = [];
  const warnings: DdlWarning[] = [];

  if (initial.name !== current.name) {
    stmts.push(`ALTER SERVER ${quoteIdent(initial.name)} RENAME TO ${quoteIdent(current.name)};`);
  }
  if (initial.version !== current.version) {
    stmts.push(
      `ALTER SERVER ${quoteIdent(current.name)} VERSION ${
        current.version ? quoteString(current.version) : "NULL"
      };`,
    );
  }

  const optionDiff = diffKv(initial.options, current.options);
  if (optionDiff.length > 0) {
    stmts.push(`ALTER SERVER ${quoteIdent(current.name)} OPTIONS (${optionDiff.join(", ")});`);
  }

  // User mappings — match by role name (mappings have no rename in PG).
  const initialByRole = new Map(initial.userMappings.map((m) => [m.roleName, m]));
  const currentByRole = new Map(current.userMappings.map((m) => [m.roleName, m]));
  for (const m of current.userMappings) {
    const before = initialByRole.get(m.roleName);
    if (!before) {
      let sql = `CREATE USER MAPPING FOR ${formatRole(m.roleName)} SERVER ${quoteIdent(current.name)}`;
      if (m.options.length > 0) sql += ` OPTIONS (${formatKvList(m.options)})`;
      sql += ";";
      stmts.push(sql);
    } else {
      const diff = diffKv(before.options, m.options);
      if (diff.length > 0) {
        stmts.push(
          `ALTER USER MAPPING FOR ${formatRole(m.roleName)} SERVER ${quoteIdent(current.name)} OPTIONS (${diff.join(", ")});`,
        );
      }
    }
  }
  for (const m of initial.userMappings) {
    if (!currentByRole.has(m.roleName)) {
      stmts.push(
        `DROP USER MAPPING FOR ${formatRole(m.roleName)} SERVER ${quoteIdent(current.name)};`,
      );
    }
  }

  return { sql: stmts.join("\n"), warnings, errors: [] };
}

function formatKvList(opts: KvOptionForm[]): string {
  return opts.map((o) => `${quoteIdent(o.key)} ${quoteString(o.value)}`).join(", ");
}

function diffKv(before: KvOptionForm[], after: KvOptionForm[]): string[] {
  const beforeMap = new Map(before.map((o) => [o.key, o.value]));
  const afterMap = new Map(after.map((o) => [o.key, o.value]));
  const out: string[] = [];
  for (const [k, v] of afterMap) {
    if (!beforeMap.has(k)) out.push(`ADD ${quoteIdent(k)} ${quoteString(v)}`);
    else if (beforeMap.get(k) !== v) out.push(`SET ${quoteIdent(k)} ${quoteString(v)}`);
  }
  for (const k of beforeMap.keys()) {
    if (!afterMap.has(k)) out.push(`DROP ${quoteIdent(k)}`);
  }
  return out;
}

function formatRole(role: string): string {
  return role.toUpperCase() === "PUBLIC" ? "PUBLIC" : quoteIdent(role);
}
