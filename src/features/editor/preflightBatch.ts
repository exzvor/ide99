/**
 * Post-S14 — pre-execute safety pipeline for multi-statement batches.
 *
 * Three outcomes:
 * - `ok`         : caller may proceed.
 * - `blocked`    : a write was attempted on a read-only connection;
 * `offendingIndex` points at the first such statement.
 * - `cancelled`  : the user dismissed the consolidated confirm modal.
 *
 * Single-statement (N=1) destructive runs delegate to the legacy
 * `preflightSafety` so the existing `ConfirmDestructiveModal` (kind
 * "confirm") and its tests keep working unchanged. Only batches >1
 * trigger the new `kind: "batchConfirm"` modal.
 *
 * The slow-query warning is intentionally skipped for batches >1 — the
 * cost of running EXPLAIN per statement isn't worth it for an MVP.
 * Single-statement runs go through `preflightSafety` which still raises
 * the slow-query modal.
 */

import type { Connection } from "../../lib/tauri";
import { analyzeStatement } from "./safety/analyzer";
// Static (top-level) import is fine despite the apparent
// store ↔ preflightBatch cycle: `preflightSafety` is read off the namespace
// only inside `preflightBatch`'s body, so by the time it executes the
// store module has finished initialising and the binding is live. Avoiding
// the previously-attempted `await import("./store")` matters because each
// extra await tick desyncs the existing safety tests (which only flush one
// microtask before asserting the modal kind).
import { type EditorState, preflightSafety } from "./store";

export type BatchPreflight =
  | { outcome: "ok" }
  | { outcome: "blocked"; offendingIndex: number }
  | { outcome: "cancelled" };

type SetPartial = (partial: Partial<EditorState>) => void;

const isWriteRegex = /^(insert|update|delete|create|alter|drop|truncate|grant|revoke)\b/i;

export async function preflightBatch(  conn: Connection | undefined,
  statements: readonly string[],
  set: SetPartial,
): Promise<BatchPreflight> {
  if (!conn || statements.length === 0) return { outcome: "ok" };

  const analyses = statements.map((s) => analyzeStatement(s));

  // STEP 1: read-only fail-fast. First write — destructive OR plain INSERT/
  // UPDATE/etc. — short-circuits the whole batch.
  if (conn.readOnly) {
    const idx = analyses.findIndex((a, i) => {
      const trimmed = statements[i].trimStart();
      return a.kind === "destructive" || isWriteRegex.test(trimmed);
    });
    if (idx !== -1) return { outcome: "blocked", offendingIndex: idx };
  }

  // STEP 2: destructive consolidated confirm.
  const destructive = analyses
    .map((a, i) => ({ a, i, sql: statements[i] }))
    .filter(({ a }) => a.kind === "destructive");

  const env = conn.environment;
  const triggers =
    env === "prod" || ((env === "dev" || env === "stage") && conn.confirmDestructive);

  if (destructive.length > 0 && triggers) {
    if (statements.length === 1) {
      // Single-statement path: defer to legacy `preflightSafety` so the
      // existing `ConfirmDestructiveModal` (kind: "confirm") and its tests
      // stay green.
      const single = await preflightSafety(conn, statements[0], set);
      if (single === "cancelled") return { outcome: "cancelled" };
      if (single === "read_only_blocked") return { outcome: "blocked", offendingIndex: 0 };
      return { outcome: "ok" };
    }
    const ok = await new Promise<boolean>((resolve) => {
      set({
        safetyModal: {
          kind: "batchConfirm",
          total: statements.length,
          environment: env,
          databaseName: conn.database ?? "",
          destructive: destructive.map(({ i, a, sql }) => ({
            index: i,
            action: (a.action ?? "drop").toUpperCase(),
            target: a.target ?? "",
            snippet: sql.replace(/\s+/g, " ").trim().slice(0, 80),
          })),
          onConfirm: () => {
            set({ safetyModal: { kind: "none" } });
            resolve(true);
          },
          onCancel: () => {
            set({ safetyModal: { kind: "none" } });
            resolve(false);
          },
        },
      });
    });
    if (!ok) return { outcome: "cancelled" };
  } else if (statements.length === 1) {
    // Non-destructive single-statement: still go through `preflightSafety`
    // so the slow-query warning fires. Read-only was already handled above
    // by the fail-fast gate; remaining outcomes are "ok" or "cancelled".
    const single = await preflightSafety(conn, statements[0], set);
    if (single === "cancelled") return { outcome: "cancelled" };
    if (single === "read_only_blocked") return { outcome: "blocked", offendingIndex: 0 };
    return { outcome: "ok" };
  }

  // Slow-query warning is intentionally skipped for batches >1 — see header.
  return { outcome: "ok" };
}
