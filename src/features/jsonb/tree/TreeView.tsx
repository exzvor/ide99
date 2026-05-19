import { useVirtualizer } from "@tanstack/react-virtual";
import { type JSX, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Node } from "./Node";
import { deleteAtPath, setAtPath } from "./pathOps";

export interface TreeViewProps {
  value: unknown;
  /** Called with the entire updated value (immutable replacement). */
  onChange: (next: unknown) => void;
  /** When true, edits are blocked (ReadOnly RowKey). */
  readOnly: boolean;
  /** When the column type is "jsonb" (not "json"), shows an inline note
   * about canonical key order. */
  isJsonbType: boolean;
}

interface VisibleNode {
  path: string[];
  keyOrIndex: string;
  value: unknown;
  level: number;
  parentIsArray: boolean;
  hasChildren: boolean;
  expanded: boolean;
  isRoot: boolean;
  setSize: number;
  posInSet: number;
}

const VIRTUALIZE_THRESHOLD = 200;
const ROW_HEIGHT = 28;

function isContainer(v: unknown): boolean {
  return v !== null && typeof v === "object";
}

function flatten(value: unknown, expanded: ReadonlySet<string>): VisibleNode[] {
  const out: VisibleNode[] = [];

  function pathKey(p: ReadonlyArray<string>): string {
    return p.join("");
  }

  function visit(    val: unknown,
    path: string[],
    keyOrIndex: string,
    level: number,
    parentIsArray: boolean,
    setSize: number,
    posInSet: number,
    isRoot: boolean,
): void {
    const container = isContainer(val);
    const hasKids =
      container &&
      (Array.isArray(val) ? (val as unknown[]).length > 0 : Object.keys(val as object).length > 0);
    const isExpanded = isRoot ? true : expanded.has(pathKey(path));

    out.push({
      path: path.slice(),
      keyOrIndex,
      value: val,
      level,
      parentIsArray,
      hasChildren: hasKids,
      expanded: isExpanded,
      isRoot,
      setSize,
      posInSet,
    });

    if (!hasKids || !isExpanded) return;

    if (Array.isArray(val)) {
      const arr = val as unknown[];
      for (let i = 0; i < arr.length; i++) {
        path.push(String(i));
        visit(arr[i], path, `[${i}]`, level + 1, true, arr.length, i + 1, false);
        path.pop();
      }
    } else {
      const obj = val as Record<string, unknown>;
      const keys = Object.keys(obj);
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i] as string;
        path.push(k);
        visit(obj[k], path, k, level + 1, false, keys.length, i + 1, false);
        path.pop();
      }
    }
  }

  visit(value, [], "(root)", 0, false, 1, 1, true);
  return out;
}

