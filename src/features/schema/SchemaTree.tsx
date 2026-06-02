import {
  ChevronDown,
  ChevronRight,
  Clock,
  Columns,
  Database,
  Eye,
  Folder,
  Layers,
  Table2,
} from "lucide-react";
import {
  type CSSProperties,
  type JSX,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { type NodeApi, Tree } from "react-arborist";
import { useTranslation } from "react-i18next";
import { formatHotkey } from "../../lib/platform";
import { ConceptTooltip } from "../concept-tooltips";
import { InferredSchemaPanel } from "../jsonb/panels/InferredSchemaPanel";
import { usePgPartman } from "../pgpartman";
import { useTimescale } from "../timescale";
import { isJsonbType } from "./jsonbDetect";
import { type NodeChild, type NodeKey, type NodeKind, useSchema } from "./store";

/**
 * react-arborist tree wrapper for the schema browser (spec §7.3).
 *
 * The store owns the cache; this component projects `cache` into the
 * recursive shape react-arborist expects. Cache misses produce nodes whose
 * `children` is an empty array — react-arborist still renders them as
 * expandable folders, and our `onToggle` handler kicks off `loadChildren`
 * the first time a user expands one.
 *
 * The right-click context menu is rendered inline next to the row (spec §5.7);
 * placeholder items are disabled with a "Coming in S{N}" tooltip.
 */

interface TreeNode {
  id: NodeKey;
  /** Already-localized display name. */
  name: string;
  kind: NodeKind;
  /** Empty array = expandable but children not yet loaded. */
  children: TreeNode[];
  /**
   * Set for column nodes (S16). Carries the Postgres data type string so
   * the renderer can gate the JSONB inferred-schema chevron without a
   * separate fetch.
   */
  dataType?: string;
  /**
   * Mirrors NodeChild.hasChildren so Row can decide whether to trigger
   * onToggle (which calls loadChildren). Without this we'd have to use
   * node.isLeaf from react-arborist, which is false for empty arrays.
   */
  hasChildren: boolean;
}

/**
 * Roots of the disabled-with-sprint-tooltip context items per spec §5.7.
 *
 * `S{{sprint}}` substitution is interpolated by i18next.
 */
const PENDING_MENU_ITEMS = [
  { key: "view_data", labelKey: "schema.tree.menu.view_data", sprint: 4, tableOnly: false },
  { key: "drop", labelKey: "schema.tree.menu.drop", sprint: 23, tableOnly: false },
  { key: "truncate", labelKey: "schema.tree.menu.truncate", sprint: 23, tableOnly: true },
  {
    key: "generate_insert",
    labelKey: "schema.tree.menu.generate_insert",
    sprint: 4,
    tableOnly: false,
  },
] as const;

/**
 * Recursively project a NodeChild list into TreeNode form by walking the
 * cache. Synthetic group node names are translated here at the call site.
 */
function buildTreeNodes(
  rootKey: NodeKey,
  cache: Map<NodeKey, NodeChild[]>,
  translate: (key: string) => string,
): TreeNode[] {
  const children = cache.get(rootKey);
  if (children === undefined) return [];
  return children.map((child) => {
    const displayName =
      child.kind === "tables-group" ||
      child.kind === "views-group" ||
      child.kind === "matviews-group"
        ? translate(child.name)
        : child.name;
    return {
      id: child.id,
      name: displayName,
      kind: child.kind,
      children: child.hasChildren ? buildTreeNodes(child.id, cache, translate) : [],
      dataType: child.dataType,
      hasChildren: child.hasChildren,
    };
  });
}

function iconForKind(kind: NodeKind): JSX.Element | null {
  const props = { size: 13, "aria-hidden": true as const, style: { color: "var(--ink-4)" } };
  switch (kind) {
    case "schema":
      return <Database {...props} />;
    case "tables-group":
      return <Folder {...props} />;
    case "views-group":
      return <Folder {...props} />;
    case "matviews-group":
      return <Folder {...props} />;
    case "table":
      return <Table2 {...props} />;
    case "view":
      return <Eye {...props} />;
    case "matview":
      return <Layers {...props} />;
    case "column":
      return <Columns {...props} />;
  }
}

/**
 * Splits a `table:schema/name`, `view:schema/name`, or `matview:schema/name`
 * key back into its parts. Returns `null` for any key that isn't a leaf
 * table/view/matview.
 */
function parseLeafKey(key: NodeKey): { schema: string; name: string } | null {
  const sep = key.indexOf(":");
  if (sep === -1) return null;
  const prefix = key.slice(0, sep);
  if (prefix !== "table" && prefix !== "view" && prefix !== "matview") return null;
  const slash = key.indexOf("/", sep);
  if (slash === -1) return null;
  return {
    schema: key.slice(sep + 1, slash),
    name: key.slice(slash + 1),
  };
}

/**
 * schema-node id format is `schema:public` (no nested separator).
 * Returns the schema name from the key.
 */
function parseSchemaKey(key: NodeKey): string | null {
  if (!key.startsWith("schema:")) return null;
  return key.slice("schema:".length);
}

/**
 * Splits a `column:schema/table/colname` key into its parts.
 * Returns `null` for any key that isn't a column node.
 */
function parseColumnKey(key: NodeKey): { schema: string; table: string; column: string } | null {
  if (!key.startsWith("column:")) return null;
  const rest = key.slice("column:".length);
  const firstSlash = rest.indexOf("/");
  const lastSlash = rest.lastIndexOf("/");
  if (firstSlash === -1 || lastSlash === firstSlash) return null;
  return {
    schema: rest.slice(0, firstSlash),
    table: rest.slice(firstSlash + 1, lastSlash),
    column: rest.slice(lastSlash + 1),
  };
}

interface ContextMenuState {
  x: number;
  y: number;
  nodeId: NodeKey;
  nodeKind: NodeKind;
  isJsonb?: boolean;
}

interface RowProps {
  node: NodeApi<TreeNode>;
  style: CSSProperties;
  dragHandle?: (el: HTMLDivElement | null) => void;
  onSelect: (key: NodeKey, kind: NodeKind) => void;
  onToggle: (key: NodeKey) => void;
  onContext: (state: ContextMenuState) => void;
  onJsonbToggle: (key: string) => void;
  expandedJsonbColumnKey: string | null;
  connId: string | null;
}

function Row({
  node,
  style,
  dragHandle,
  onSelect,
  onToggle,
  onContext,
  onJsonbToggle,
  expandedJsonbColumnKey,
  connId,
}: RowProps): JSX.Element {
  const { t } = useTranslation();
  const { kind } = node.data;
  // Column nodes are leaves — their only interaction is the JSONB chevron.
  // Tables and views can now be expanded (to show columns) AND selected.
  // Schema/group nodes are tree-expandable only (no select).
  const isTreeExpandable = kind !== "column";

  const handleClick = (e: ReactMouseEvent) => {
    e.stopPropagation();
    if (kind === "column") {
      // column rows: click is a no-op; only the JSONB chevron toggles the panel
      return;
    }
    if (kind === "table" || kind === "view" || kind === "matview") {
      // Tables and views: select the node AND toggle column expansion.
      // Only call onToggle (which triggers loadChildren) if the node is a
      // non-leaf in the tree — i.e., the cache already knows it has children.
      // react-arborist marks a node as a leaf when its children array is empty;
      // in that case, toggling is a no-op and we should not call loadChildren.
      onSelect(node.id, kind);
      if (node.data.hasChildren) {
        node.toggle();
        onToggle(node.id);
      }
    } else {
      // Schema / tables-group / views-group / matviews-group: tree expand only.
      node.toggle();
      onToggle(node.id);
    }
  };

  const handleContextMenu = (e: ReactMouseEvent) => {
    // schema nodes are now actionable too (New table / view / matview / sequence).
    if (kind !== "table" && kind !== "view" && kind !== "column" && kind !== "schema") return;
    // Only open context menu for column nodes that are JSONB.
    if (kind === "column" && !isJsonb) return;
    e.preventDefault();
    onContext({
      x: e.clientX,
      y: e.clientY,
      nodeId: node.id,
      nodeKind: kind,
      isJsonb: kind === "column" ? isJsonb : false,
    });
  };

  // "isLeaf" is used only to apply the "ident" CSS class — originally tables/views
  // were leaves; they still get the same class treatment.
  const isLeaf = kind === "table" || kind === "view" || kind === "matview";
  const isColumn = kind === "column";

  // S28 — hypertable badge: looks up isHypertable in useTimescale's per-conn map.
  const hypertableInfo = useTimescale((s) => {
    if (kind !== "table" || connId === null) return null;
    const parsed = parseLeafKey(node.id);
    if (parsed === null) return null;
    return s.hypertables.get(connId)?.get(`${parsed.schema}/${parsed.name}`) ?? null;
  });

  // S29 — partman parent badge.
  const partmanInfo = usePgPartman((s) => {
    if (kind !== "table" || connId === null) return null;
    const parsed = parseLeafKey(node.id);
    if (parsed === null) return null;
    return s.parents.get(connId)?.get(`${parsed.schema}/${parsed.name}`) ?? null;
  });

  // JSONB column chevron state (S16).
  const isJsonb = isColumn && node.data.dataType !== undefined && isJsonbType(node.data.dataType);
  // Derive (schema, table, column) from the node id: "column:schema/table/colname"
  const fqnKey = (() => {
    if (!isJsonb) return "";
    const rest = node.id.startsWith("column:") ? node.id.slice("column:".length) : "";
    const firstSlash = rest.indexOf("/");
    const lastSlash = rest.lastIndexOf("/");
    if (firstSlash === -1 || lastSlash === firstSlash) return "";
    const schema = rest.slice(0, firstSlash);
    const table = rest.slice(firstSlash + 1, lastSlash);
    const column = rest.slice(lastSlash + 1);
    return `${connId}::${schema}::${table}::${column}`;
  })();
  const jsonbExpanded = isJsonb && fqnKey !== "" && expandedJsonbColumnKey === fqnKey;

  return (
    <div
      ref={dragHandle}
      style={style}
      role="treeitem"
      aria-selected={node.isSelected}
      aria-expanded={
        isTreeExpandable && kind !== "table" && kind !== "view" ? node.isOpen : undefined
      }
      tabIndex={node.isFocused ? 0 : -1}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleClick(e as unknown as ReactMouseEvent);
        }
      }}
      onContextMenu={handleContextMenu}
      data-node-kind={kind}
      data-testid={`schema-tree-row-${node.id}`}
      className={`q-tree-row ${node.isSelected ? "selected" : ""}`}
    >
      <span className="caret">
        {isTreeExpandable && ((kind !== "table" && kind !== "view") || node.data.hasChildren) ? (
          node.isOpen ? (
            <ChevronDown size={11} aria-hidden="true" />
          ) : (
            <ChevronRight size={11} aria-hidden="true" />
          )
        ) : null}
      </span>
      <span className="icon">{iconForKind(kind)}</span>
      <span
        className={isLeaf ? "ident" : ""}
        style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}
      >
        {node.data.name}
      </span>
      {hypertableInfo !== null && (
        <span
          title={t("schema.tree.badge.hypertable")}
          aria-label={t("schema.tree.badge.hypertable")}
          style={{
            display: "inline-flex",
            marginLeft: 4,
            color: "var(--accent, #4080ff)",
            flexShrink: 0,
          }}
          data-testid={`schema-tree-hypertable-badge-${node.id}`}
        >
          <Clock size={11} aria-hidden="true" />
        </span>
      )}
      {partmanInfo !== null && (
        <span
          title={t("schema.tree.badge.partman")}
          aria-label={t("schema.tree.badge.partman")}
          style={{
            display: "inline-flex",
            marginLeft: 4,
            color: "var(--accent, #4080ff)",
            flexShrink: 0,
          }}
          data-testid={`schema-tree-partman-badge-${node.id}`}
        >
          <Layers size={11} aria-hidden="true" />
        </span>
      )}
      {isColumn &&
        node.data.dataType &&
        // — when the column type is a recognised concept (currently
        // only `jsonb`), wrap the type label in a ConceptTooltip so Easy mode
        // users can hover for an explanation. Standard mode is a no-op.
        (isJsonb ? (
          <ConceptTooltip id="jsonb" showHelpIcon={false}>
            <span
              style={{ fontSize: 10, color: "var(--ink-4)", marginRight: 4, flexShrink: 0 }}
              aria-label={`type: ${node.data.dataType}`}
            >
              {node.data.dataType}
            </span>
          </ConceptTooltip>
        ) : (
          <span
            style={{ fontSize: 10, color: "var(--ink-4)", marginRight: 4, flexShrink: 0 }}
            aria-label={`type: ${node.data.dataType}`}
          >
            {node.data.dataType}
          </span>
        ))}
      {isJsonb && fqnKey !== "" && (
        <button
          type="button"
          aria-expanded={jsonbExpanded}
          aria-label={t("schema.tree.toggle_inferred_schema")}
          onClick={(e) => {
            e.stopPropagation();
            onJsonbToggle(fqnKey);
          }}
          className="schema-tree-jsonb-chevron"
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: "0 2px",
            display: "flex",
            alignItems: "center",
            color: "var(--ink-3)",
            flexShrink: 0,
          }}
          data-testid={`schema-tree-jsonb-chevron-${node.id}`}
        >
          {jsonbExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
      )}
      {/*
       * S16 fix: the InferredSchemaPanel is no longer rendered inside
       * this row (react-arborist clips rows at a fixed rowHeight). Only one
       * panel can be expanded at a time, and it is rendered as a sibling
       * floating block below the entire <Tree/> by SchemaTree itself.
       */}
    </div>
  );
}

