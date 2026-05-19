import type { InferredSchema, ProbableType } from "../../../lib/tauri";

export type CompletionPathSeg = { key: string } | { arrayIndex: number } | "arraywildcard";

export type CompletionPath = CompletionPathSeg[];

export interface JsonbCompletion {
  label: string;
  insertText: string;
  detail: string;
  documentation?: string;
  /** Lower tier ranks higher in Monaco's suggestion list. */
  tier: number;
}

/**
 * — pure schema → completion items builder.
 *
 * Given the user's current path through the JSONB column (e.g. typed
 * `data->'preferences'->>'`) and a partial key prefix, return the keys
 * one level deeper that match the prefix, ranked by frequency.
 *
 * Numeric array indices in the input path are normalized to
 * `arraywildcard` for lookup since the analyzer collapses array
 * elements to `[*]`.
 */
export function buildJsonbCompletions(  schema: InferredSchema,
  inputPath: CompletionPath,
  partial: string,
): JsonbCompletion[] {
  const normalized: Array<{ key: string } | "arraywildcard"> = inputPath.map(normalize);
  const lowerPartial = partial.toLowerCase();
  const items: JsonbCompletion[] = [];

  for (const node of schema.nodes) {
    if (node.path.length !== normalized.length + 1) continue;
    if (!pathPrefixMatches(normalized, node.path)) continue;

    const last = node.path[node.path.length - 1];
    if (typeof last !== "object" || !("key" in last)) continue;
    if (!last.key.toLowerCase().startsWith(lowerPartial)) continue;

    const detail = `${labelForKind(node.kind as ProbableType)} (${Math.round(node.freq * 100)}%)`;
    const documentation =
      node.samples.length > 0
        ? `Samples: ${node.samples
            .slice(0, 3)
            .map((s) => JSON.stringify(s))
            .join(", ")}`
        : undefined;

    items.push({
      label: last.key,
      insertText: last.key,
      detail,
      documentation,
      tier: tierOf(node.freq),
    });
  }

  items.sort((a, b) => a.tier - b.tier || a.label.localeCompare(b.label));
  return items;
}

function normalize(seg: CompletionPathSeg): { key: string } | "arraywildcard" {
  if (typeof seg === "string") return seg;
  if ("key" in seg) return seg;
  return "arraywildcard";
}

function pathPrefixMatches(  prefix: Array<{ key: string } | "arraywildcard">,
  target: Array<{ key: string } | "arraywildcard">,
): boolean {
  if (prefix.length > target.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    const a = prefix[i];
    const b = target[i];
    if (a === "arraywildcard" && b === "arraywildcard") continue;
    if (      typeof a === "object" &&
      typeof b === "object" &&
      "key" in a &&
      "key" in b &&
      a.key === b.key
) {
      continue;
    }
    return false;
  }
  return true;
}

function tierOf(freq: number): number {
  if (freq >= 0.5) return 100;
  if (freq >= 0.1) return 200;
  return 300;
}

function labelForKind(kind: ProbableType): string {
  const k = kind as any;
  switch (k.kind) {
    case "primitive":
      return k.value;
    case "enum": {
      const head = k.values.slice(0, 3).join(" | ");
      return `enum: ${head}${k.values.length > 3 ? " | …" : ""}`;
    }
    case "object":
      return "object";
    case "array":
      return `array<${labelForKind(k.element as ProbableType)}>`;
    case "union":
      return (k.variants as ProbableType[]).map(labelForKind).join(" | ");
    default:
      return "";
  }
}
