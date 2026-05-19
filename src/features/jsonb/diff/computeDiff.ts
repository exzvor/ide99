import type { JsonbDiff, JsonbOp } from "../../../lib/tauri";

export const DIFF_OPS_THRESHOLD = 8;

type JsonValue = null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue };

function typeTag(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

/** Mirror of `src-tauri/src/query/jsonb.rs::compute_diff`. The 200-case
 * fast-check property test in the matching test file enforces parity at the
 * algorithmic level (round-trip + identical → empty). Threshold = 8 leaves;
 * array length change at any depth → fullReplace; root type change →
 * fullReplace; root scalar change → fullReplace. */
export function computeDiff(oldValue: unknown, newValue: unknown): JsonbDiff {
  const oldTag = typeTag(oldValue);
  const newTag = typeTag(newValue);

  // Root type mismatch → full replace.
  if (oldTag !== newTag) {
    return { ops: [], fullReplace: true, fullValue: newValue };
  }

  // Scalars (incl. null) at root.
  if (oldTag !== "object" && oldTag !== "array") {
    if (oldValue === newValue) return { ops: [], fullReplace: false };
    return { ops: [], fullReplace: true, fullValue: newValue };
  }

  const ops: JsonbOp[] = [];
  let overflow = false;

  function walk(path: string[], a: JsonValue, b: JsonValue): void {
    if (overflow) return;
    const ta = typeTag(a);
    const tb = typeTag(b);

    // Type mismatch at this leaf → set whole subtree.
    if (ta !== tb) {
      ops.push({ kind: "set", path: path.slice(), value: b });
      if (ops.length > DIFF_OPS_THRESHOLD) overflow = true;
      return;
    }

    if (ta === "array") {
      const aa = a as JsonValue[];
      const bb = b as JsonValue[];
      // Array length change → full replace (paths under arrays of changed
      // length are unstable).
      if (aa.length !== bb.length) {
        overflow = true;
        return;
      }
      for (let i = 0; i < aa.length; i++) {
        path.push(String(i));
        walk(path, aa[i] as JsonValue, bb[i] as JsonValue);
        path.pop();
        if (overflow) return;
      }
      return;
    }

    if (ta === "object") {
      const ao = a as Record<string, JsonValue>;
      const bo = b as Record<string, JsonValue>;
      for (const k of Object.keys(ao)) {
        path.push(k);
        if (k in bo) {
          walk(path, ao[k] as JsonValue, bo[k] as JsonValue);
        } else {
          ops.push({ kind: "delete", path: path.slice() });
          if (ops.length > DIFF_OPS_THRESHOLD) overflow = true;
        }
        path.pop();
        if (overflow) return;
      }
      for (const k of Object.keys(bo)) {
        if (!(k in ao)) {
          path.push(k);
          ops.push({ kind: "set", path: path.slice(), value: bo[k] });
          if (ops.length > DIFF_OPS_THRESHOLD) overflow = true;
          path.pop();
          if (overflow) return;
        }
      }
      return;
    }

    // Scalar leaf — compare bit-exact via JSON serialization.
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      ops.push({ kind: "set", path: path.slice(), value: b });
      if (ops.length > DIFF_OPS_THRESHOLD) overflow = true;
    }
  }

  walk([], oldValue as JsonValue, newValue as JsonValue);

  if (overflow) return { ops: [], fullReplace: true, fullValue: newValue };
  return { ops, fullReplace: false };
}
