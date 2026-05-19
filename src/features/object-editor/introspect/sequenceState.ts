// — SequenceDefinition → SequenceForm transform.
//
// The backend always returns concrete numeric values for start/min/max
// (no nullable boundaries). We surface them verbatim — the form-state allows
// `null` to represent "use Postgres default", so on a fresh `CREATE SEQUENCE`
// the user can clear those fields, but on edit-mode we always carry the
// catalog values so a no-op apply emits no diff.

import type { SequenceDefinition } from "../../../lib/tauri";
import type { SequenceForm } from "../ddl/types";

export function fromDefinition(def: SequenceDefinition): SequenceForm {
  return {
    schema: def.schema,
    name: def.name,
    dataType: def.dataType,
    start: def.start,
    increment: def.increment,
    minValue: def.minValue,
    maxValue: def.maxValue,
    cache: def.cache,
    cycle: def.cycle,
    ownedBy: def.ownedBy,
  };
}
