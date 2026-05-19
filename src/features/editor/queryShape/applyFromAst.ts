// src/features/editor/queryShape/applyFromAst.ts
//
// Pure decision helper used by the editor store when a fresh parse of the
// SQL editor text arrives. Splitting the decision out of the store keeps
// the side-effect surface tiny and lets us unit-test the diff logic without
// instantiating Zustand.
//
// Three outcomes:
// - "skip-unrepresentable" — parsed query contains a feature we can't
// represent (JOIN, GROUP BY, ...). We surface the snippet via a warning
// bar but DO NOT overwrite the existing shape: clicking back to the
// previous representable text should restore filters intact.
// - "noop-equal" — the parsed shape is structurally identical to the one
// we already have (filters / sort / limit / baseSelect). No state churn.
// - "apply" — replace the stored shape with `parsed`.
import type { QueryShape } from "../../../lib/parser";

export interface ShapeApplyDecision {
  type: "apply" | "skip-unrepresentable" | "noop-equal";
  newShape?: QueryShape;
  unrepresentable?: string;
}

export function decideShapeApply(  current: QueryShape | null,
  parsed: QueryShape,
): ShapeApplyDecision {
  if (parsed.unrepresentableTail) {
    return {
      type: "skip-unrepresentable",
      unrepresentable: parsed.unrepresentableTail,
    };
  }
  if (current && shapesEqual(current, parsed)) {
    return { type: "noop-equal" };
  }
  return { type: "apply", newShape: parsed };
}

/**
 * Compare two shapes ignoring positional metadata (whereSpan, orderBySpan,
 * limitSpan, fromEnd). Spans drift whenever the user adds whitespace, but
 * the visible "shape" is unchanged — re-applying every keystroke would
 * thrash the dropdown UI.
 */
function shapesEqual(a: QueryShape, b: QueryShape): boolean {
  const projA = {
    bs: a.baseSelect,
    fs: a.filters,
    st: a.sort,
    lim: a.limit,
  };
  const projB = {
    bs: b.baseSelect,
    fs: b.filters,
    st: b.sort,
    lim: b.limit,
  };
  return JSON.stringify(projA) === JSON.stringify(projB);
}