function searchMatch(node: NodeApi<TreeNode>, term: string): boolean {
  // `toLocaleLowerCase` matters for Cyrillic input (): the default
  // `toLowerCase` works for Latin and most Russian letters, but locale-aware
  // folding is the safer default if the schema contains Turkish "İ", German
  // "ß", or other characters with locale-specific casing.
  return node.data.name.toLocaleLowerCase().includes(term.toLocaleLowerCase());
}

/**
 * Walk the loaded tree to determine whether `term` matches any visible node.
 * react-arborist filters in its own state and doesn't expose the filtered
 * count, so we duplicate the predicate here to drive the "nothing found"
 * empty state without poking at internals.
 */
function anyNodeMatches(nodes: TreeNode[], term: string): boolean {
  if (term === "") return true;
  const lower = term.toLocaleLowerCase();
  for (const node of nodes) {
    if (node.name.toLocaleLowerCase().includes(lower)) return true;
    if (node.children.length > 0 && anyNodeMatches(node.children, term)) return true;
  }
  return false;
}

interface SchemaTreeProps {
  onOpenBuilder?: (fqn: { schema: string; table: string; column: string }) => void;
  onOpenSuggester?: (fqn: { schema: string; table: string; column: string }) => void;
}

export function SchemaTree({ onOpenBuilder, onOpenSuggester }: SchemaTreeProps = {}): JSX.Element {
  const { t } = useTranslation();
  const cache = useSchema((s) => s.cache);
  const filter = useSchema((s) => s.filter);
  const selectedNode = useSchema((s) => s.selectedNode);
  const loadChildren = useSchema((s) => s.loadChildren);
  const selectNode = useSchema((s) => s.selectNode);
  const searchPreloading = useSchema((s) => s.searchPreloading);
  const connection = useSchema((s) => s.connection);
  const connId = connection.status === "connected" ? connection.connId : null;

  // S16: at most ONE inferred-schema panel is expanded at a time. We track the
  // currently-expanded column key + parsed fqn parts so the panel can be
  // rendered as a floating block below the arborist tree (fix —
  // arborist rows have a fixed rowHeight that clips arbitrary content).
  const [expandedJsonbColumn, setExpandedJsonbColumn] = useState<{
    key: string;
    schema: string;
    table: string;
    column: string;
  } | null>(null);
  const expandedJsonbColumnKey = expandedJsonbColumn?.key ?? null;
  const toggleJsonbColumn = useCallback((key: string) => {
    setExpandedJsonbColumn((prev) => {
      if (prev?.key === key) return null;
      // key format: `${connId}::${schema}::${table}::${column}`
      const parts = key.split("::");
      if (parts.length !== 4) return null;
      return { key, schema: parts[1]!, table: parts[2]!, column: parts[3]! };
    });
  }, []);
  // Auto-collapse the panel if the connection drops; otherwise we'd keep
  // showing a stale fqn for a now-disconnected connId.
  useEffect(() => {
    if (connId === null && expandedJsonbColumn !== null) {
      setExpandedJsonbColumn(null);
    }
  }, [connId, expandedJsonbColumn]);

  const treeData = useMemo<TreeNode[]>(() => buildTreeNodes("schemas", cache, t), [cache, t]);
  const noMatches = filter !== "" && !searchPreloading && !anyNodeMatches(treeData, filter);

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 280, height: 600 });

  // Track size for react-arborist (which requires explicit width/height props).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      setSize({ width: el.clientWidth || 280, height: el.clientHeight || 600 });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const handleToggle = useCallback(
    (id: NodeKey) => {
      if (!cache.has(id)) {
        // Fire-and-forget — failure is surfaced via the toast layer when wired
        // by the main agent. Errors are caught inside the store action so we
        // don't need to swallow here.
        void loadChildren(id);
      }
    },
    [cache, loadChildren],
  );

  const handleSelect = useCallback(
    (id: NodeKey, kind: NodeKind) => {
      if (kind === "table" || kind === "view" || kind === "matview") {
        selectNode(id);
        // also dispatch an editor object tab so the user gets a
        // pinned ObjectDetails view in the main area without losing other
        // open editor tabs. Lazy-import to avoid circular dependency at
        // module-load time.
        import("../editor/store")
          .then(({ useEditor }) => {
            const conn = useSchema.getState().connection;
            if (conn.status === "connected") {
              useEditor.getState().openObjectTab(id, conn.connId);
            }
          })
          .catch(() => {
            // Non-fatal — selection still highlights tree row.
          });
      }
    },
    [selectNode],
  );

  const handleContext = useCallback((state: ContextMenuState) => {
    setContextMenu(state);
  }, []);

  // Close context menu on outside click / Escape.
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setContextMenu(null);
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [contextMenu]);

  const handleCopyName = useCallback(async () => {
    if (!contextMenu) return;
    const parsed = parseLeafKey(contextMenu.nodeId);
    if (!parsed) return;
    const text = `${parsed.schema}.${parsed.name}`;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Browser may deny clipboard in test env; silently ignore.
    }
    setContextMenu(null);
  }, [contextMenu]);

  /**
   * open an object-editor tab for a target. `objectKind` is the
   * editor kind, not the tree node kind. `mode` is "create" | "edit". When
   * `mode === "create"`, `name` may be omitted (the editor mints a fresh form).
   * For "New index on this table…" we pass `parentTable` so the IndexEditor
   * pre-fills the FROM clause.
   */
  const handleOpenObjectEditor = useCallback(
    (params: {
      objectKind: "table" | "view" | "matview" | "index" | "sequence";
      mode: "create" | "edit";
      schema: string;
      name?: string;
      parentTable?: string;
    }) => {
      if (connId === null) return;
      // Lazy-import to avoid circular dependency at module-load time
      // (mirrors the pattern used by handleSelect → openObjectTab).
      import("../editor/store")
        .then(({ useEditor }) => {
          useEditor.getState().openObjectEditor({
            connectionId: connId,
            objectKind: params.objectKind,
            mode: params.mode,
            schema: params.schema,
            name: params.name,
            parentTable: params.parentTable,
          });
        })
        .catch(() => {
          // Non-fatal — failure surfaces via the toast layer when wired.
        });
      setContextMenu(null);
    },
    [connId],
  );

  return (
    <div ref={containerRef} className="relative h-full w-full" data-testid="schema-tree">
      {searchPreloading ? (
        <p
          style={{ padding: "8px 12px", fontSize: 11, color: "var(--ink-4)" }}
          data-testid="schema-tree-search-loading"
        >
          {t("schema.search.loading")}
        </p>
      ) : null}
      {noMatches ? (
        <p
          style={{ padding: "16px 12px", fontSize: 12.5, color: "var(--ink-4)" }}
          data-testid="schema-tree-empty-results"
        >
          {t("schema.search.empty_results", { query: filter })}
        </p>
      ) : (
        <Tree<TreeNode>
          data={treeData}
          openByDefault={false}
          width={size.width}
          height={size.height}
          rowHeight={28}
          indent={16}
          searchTerm={filter}
          searchMatch={searchMatch}
          selection={selectedNode ?? undefined}
          disableEdit
          disableDrag
          disableDrop
        >
          {({ node, style, dragHandle }) => (
            <Row
              node={node}
              style={style}
              dragHandle={dragHandle}
              onSelect={handleSelect}
              onToggle={handleToggle}
              onContext={handleContext}
              onJsonbToggle={toggleJsonbColumn}
              expandedJsonbColumnKey={expandedJsonbColumnKey}
              connId={connId}
            />
          )}
        </Tree>
      )}

      {/*
       * S16 fix: render the InferredSchemaPanel as a floating block
       * pinned to the bottom of the schema browser pane. Lifted out of the
       * arborist row so it isn't clipped by the fixed rowHeight. Only one
       * panel is visible at a time; clicking the chevron of another column
       * swaps it; clicking the same chevron collapses it.
       */}
      {expandedJsonbColumn !== null && connId !== null ? (
        <div
          className="schema-tree-jsonb-overlay"
          data-testid="schema-tree-jsonb-overlay"
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 5,
          }}
        >
          <div className="schema-tree-jsonb-overlay__caption">
            {expandedJsonbColumn.schema}.{expandedJsonbColumn.table}.
            <strong>{expandedJsonbColumn.column}</strong>
          </div>
          <InferredSchemaPanel
            connId={connId}
            fqn={{
              schema: expandedJsonbColumn.schema,
              table: expandedJsonbColumn.table,
              column: expandedJsonbColumn.column,
            }}
            variant="browser"
          />
        </div>
      ) : null}

      {contextMenu ? (
        <div
          role="menu"
          aria-label={t("schema.tree.copy_name")}
          style={{
            position: "fixed",
            left: contextMenu.x,
            top: contextMenu.y,
            zIndex: 60,
            minWidth: 220,
          }}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === "Escape") setContextMenu(null);
          }}
          className="q-popover"
          data-testid="schema-tree-context-menu"
        >
          {contextMenu.nodeKind === "column" && contextMenu.isJsonb ? (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  const parsed = parseColumnKey(contextMenu.nodeId);
                  if (parsed && onOpenBuilder) {
                    onOpenBuilder({
                      schema: parsed.schema,
                      table: parsed.table,
                      column: parsed.column,
                    });
                  }
                  setContextMenu(null);
                }}
                className="q-popover-item"
              >
                {t("schema.tree.menu.buildJsonbQuery")}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  const parsed = parseColumnKey(contextMenu.nodeId);
                  if (parsed && onOpenSuggester) {
                    onOpenSuggester({
                      schema: parsed.schema,
                      table: parsed.table,
                      column: parsed.column,
                    });
                  }
                  setContextMenu(null);
                }}
                className="q-popover-item"
              >
                {t("schema.tree.menu.suggestGinIndex")}
              </button>
              <hr className="q-popover-sep" />
            </>
          ) : null}
          {contextMenu.nodeKind !== "schema" ? (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => void handleCopyName()}
                className="q-popover-item"
              >
                {t("schema.tree.copy_name")}
                <span className="kbd">{formatHotkey("C")}</span>
              </button>
              <hr className="q-popover-sep" />
            </>
          ) : null}
          {/* — active object-editor entry-points. */}
          {contextMenu.nodeKind === "schema"
            ? (() => {
                const schema = parseSchemaKey(contextMenu.nodeId);
                if (!schema) return null;
                return (
                  <>
                    <button
                      type="button"
                      role="menuitem"
                      data-testid="schema-tree-menu-new-table"
                      onClick={() =>
                        handleOpenObjectEditor({ objectKind: "table", mode: "create", schema })
                      }
                      className="q-popover-item"
                    >
                      {t("object_editor.tree_menu.new_table")}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      data-testid="schema-tree-menu-new-view"
                      onClick={() =>
                        handleOpenObjectEditor({ objectKind: "view", mode: "create", schema })
                      }
                      className="q-popover-item"
                    >
                      {t("object_editor.tree_menu.new_view")}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      data-testid="schema-tree-menu-new-matview"
                      onClick={() =>
                        handleOpenObjectEditor({ objectKind: "matview", mode: "create", schema })
                      }
                      className="q-popover-item"
                    >
                      {t("object_editor.tree_menu.new_matview")}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      data-testid="schema-tree-menu-new-sequence"
                      onClick={() =>
                        handleOpenObjectEditor({ objectKind: "sequence", mode: "create", schema })
                      }
                      className="q-popover-item"
                    >
                      {t("object_editor.tree_menu.new_sequence")}
                    </button>
                  </>
                );
              })()
            : null}
          {contextMenu.nodeKind === "table"
            ? (() => {
                const parsed = parseLeafKey(contextMenu.nodeId);
                if (!parsed) return null;
                return (
                  <>
                    <button
                      type="button"
                      role="menuitem"
                      data-testid="schema-tree-menu-edit-table"
                      onClick={() =>
                        handleOpenObjectEditor({
                          objectKind: "table",
                          mode: "edit",
                          schema: parsed.schema,
                          name: parsed.name,
                        })
                      }
                      className="q-popover-item"
                    >
                      {t("object_editor.tree_menu.edit_table")}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      data-testid="schema-tree-menu-new-index-on-table"
                      onClick={() =>
                        handleOpenObjectEditor({
                          objectKind: "index",
                          mode: "create",
                          schema: parsed.schema,
                          parentTable: parsed.name,
                        })
                      }
                      className="q-popover-item"
                    >
                      {t("object_editor.tree_menu.new_index")}
                    </button>
                    <hr className="q-popover-sep" />
                  </>
                );
              })()
            : null}
          {contextMenu.nodeKind === "view"
            ? (() => {
                const parsed = parseLeafKey(contextMenu.nodeId);
                if (!parsed) return null;
                return (
                  <>
                    <button
                      type="button"
                      role="menuitem"
                      data-testid="schema-tree-menu-edit-view"
                      onClick={() =>
                        handleOpenObjectEditor({
                          objectKind: "view",
                          mode: "edit",
                          schema: parsed.schema,
                          name: parsed.name,
                        })
                      }
                      className="q-popover-item"
                    >
                      {t("object_editor.tree_menu.edit_view")}
                    </button>
                    <hr className="q-popover-sep" />
                  </>
                );
              })()
            : null}
          {/* PENDING (placeholder) items — only for table/view, not schema. */}
          {contextMenu.nodeKind !== "schema"
            ? PENDING_MENU_ITEMS.map((item) => {
                if (item.tableOnly && contextMenu.nodeKind !== "table") return null;
                const tooltip = t("schema.tree.menu.soon", { sprint: item.sprint });
                return (
                  <button
                    key={item.key}
                    type="button"
                    role="menuitem"
                    disabled
                    aria-disabled="true"
                    title={tooltip}
                    className="q-popover-item"
                  >
                    {t(item.labelKey)}
                  </button>
                );
              })
            : null}
        </div>
      ) : null}
    </div>
  );
}
