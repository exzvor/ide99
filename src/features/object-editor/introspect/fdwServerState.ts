// — FdwServerDefinitionDto → FdwServerForm transform.
//
// Stamps stable UUIDs onto options and user-mapping rows so the editor's
// form-state diff can detect rename vs. drop+add. The backend payload is
// serialized from pg_foreign_server / pg_user_mapping; we normalize the
// optional fields to either a string or undefined/null per FdwServerForm.

import type { FdwServerDefinitionDto } from "../../../lib/tauri";
import type { FdwServerForm } from "../ddl/types";

export function fromDefinition(def: FdwServerDefinitionDto): FdwServerForm {
  return {
    name: def.name,
    fdwName: def.fdwName,
    serverType: def.serverType ?? undefined,
    version: def.version ?? undefined,
    options: def.options.map((o) => ({
      id: crypto.randomUUID(),
      key: o.key,
      value: o.value,
    })),
    userMappings: def.userMappings.map((m) => ({
      id: crypto.randomUUID(),
      roleName: m.roleName,
      options: m.options.map((o) => ({
        id: crypto.randomUUID(),
        key: o.key,
        value: o.value,
      })),
    })),
    comment: def.comment ?? null,
  };
}
