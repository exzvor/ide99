import { type JSX, useState } from "react";
import { useTranslation } from "react-i18next";
import { LeafEditor, leafDisplay, leafKind } from "./leafEditor";

export interface NodeProps {
  /** Path to this node's value (empty for root). */
  path: ReadonlyArray<string>;
  /** Display key — string for object members, "[N]" for array members,
   * "(root)" for the root node. */
  keyOrIndex: string;
  /** The value at this node. */
  value: unknown;
  /** Depth in the tree (0 for root). Drives ARIA aria-level. */
  level: number;
  /** Whether the parent is an array — controls add/move semantics. */
  parentIsArray: boolean;
  /** Whether this node has expandable children (object/array with members). */
  hasChildren: boolean;
  /** Whether this node is currently expanded. */
  expanded: boolean;
  /** Total visible siblings (for ARIA aria-setsize). */
  setSize: number;
  /** 1-based position among siblings (for ARIA aria-posinset). */
  posInSet: number;
  /** Read-only mode disables every edit affordance. */
  readOnly: boolean;
  /** Whether this node is the root and the parent is the editor (no [×]). */
  isRoot: boolean;

  onToggleExpand: (path: ReadonlyArray<string>) => void;
  onMutate: (path: ReadonlyArray<string>, next: unknown) => void;
  onDelete: (path: ReadonlyArray<string>) => void;
  onAddChild: (path: ReadonlyArray<string>, kind: "key" | "item") => void;
}

/** Single tree-node row — one line in the flattened tree. Pure: no store
 * reads. Wired into TreeView via callbacks. */
export function Node(props: NodeProps): JSX.Element {
  const {
    path,
    keyOrIndex,
    value,
    level,
    hasChildren,
    expanded,
    setSize,
    posInSet,
    readOnly,
    isRoot,
    onToggleExpand,
    onMutate,
    onDelete,
    onAddChild,
  } = props;
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);

  const kind = leafKind(value);
  const isContainer = kind === "container";
  const isArray = Array.isArray(value);

  function typeBadge(): string {
    if (kind === "string") return t("jsonb.tree.type.string");
    if (kind === "number") return t("jsonb.tree.type.number");
    if (kind === "boolean") return t("jsonb.tree.type.boolean");
    if (kind === "null") return t("jsonb.tree.type.null");
    if (isArray) {
      const arr = value as unknown[];
      return t("jsonb.tree.type.array", { count: arr.length });
    }
    return t("jsonb.tree.type.object");
  }

  return (
    <div
      role="treeitem"
      aria-expanded={hasChildren ? expanded : undefined}
      aria-level={level + 1}
      aria-posinset={posInSet}
      aria-setsize={setSize}
      data-testid="jsonb-tree-node"
      data-path={path.join(".")}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        paddingLeft: level * 24,
        height: 28,
        fontFamily: "var(--font-mono-q, monospace)",
        fontSize: 12,
        color: "var(--ink-2)",
        whiteSpace: "nowrap",
      }}
    >
      {/* Drag handle (for array members; rendered but inert for objects /
          read-only / root). */}
      {!readOnly && !isRoot ? (
        <button
          type="button"
          data-testid="jsonb-tree-drag-handle"
          aria-label="drag handle"
          style={{
            cursor: "grab",
            background: "transparent",
            border: 0,
            padding: 0,
            color: "var(--ink-4)",
            userSelect: "none",
            fontSize: 10,
          }}
        >
          ⋮⋮
        </button>
      ) : null}

      {/* Expand/collapse chevron for containers. */}
      {hasChildren ? (
        <button
          type="button"
          aria-label={expanded ? "collapse" : "expand"}
          data-testid="jsonb-tree-chevron"
          onClick={() => onToggleExpand(path)}
          style={{
            background: "transparent",
            border: 0,
            color: "var(--ink-3)",
            cursor: "pointer",
            padding: 0,
            width: 16,
            fontSize: 11,
          }}
        >
          {expanded ? "▾" : "▸"}
        </button>
      ) : (
        <span style={{ width: 16 }} />
      )}

      {/* Key / index. */}
      <span style={{ color: "var(--ink-2)", fontWeight: 500 }} data-testid="jsonb-tree-key">
        {keyOrIndex}
      </span>

      {/* Separator. */}
      {!isRoot ? <span style={{ color: "var(--ink-4)" }}>:</span> : null}

      {/* Value (leaf editor when active, display otherwise). */}
      {!isContainer ? (
        editing && !readOnly ? (
          <LeafEditor
            value={value}
            onCommit={(next) => {
              onMutate(path, next);
              setEditing(false);
            }}
            onCancel={() => setEditing(false)}
            testid="jsonb-tree-leaf-input"
          />
        ) : (
          <button
            type="button"
            data-testid="jsonb-tree-leaf-value"
            disabled={readOnly}
            onClick={() => setEditing(true)}
            style={{
              background: "transparent",
              border: 0,
              padding: 0,
              color: "var(--ink-1)",
              cursor: readOnly ? "default" : "pointer",
              fontFamily: "inherit",
              fontSize: "inherit",
            }}
          >
            {leafDisplay(value)}
          </button>
        )
      ) : null}

      {/* Type badge. */}
      <span
        data-testid="jsonb-tree-type-badge"
        style={{
          color: "var(--ink-4)",
          fontFamily: "var(--font-sans-q, sans-serif)",
          fontSize: 10,
          marginLeft: 4,
        }}
      >
        ({typeBadge()})
      </span>

      {/* Hover/focus actions. */}
      {!readOnly ? (
        <span style={{ marginLeft: "auto", display: "flex", gap: 4, paddingRight: 8 }}>
          {isContainer ? (
            <button
              type="button"
              data-testid="jsonb-tree-add-child"
              onClick={() => onAddChild(path, isArray ? "item" : "key")}
              style={chipBtn}
            >
              {isArray ? t("jsonb.tree.addItem") : t("jsonb.tree.addKey")}
            </button>
          ) : null}
          {!isRoot ? (
            <button
              type="button"
              data-testid="jsonb-tree-delete"
              aria-label={t("jsonb.tree.delete")}
              onClick={() => onDelete(path)}
              style={chipBtn}
            >
              ×
            </button>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

const chipBtn: React.CSSProperties = {
  background: "transparent",
  border: "1px solid var(--hairline)",
  padding: "0 6px",
  fontSize: 10,
  color: "var(--ink-3)",
  cursor: "pointer",
  height: 18,
  lineHeight: "16px",
  fontFamily: "var(--font-sans-q, sans-serif)",
};
