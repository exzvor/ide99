// €” Apply path with consistent dirty-reset and schema/ERD
// invalidation across every object editor.
//
// Replaces ad-hoc `await schemaApplyDdl(connId, sql)` calls in 15 editors.
// After the DDL succeeds:
//
// 1. The form's `initial` is set to the current `form` so the editor
// stops showing "dirty" and a subsequent close-tab no longer prompts
// Discard-changes ().
// 2. The ERD store's per-conn cache is invalidated so the diagram
// re-loads on next mount.
// 3. The schema tree is refreshed so the new/edited object becomes
// visible without a manual click.
//
// Errors propagate so the caller's `try/catch` can surface the apply
// failure to the user via `setApply({ phase: "error", message })`.

import { schemaApplyDdl } from "../../../lib/tauri";
import { useErdStore } from "../../erd/store";
import { invalidatePgPartmanCache } from "../../pgpartman";
import { useSchema } from "../../schema/store";
import { invalidateHypertableCache } from "../../timescale";
import { useObjectEditorStore } from "../store";

export async function applyAndRefresh(tabId: string, connId: string, ddl: string): Promise<void> {
  await schemaApplyDdl(connId, ddl);

  // 1) Reset dirty: initial = current snapshot.
  const cur = useObjectEditorStore.getState().formByTab[tabId];
  if (cur) {
    useObjectEditorStore.getState().setForm(tabId, {
      ...cur,
      initial: cur.form,
    } as typeof cur);
  }

  // 2) ERD invalidate (cheap; no-op when no ERD tab exists).
  useErdStore.getState().invalidate(connId);

  // 2.5) S28 â€” invalidate hypertable registry. The apply may have created
  // or dropped a hypertable; the next consumer call (panel mount,
  // badge lookup) will re-load lazily.
  invalidateHypertableCache(connId);

  // 2.6) S29 â€” invalidate pg_partman registry. The apply may have created
  // or dropped a partman parent (via UPDATE partman.part_config or
  // partman.undo_partition). Next consumer call re-loads lazily.
  invalidatePgPartmanCache(connId);

  // 3) Schema tree refresh â€” fire-and-forget so the apply call resolves
  // immediately; the tree updates as the queries return.
  void useSchema.getState().refreshAll();
}
