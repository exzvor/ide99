// — pure CREATE SUBSCRIPTION / ALTER SUBSCRIPTION generator.
//
// Subscriptions in Postgres carry a `conninfo` string that *typically* contains
// a clear-text password — every CREATE/ALTER that touches `conninfo` must
// surface a `subscription_password_visible` warning so the editor can advise
// the user not to commit the DDL preview to version control. Slot rename is
// not allowed on a running subscription; the editor disallows the change but
// the generator still emits a guard warning instead of silently producing a
// non-applicable DDL.

import { quoteIdent, quoteString } from "./helpers";
import type { DdlResult, DdlWarning, SubscriptionForm } from "./types";

const PASSWORD_NOTICE =
  "-- ⚠ Connection string contains the password in plain text. Do not commit this DDL preview to version control.\n";

export function generateSubscriptionDdl(
  initial: SubscriptionForm | null,
  current: SubscriptionForm,
): DdlResult {
  if (!initial) return createDdl(current);
  return alterDdl(initial, current);
}

function createDdl(f: SubscriptionForm): DdlResult {
  const opts: string[] = [];
  opts.push(`enabled = ${f.enabled}`);
  opts.push(`copy_data = ${f.copyData}`);
  opts.push(`create_slot = ${f.createSlot}`);
  if (f.slotName) opts.push(`slot_name = ${quoteString(f.slotName)}`);
  if (f.synchronousCommit) opts.push(`synchronous_commit = ${quoteString(f.synchronousCommit)}`);
  const sql = `${PASSWORD_NOTICE}CREATE SUBSCRIPTION ${quoteIdent(f.name)}
    CONNECTION ${quoteString(f.conninfo)}
    PUBLICATION ${f.publications.map(quoteIdent).join(", ")}
    WITH (${opts.join(", ")});`;
  return {
    sql,
    warnings: [
      {
        code: "subscription_password_visible",
        message: "Connection string contains password in plain text — do not commit DDL preview.",
      },
    ],
    errors: [],
  };
}

function alterDdl(initial: SubscriptionForm, current: SubscriptionForm): DdlResult {
  const stmts: string[] = [];
  const warnings: DdlWarning[] = [];
  const name = quoteIdent(current.name);

  if (initial.name !== current.name) {
    stmts.push(`ALTER SUBSCRIPTION ${quoteIdent(initial.name)} RENAME TO ${name};`);
  }
  if (initial.enabled !== current.enabled) {
    stmts.push(`ALTER SUBSCRIPTION ${name} ${current.enabled ? "ENABLE" : "DISABLE"};`);
  }
  if (initial.conninfo !== current.conninfo) {
    stmts.push(`ALTER SUBSCRIPTION ${name} CONNECTION ${quoteString(current.conninfo)};`);
    warnings.push({
      code: "subscription_password_visible",
      message: "Updated connection string contains password in plain text.",
    });
  }
  const beforePubs = new Set(initial.publications);
  const afterPubs = new Set(current.publications);
  const toAdd = current.publications.filter((p) => !beforePubs.has(p));
  const toDrop = initial.publications.filter((p) => !afterPubs.has(p));
  if (toAdd.length > 0) {
    stmts.push(`ALTER SUBSCRIPTION ${name} ADD PUBLICATION ${toAdd.map(quoteIdent).join(", ")};`);
  }
  if (toDrop.length > 0) {
    stmts.push(`ALTER SUBSCRIPTION ${name} DROP PUBLICATION ${toDrop.map(quoteIdent).join(", ")};`);
  }
  if (initial.synchronousCommit !== current.synchronousCommit && current.synchronousCommit) {
    stmts.push(
      `ALTER SUBSCRIPTION ${name} SET (synchronous_commit = ${quoteString(current.synchronousCommit)});`,
    );
  }
  if (initial.slotName !== current.slotName) {
    warnings.push({
      code: "subscription_slot_rename_blocked",
      message:
        "Cannot rename slot of running subscription. Disable the subscription first, then rename slot manually.",
    });
  }
  return { sql: stmts.join("\n"), warnings, errors: [] };
}
