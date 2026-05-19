// — ViewDefinition → ViewForm transform.
//
// Trivial passthrough — view editing  is body-only.

import type { ViewDefinition } from "../../../lib/tauri";
import type { ViewForm } from "../ddl/types";

export function fromDefinition(def: ViewDefinition): ViewForm {
  return {
    schema: def.schema,
    name: def.name,
    body: def.body,
  };
}
