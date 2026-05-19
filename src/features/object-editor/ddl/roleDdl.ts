// — pure CREATE ROLE / ALTER ROLE generator.
//
// Postgres roles carry several boolean attribute pairs (LOGIN/NOLOGIN,
// SUPERUSER/NOSUPERUSER, …). On CREATE we emit them all explicitly so the
// resulting role state matches the form exactly. On ALTER we only emit the
// attribute statements that diverge from the introspected state.
//
// Password handling: when the user has typed a password (or pasted a hash) we
// emit ALTER ROLE PASSWORD plus a `role_password_visible` warning so the
// editor can advise the user not to commit the DDL preview.

import { quoteIdent, quoteString } from "./helpers";
import type { DdlResult, DdlWarning, RoleForm } from "./types";

export function generateRoleDdl(initial: RoleForm | null, current: RoleForm): DdlResult {
  if (!initial) return createDdl(current);
  return alterDdl(initial, current);
}

function createDdl(f: RoleForm): DdlResult {
  const attrs: string[] = [];
  attrs.push(f.login ? "LOGIN" : "NOLOGIN");
  attrs.push(f.superuser ? "SUPERUSER" : "NOSUPERUSER");
  attrs.push(f.createdb ? "CREATEDB" : "NOCREATEDB");
  attrs.push(f.createrole ? "CREATEROLE" : "NOCREATEROLE");
  attrs.push(f.replication ? "REPLICATION" : "NOREPLICATION");
  attrs.push(f.bypassrls ? "BYPASSRLS" : "NOBYPASSRLS");
  attrs.push(f.inherit ? "INHERIT" : "NOINHERIT");
  attrs.push(`CONNECTION LIMIT ${f.connectionLimit}`);
  if (f.password) {
    const kw = f.passwordIsHash ? "ENCRYPTED PASSWORD" : "PASSWORD";
    attrs.push(`${kw} ${quoteString(f.password)}`);
  }
  if (f.validUntil) attrs.push(`VALID UNTIL ${quoteString(f.validUntil)}`);
  const lines: string[] = [`CREATE ROLE ${quoteIdent(f.name)} WITH ${attrs.join(" ")};`];
  for (const parent of f.memberOf) {
    lines.push(`GRANT ${quoteIdent(parent)} TO ${quoteIdent(f.name)};`);
  }
  const warnings: DdlWarning[] = f.password
    ? [{ code: "role_password_visible", message: "Password visible in DDL preview." }]
    : [];
  return { sql: lines.join("\n"), warnings, errors: [] };
}

function alterDdl(initial: RoleForm, current: RoleForm): DdlResult {
  const stmts: string[] = [];
  const warnings: DdlWarning[] = [];
  const name = quoteIdent(current.name);
  if (initial.name !== current.name) {
    stmts.push(`ALTER ROLE ${quoteIdent(initial.name)} RENAME TO ${quoteIdent(current.name)};`);
  }
  const togglePairs: Array<[keyof RoleForm, string, string]> = [
    ["login", "LOGIN", "NOLOGIN"],
    ["superuser", "SUPERUSER", "NOSUPERUSER"],
    ["createdb", "CREATEDB", "NOCREATEDB"],
    ["createrole", "CREATEROLE", "NOCREATEROLE"],
    ["replication", "REPLICATION", "NOREPLICATION"],
    ["bypassrls", "BYPASSRLS", "NOBYPASSRLS"],
    ["inherit", "INHERIT", "NOINHERIT"],
  ];
  for (const [key, on, off] of togglePairs) {
    if ((initial as Record<string, unknown>)[key] !== (current as Record<string, unknown>)[key]) {
      const verb = (current as Record<string, unknown>)[key] ? on : off;
      stmts.push(`ALTER ROLE ${name} ${verb};`);
    }
  }
  if (initial.connectionLimit !== current.connectionLimit) {
    stmts.push(`ALTER ROLE ${name} CONNECTION LIMIT ${current.connectionLimit};`);
  }
  if (initial.validUntil !== current.validUntil) {
    if (current.validUntil) {
      stmts.push(`ALTER ROLE ${name} VALID UNTIL ${quoteString(current.validUntil)};`);
    } else {
      stmts.push(`ALTER ROLE ${name} VALID UNTIL 'infinity';`);
    }
  }
  if (current.password) {
    const kw = current.passwordIsHash ? "ENCRYPTED PASSWORD" : "PASSWORD";
    stmts.push(`ALTER ROLE ${name} ${kw} ${quoteString(current.password)};`);
    warnings.push({ code: "role_password_visible", message: "Password visible in DDL preview." });
  }
  const beforeMembers = new Set(initial.memberOf);
  const afterMembers = new Set(current.memberOf);
  for (const parent of current.memberOf) {
    if (!beforeMembers.has(parent)) {
      stmts.push(`GRANT ${quoteIdent(parent)} TO ${quoteIdent(current.name)};`);
    }
  }
  for (const parent of initial.memberOf) {
    if (!afterMembers.has(parent)) {
      stmts.push(`REVOKE ${quoteIdent(parent)} FROM ${quoteIdent(current.name)};`);
    }
  }
  return { sql: stmts.join("\n"), warnings, errors: [] };
}
