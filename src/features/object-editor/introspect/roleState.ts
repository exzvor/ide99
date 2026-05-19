// — RoleDefinitionDto → RoleForm transform.
//
// Postgres never returns the password hash through pg_authid for security
// reasons (and rolpassword is gated behind superuser-only access regardless).
// We treat the introspected payload as a "no-password" baseline: the editor
// must explicitly set a new password to alter it. `passwordIsHash` defaults to
// false so the user can opt in to providing an existing SCRAM/MD5 string.

import type { RoleDefinitionDto } from "../../../lib/tauri";
import type { RoleForm } from "../ddl/types";

export function fromDefinition(def: RoleDefinitionDto): RoleForm {
  return {
    name: def.name,
    login: def.login,
    superuser: def.superuser,
    createdb: def.createdb,
    createrole: def.createrole,
    replication: def.replication,
    bypassrls: def.bypassrls,
    inherit: def.inherit,
    connectionLimit: def.connectionLimit,
    validUntil: def.validUntil ?? undefined,
    password: undefined,
    passwordIsHash: false,
    memberOf: [...def.memberOf],
    comment: def.comment ?? null,
  };
}
