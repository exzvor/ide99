// — MatviewDefinition → MatviewForm transform.
//
// Mirrors viewState. `withData = def.populated`: if the matview is currently
// populated we re-emit `WITH DATA` on apply (preserving state). If it is not
// populated, we still default to `WITH DATA` so a re-apply will populate it
// — rationale: an unpopulated matview is rarely the desired final state, so
// "re-applying without an explicit user toggle" should populate. The user
// can flip the toggle to keep `WITH NO DATA` if needed.

import type { MatviewDefinition } from "../../../lib/tauri";
import type { MatviewForm } from "../ddl/types";

export function fromDefinition(def: MatviewDefinition): MatviewForm {
  return {
    schema: def.schema,
    name: def.name,
    body: def.body,
    withData: def.populated,
  };
}
