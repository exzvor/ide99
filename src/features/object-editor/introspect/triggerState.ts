// — TriggerDefinition → TriggerForm transform.
//
// Trivial structural mapping — the backend already decoded `tgtype` bits
// into the form-friendly enums (timing/forEach) and split out the events
// + UPDATE OF column list. No UUIDs needed (triggers don't have nested
// items requiring rename detection).

import type { TriggerDefinition } from "../../../lib/tauri";
import type { TriggerForm } from "../ddl/types";

export function fromDefinition(def: TriggerDefinition): TriggerForm {
  return {
    schema: def.schema,
    name: def.name,
    table: { schema: def.tableSchema, name: def.tableName },
    timing: def.timing,
    events: def.events,
    updateColumns: def.updateColumns,
    forEach: def.forEach,
    whenClause: def.whenClause,
    functionRef: { schema: def.functionSchema, name: def.functionName },
    enabled: def.enabled,
  };
}
