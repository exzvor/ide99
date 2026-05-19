import type { InferredSchema, PathSegment } from "../../../lib/tauri";

export interface TreeNode {
  /** Display label, e.g. "userId", "items[*]", "[*]" (root array). */
  label: string;
  /** Pre-formatted type label, e.g. "string", "enum: a | b | c", "array<object>". */
  typeLabel: string;
  /** Frequency 0..1; UI displays as percentage. */
  freq: number;
  /** Up to 3 sample values for the leaf. */
  samples: unknown[];
  /** Nested children. Empty array = leaf. */
  children: TreeNode[];
  /** Original path through the schema, for stable React keys. */
  path: PathSegment[];
}

export interface Tree {
  /** Top-level rows. The (root) node, if present, is the first child. */
  children: TreeNode[];
}

export function buildTree(schema: InferredSchema): Tree {
  // Synthetic root container; we'll return root.children at the end.
  const root: TreeNode = {
    label: "(root)",
    typeLabel: "",
    freq: 1,
    samples: [],
    children: [],
    path: [],
  };

  // Sort nodes by path length so parents are inserted before their descendants.
  const sorted = [...schema.nodes].sort((a, b) => a.path.length - b.path.length);

  for (const node of sorted) {
    // Cast node to ensure kind is present (guaranteed by schema validation)
    attach(root, node.path, node as { kind: unknown; freq: number; samples: unknown[] });
  }

  return { children: root.children };
}

function attach(  parent: TreeNode,
  path: PathSegment[],
  node: { kind: unknown; freq: number; samples: unknown[] },
): void {
  if (path.length === 0) {
    // Schema has a node at root (e.g. scalar JSONB column).
    parent.typeLabel = labelForKind(node.kind);
    parent.freq = node.freq;
    parent.samples = node.samples;
    return;
  }

  const seg = path[0];
  const tail = path.slice(1);

  let label: string;
  let consumed: PathSegment[];
  let remaining: PathSegment[];

  if (typeof seg === "object" && "key" in seg) {
    // Object key — fold a following arraywildcard into "key[*]".
    label = seg.key;
    consumed = [seg];
    remaining = tail;
    if (remaining.length > 0 && remaining[0] === "arraywildcard") {
      label += "[*]";
      consumed = [...consumed, remaining[0]];
      remaining = remaining.slice(1);
    }
  } else {
    // Bare arraywildcard at root (rare — root is array-typed).
    label = "[*]";
    consumed = [seg];
    remaining = tail;
  }

  let child = parent.children.find((c) => c.label === label);
  if (!child) {
    // Check if we need to upgrade an existing child from "key" to "key[*]"
    const baseLabel = label.endsWith("[*]") ? label.slice(0, -3) : label;
    const existingChild = parent.children.find((c) => c.label === baseLabel);
    if (existingChild && label.endsWith("[*]")) {
      // Upgrade the existing child's label and path
      existingChild.label = label;
      existingChild.path = [...parent.path, ...consumed];
      child = existingChild;
    } else {
      child = {
        label,
        typeLabel: "",
        freq: 0,
        samples: [],
        children: [],
        path: [...parent.path, ...consumed],
      };
      parent.children.push(child);
    }
  }

  if (remaining.length === 0) {
    child.typeLabel = labelForKind(node.kind);
    child.freq = node.freq;
    child.samples = node.samples;
    return;
  }
  attach(child, remaining, node);
}

function labelForKind(kind: unknown): string {
  if (typeof kind !== "object" || kind === null) {
    return "";
  }
  const k = kind as Record<string, unknown>;
  switch (k.kind) {
    case "primitive":
      return String(k.value);
    case "enum": {
      const values = (k.values as unknown[]) || [];
      const head = values.slice(0, 3).map(String).join(" | ");
      return `enum: ${head}${values.length > 3 ? " | …" : ""}`;
    }
    case "object":
      return "object";
    case "array":
      return `array<${labelForKind(k.element)}>`;
    case "union":
      return ((k.variants as unknown[]) || []).map(labelForKind).join(" | ");
    default:
      return "";
  }
}
