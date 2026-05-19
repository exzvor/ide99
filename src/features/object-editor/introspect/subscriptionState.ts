// — SubscriptionDefinitionDto → SubscriptionForm transform.
//
// Subscription rows have no per-row collections that need UUIDs; the
// `publications` array is a flat list of publication names which we copy
// defensively so subsequent edits don't mutate the introspected payload.

import type { SubscriptionDefinitionDto } from "../../../lib/tauri";
import type { SubscriptionForm } from "../ddl/types";

export function fromDefinition(def: SubscriptionDefinitionDto): SubscriptionForm {
  return {
    name: def.name,
    conninfo: def.conninfo,
    publications: [...def.publications],
    enabled: def.enabled,
    copyData: def.copyData,
    createSlot: def.createSlot,
    slotName: def.slotName ?? undefined,
    synchronousCommit: def.synchronousCommit ?? undefined,
    comment: def.comment ?? null,
  };
}