export function TreeView({ value, onChange, readOnly, isJsonbType }: TreeViewProps): JSX.Element {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [noteDismissed, setNoteDismissed] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const nodes = useMemo(() => flatten(value, expanded), [value, expanded]);

  const virtualize = nodes.length > VIRTUALIZE_THRESHOLD;
  const virtualizer = useVirtualizer({
    count: nodes.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
    enabled: virtualize,
    // Seed initial rect so the first paint always renders the overscan
    // window — covers headless / jsdom where ResizeObserver doesn't fire
    // and the scroll element reports 0 height.
    initialRect: { width: 720, height: 600 },
    observeElementRect: (instance, cb) => {
      const el = instance.scrollElement as HTMLElement | null;
      if (!el) return () => {};
      const measure = () => {
        const r = el.getBoundingClientRect();
        cb({ width: r.width || 720, height: r.height || 600 });
      };
      measure();
      if (typeof ResizeObserver !== "undefined") {
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
      }
      return () => {};
    },
  });

  function toggleExpand(path: ReadonlyArray<string>): void {
    const key = path.join("");
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function mutate(path: ReadonlyArray<string>, next: unknown): void {
    onChange(setAtPath(value, path, next));
  }

  function remove(path: ReadonlyArray<string>): void {
    onChange(deleteAtPath(value, path));
  }

  function addChild(path: ReadonlyArray<string>, kind: "key" | "item"): void {
    if (kind === "item") {
      const parent = readAtPath(value, path);
      if (!Array.isArray(parent)) return;
      const next = (parent as unknown[]).slice();
      next.push(null);
      onChange(setAtPath(value, path, next));
    } else {
      const parent = readAtPath(value, path);
      if (parent === null || typeof parent !== "object" || Array.isArray(parent)) return;
      const obj = parent as Record<string, unknown>;
      let candidate = "key";
      let i = 1;
      while (candidate in obj) {
        candidate = `key${i++}`;
      }
      const next = { ...obj, [candidate]: null };
      onChange(setAtPath(value, path, next));
      // Ensure newly-added container parent stays expanded.
      const key = path.join("");
      setExpanded((prev) => {
        if (prev.has(key) || path.length === 0) return prev;
        const ns = new Set(prev);
        ns.add(key);
        return ns;
      });
    }
  }

  function renderNode(node: VisibleNode): JSX.Element {
    return (      <Node
        key={node.path.join("") || "(root)"}
        path={node.path}
        keyOrIndex={node.keyOrIndex}
        value={node.value}
        level={node.level}
        parentIsArray={node.parentIsArray}
        hasChildren={node.hasChildren}
        expanded={node.expanded}
        setSize={node.setSize}
        posInSet={node.posInSet}
        readOnly={readOnly}
        isRoot={node.isRoot}
        onToggleExpand={toggleExpand}
        onMutate={mutate}
        onDelete={remove}
        onAddChild={addChild}
      />
);
  }

  return (    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
      }}
      data-testid="jsonb-tree-view"
    >
      {isJsonbType && !noteDismissed ? (        <div
          role="note"
          data-testid="jsonb-tree-canonical-note"
          style={{
            display: "flex",
            gap: 8,
            alignItems: "flex-start",
            padding: "6px 12px",
            background: "var(--bg-sunken, rgba(0,0,0,0.04))",
            borderBottom: "1px solid var(--hairline)",
            color: "var(--ink-3)",
            fontSize: 11,
            fontFamily: "var(--font-sans-q, sans-serif)",
          }}
        >
          <span style={{ flex: 1 }}>{t("jsonb.tree.canonicalNote")}</span>
          <button
            type="button"
            aria-label="dismiss"
            onClick={() => setNoteDismissed(true)}
            style={{
              background: "transparent",
              border: 0,
              cursor: "pointer",
              color: "var(--ink-4)",
              padding: 0,
              fontSize: 12,
            }}
          >
            ×
          </button>
        </div>
) : null}

      <div
        ref={containerRef}
        role="tree"
        aria-label="jsonb tree"
        data-testid="jsonb-tree-root"
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          position: "relative",
        }}
      >
        {virtualize ? (          <div
            style={{
              height: virtualizer.getTotalSize(),
              position: "relative",
              width: "100%",
            }}
          >
            {virtualizer.getVirtualItems().map((vi) => {
              const node = nodes[vi.index];
              if (!node) return null;
              return (                <div
                  key={vi.key}
                  data-testid="jsonb-tree-virtual-row"
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    transform: `translateY(${vi.start}px)`,
                  }}
                >
                  {renderNode(node)}
                </div>
);
            })}
          </div>
) : (          nodes.map((node) => renderNode(node))
)}
      </div>
    </div>
);
}

function readAtPath(value: unknown, path: ReadonlyArray<string>): unknown {
  let cur: unknown = value;
  for (const seg of path) {
    if (Array.isArray(cur)) cur = cur[Number(seg)];
    else if (cur !== null && typeof cur === "object") cur = (cur as Record<string, unknown>)[seg];
    else return undefined;
  }
  return cur;
}
