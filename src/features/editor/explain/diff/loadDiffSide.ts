import { recentPlansGet } from "../../../../lib/tauri";
import type { PlanDiffSide } from "../../store";

export interface LoadedSide {
  planJson: unknown;
  sql: string;
  connectionId: string | null;
  executedAt: string;
  durationMs: number;
  /** Pretty short label for the toolbar — e.g. "ANALYZE · 04-29 14:02 · 142ms". */
  shortLabel: string;
}

/**
 * — distinguishes "this side's recent row vanished" from generic
 * IPC failures so the caller can render a `Plan A/B no longer exists`
 * placeholder rather than a vague error.
 */
export class PlanGoneError extends Error {
  constructor(public readonly side: "left" | "right") {
    super(`PlanGoneError: ${side}`);
    this.name = "PlanGoneError";
  }
}

/**
 * — `JSON.parse` failed for one side's planJson string. Caller
 * renders the `placeholder.parse_error` placeholder.
 */
export class PlanParseError extends Error {
  constructor(public readonly side: "left" | "right") {
    super(`PlanParseError: ${side}`);
    this.name = "PlanParseError";
  }
}

/** Format an ISO timestamp as MM-DD HH:mm in local time. */
function formatHHmm(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${mm}-${dd} ${hh}:${mi}`;
}

function buildShortLabel(mode: string, executedAt: string, durationMs: number): string {
  return `${mode.toUpperCase()} · ${formatHHmm(executedAt)} · ${durationMs}ms`;
}

/**
 * — resolve a PlanDiffSide to a usable plan object.
 *
 * - kind:"recent"   → recentPlansGet(id), throw PlanGoneError on null,
 * PlanParseError on JSON parse failure.
 * - kind:"runtime"  → return as-is. Defensive: parse if `planJson` is
 * a string (it's typed as `unknown`).
 */
export async function loadDiffSide(  side: PlanDiffSide,
  which: "left" | "right",
): Promise<LoadedSide> {
  if (side.kind === "recent") {
    const row = await recentPlansGet(side.recentPlanId);
    if (!row) throw new PlanGoneError(which);
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.planJson);
    } catch {
      throw new PlanParseError(which);
    }
    return {
      planJson: parsed,
      sql: row.sql,
      connectionId: row.connectionId,
      executedAt: row.executedAt,
      durationMs: row.durationMs,
      shortLabel: buildShortLabel(row.mode, row.executedAt, row.durationMs),
    };
  }
  // Runtime — defensive parse if a serialized string was passed in.
  let plan: unknown = side.planJson;
  if (typeof plan === "string") {
    try {
      plan = JSON.parse(plan);
    } catch {
      throw new PlanParseError(which);
    }
  }
  return {
    planJson: plan,
    sql: side.sql,
    connectionId: side.connectionId,
    executedAt: side.executedAt,
    durationMs: side.durationMs,
    shortLabel: buildShortLabel(side.mode, side.executedAt, side.durationMs),
  };
}
