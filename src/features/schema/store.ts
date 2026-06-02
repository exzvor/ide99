/**
 * schema browser store — connection state machine + lazy children cache.
 *
 * The store models the right-sidebar lifecycle (idle → connecting → connected/error)
 * and lazily caches tree children keyed by `NodeKey`. Concurrent `loadChildren`
 * calls for the same key are deduplicated via an in-flight promise map so that a
 * user expanding/collapsing the same node rapidly never triggers duplicate
 * Tauri command round-trips.
 *
 * Synthetic group nodes ("schema:NAME") are expanded into three virtual children
 * ("schema:NAME/tables", "schema:NAME/views", "schema:NAME/matviews") without
 * hitting the backend; the `name` field carries an i18n key so render-site
 * components can localize.
 */

import { create } from "zustand";
import {
  ConnectionError,
  type ConnectionErrorPayload,
  connectionConnect,
  connectionDisconnect,
  schemaListColumns,
  schemaListMatviews,
  schemaListSchemas,
  schemaListTables,
  schemaListViews,
} from "../../lib/tauri";

export type ConnectionState =
  | { status: "idle" }
  | { status: "connecting"; connId: string }
  | {
      status: "connected";
      connId: string;
      serverVersion: string;
      database: string;
    }
  | {
      status: "error";
      connId: string;
      /** Localizable payload when the failure was a typed ConnectionError. */
      error: ConnectionErrorPayload | null;
      /** Raw fallback when the failure wasn't a ConnectionError (network, etc). */
      message: string;
    };

export type NodeKind =
  | "schema"
  | "tables-group"
  | "views-group"
  | "matviews-group"
  | "table"
  | "view"
  | "matview"
  | "column";

export type NodeKey = string;

export interface NodeChild {
  id: NodeKey;
  /**
   * Display name for leaf nodes (schemas, tables, views, columns).
   *
   * For synthetic group nodes (`tables-group`, `views-group`) this is an i18n
   * key (`schema.tree.tables_group` / `schema.tree.views_group`) — render-site
   * components run it through `t()` so the user sees the localized string.
   */
  name: string;
  kind: NodeKind;
  hasChildren: boolean;
  /**
   * Set for `kind === "column"` nodes. Carries the Postgres data type string
   * (e.g. "text", "jsonb", "integer") so the tree renderer can gate the
   * JSONB inferred-schema chevron without an extra fetch (S16).
   */
  dataType?: string;
}

export interface SchemaState {
  connection: ConnectionState;
  cache: Map<NodeKey, NodeChild[]>;
  selectedNode: NodeKey | null;
  filter: string;
  /**
   * True while `loadAllForSearch` is fetching the schema tree wide enough that
   * the filter input has something to match against. Used by `SchemaTree` to
   * distinguish "no results" from "still preloading" — without this the user
   * sees a stale empty state during the brief preload window.
   */
  searchPreloading: boolean;
}

export interface SchemaActions {
  connect(connId: string): Promise<void>;
  disconnect(): Promise<void>;
  loadChildren(parent: NodeKey): Promise<NodeChild[]>;
  refreshAll(): Promise<void>;
  selectNode(key: NodeKey | null): void;
  setFilter(s: string): void;
  /**
   * Eager-load every schema's tables + views so the filter input can match
   * objects from schemas the user has not manually expanded yet (* search returned an empty sidebar because the filter only ran against
   * whatever was already cached).
   *
   * Idempotent: per-key fetches go through `loadChildren`, which short-circuits
   * on a cache hit, so repeated calls cost only the cache lookups.
   */
  loadAllForSearch(): Promise<void>;
}

export type SchemaStore = SchemaState & SchemaActions;

/** Module-private map of in-flight loadChildren promises (deduplication). */
const inFlight = new Map<NodeKey, Promise<NodeChild[]>>();

/** Returns the active connection id, or null if not currently connected. */
function activeConnId(state: SchemaState): string | null {
  return state.connection.status === "connected" ? state.connection.connId : null;
}

/** Splits a NodeKey into its semantic components. */
function parseKey(
  key: NodeKey,
):
  | { kind: "schemas" }
  | { kind: "schema"; schema: string }
  | { kind: "tables-group"; schema: string }
  | { kind: "views-group"; schema: string }
  | { kind: "matviews-group"; schema: string }
  | { kind: "table"; schema: string; table: string }
  | { kind: "unknown" } {
  if (key === "schemas") return { kind: "schemas" };
  if (key.startsWith("schema:")) {
    const rest = key.slice("schema:".length);
    if (rest.endsWith("/tables")) {
      return { kind: "tables-group", schema: rest.slice(0, -"/tables".length) };
    }
    if (rest.endsWith("/views")) {
      return { kind: "views-group", schema: rest.slice(0, -"/views".length) };
    }
    if (rest.endsWith("/matviews")) {
      return { kind: "matviews-group", schema: rest.slice(0, -"/matviews".length) };
    }
    return { kind: "schema", schema: rest };
  }
  if (key.startsWith("table:")) {
    const rest = key.slice("table:".length);
    const slash = rest.indexOf("/");
    if (slash !== -1) {
      return { kind: "table", schema: rest.slice(0, slash), table: rest.slice(slash + 1) };
    }
  }
  return { kind: "unknown" };
}

async function fetchChildren(parent: NodeKey, connId: string): Promise<NodeChild[]> {
  const parsed = parseKey(parent);
  switch (parsed.kind) {
    case "schemas": {
      const list = await schemaListSchemas(connId);
      return list.map((s) => ({
        id: `schema:${s.name}`,
        name: s.name,
        kind: "schema" as const,
        hasChildren: true,
      }));
    }
    case "schema": {
      // Synthetic — no backend round-trip. Names are i18n keys; the consumer
      // localizes at render time via `t(child.name)`.
      return [
        {
          id: `schema:${parsed.schema}/tables`,
          name: "schema.tree.tables_group",
          kind: "tables-group" as const,
          hasChildren: true,
        },
        {
          id: `schema:${parsed.schema}/views`,
          name: "schema.tree.views_group",
          kind: "views-group" as const,
          hasChildren: true,
        },
        {
          id: `schema:${parsed.schema}/matviews`,
          name: "schema.tree.matviews_group",
          kind: "matviews-group" as const,
          hasChildren: true,
        },
      ];
    }
    case "tables-group": {
      const list = await schemaListTables(connId, parsed.schema);
      return list.map((t) => ({
        id: `table:${parsed.schema}/${t.name}`,
        name: t.name,
        kind: "table" as const,
        // Tables are expandable: their children are column nodes (S16).
        hasChildren: true,
      }));
    }
    case "views-group": {
      const list = await schemaListViews(connId, parsed.schema);
      return list.map((v) => ({
        id: `view:${parsed.schema}/${v.name}`,
        name: v.name,
        kind: "view" as const,
        hasChildren: false,
      }));
    }
    case "matviews-group": {
      const list = await schemaListMatviews(connId, parsed.schema);
      return list.map((m) => ({
        id: `matview:${parsed.schema}/${m.name}`,
        name: m.name,
        kind: "matview" as const,
        hasChildren: false,
      }));
    }
    case "table": {
      const list = await schemaListColumns(connId, parsed.schema, parsed.table);
      return list.map((c) => ({
        id: `column:${parsed.schema}/${parsed.table}/${c.name}`,
        name: c.name,
        kind: "column" as const,
        hasChildren: false,
        dataType: c.dataType,
      }));
    }
    default:
      return [];
  }
}

export const useSchema = create<SchemaStore>((set, get) => ({
  connection: { status: "idle" },
  cache: new Map(),
  selectedNode: null,
  filter: "",
  searchPreloading: false,

  connect: async (connId: string) => {
    set({ connection: { status: "connecting", connId } });
    try {
      const info = await connectionConnect(connId);
      set({
        connection: {
          status: "connected",
          connId,
          serverVersion: info.serverVersion,
          database: info.database,
        },
        cache: new Map(),
        selectedNode: null,
        filter: "",
        searchPreloading: false,
      });
      // Eagerly load the schemas root so the tree has something to render.
      try {
        await get().loadChildren("schemas");
      } catch {
        // Failure here surfaces via the toast layer at the call site; the
        // connected state stays so the user can retry via refresh.
      }
      // auto-open one untitled editor tab on first successful
      // connect so the user can immediately start typing SQL. Lazy-import
      // to avoid circular dep at module-load time.
      //
      // Also rebind any editor tabs whose `connectionId` is null OR points
      // to a stale id (deleted connection, prior session, etc.). Without
      // this the user sees "Connected · X" in the status bar but Run
      // returns NotConnected because the tab still references an old pool.
      // Single-pool model — selectable connection in the toolbar dropdown
      // is always the active one, so retargeting is safe.
      try {
        const { useEditor } = await import("../editor/store");
        const editor = useEditor.getState();
        if (editor.hydrated && editor.tabs.length === 0) {
          editor.openEditorTab(connId);
        } else if (editor.hydrated) {
          for (const tab of editor.tabs) {
            if (tab.kind === "editor" && tab.connectionId !== connId) {
              editor.setTabConnection(tab.id, connId);
            }
          }
        }
      } catch {
        // Non-fatal — connect succeeded; tab can be opened manually via Cmd+T.
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const payload =
        err instanceof ConnectionError ? { kind: err.kind, message: err.message } : null;
      set({ connection: { status: "error", connId, error: payload, message } });
    }
  },

  disconnect: async () => {
    const { connection } = get();
    if (connection.status !== "connected") return;
    const { connId } = connection;
    try {
      await connectionDisconnect(connId);
    } catch {
      // Even if the backend rejects (already dropped, etc) we still clear the
      // local state — there's nothing the user can do with a dead pool.
    }
    inFlight.clear();
    set({
      connection: { status: "idle" },
      cache: new Map(),
      selectedNode: null,
      filter: "",
      searchPreloading: false,
    });
    // — evict the autocomplete snapshot. Lazy-import to avoid the
    // editor↔schema module cycle (the cache lives under features/editor).
    try {
      const { useAutocompleteCache } = await import("../editor/autocomplete/cache");
      useAutocompleteCache.getState().evict(connId);
    } catch {
      // Best-effort; if the module fails to load we tolerate slight staleness.
    }
    // Audit M1: object tabs (table/view) reference a specific connId. After
    // disconnect they would point at a dead pool — close them. Editor tabs
    // stay (their connectionId nullifies via setTabConnection in the
    // editor store on next open). Lazy-import to dodge the schema↔editor
    // module cycle.
    try {
      const { useEditor } = await import("../editor/store");
      await useEditor.getState().closeObjectTabsForConnection(connId);
    } catch {
      // Non-fatal — object tabs are still locally consistent in the editor
      // store; they will simply show an error if interacted with.
    }
  },

  loadChildren: async (parent: NodeKey) => {
    const state = get();
    const cached = state.cache.get(parent);
    if (cached !== undefined) return cached;

    const existing = inFlight.get(parent);
    if (existing !== undefined) return existing;

    const connId = activeConnId(state);
    if (connId === null) {
      throw new Error("loadChildren: not connected");
    }

    const promise = (async () => {
      try {
        const children = await fetchChildren(parent, connId);
        const next = new Map(get().cache);
        next.set(parent, children);
        set({ cache: next });
        return children;
      } finally {
        inFlight.delete(parent);
      }
    })();

    inFlight.set(parent, promise);
    return promise;
  },

  refreshAll: async () => {
    const state = get();
    if (state.connection.status !== "connected") return;
    // Snapshot the *real* parents (skip synthetic schema:NAME entries —
    // those resolve without a fetch and are reproduced as soon as their
    // parent reloads).
    const previouslyCached = Array.from(state.cache.keys()).filter(
      (key) => parseKey(key).kind !== "schema",
    );

    inFlight.clear();
    set({ cache: new Map() });

    // Awaiting parents-first preserves the user's expanded structure: each
    // parent's children must populate before its descendants are re-fetched.
    for (const parent of previouslyCached) {
      try {
        await get().loadChildren(parent);
      } catch {
        // Skip parents whose source schema/table no longer exists; the tree
        // simply collapses that subtree on next render.
      }
    }
  },

  selectNode: (key: NodeKey | null) => {
    set({ selectedNode: key });
  },

  setFilter: (s: string) => {
    set({ filter: s });
  },

  loadAllForSearch: async () => {
    if (get().connection.status !== "connected") return;
    set({ searchPreloading: true });
    try {
      // Top-level schemas first; without them we have nothing to walk.
      const schemas = await get().loadChildren("schemas");

      // Each schema yields synthetic tables-group + views-group (no fetch),
      // and each group fetches the actual table/view list. Run all backend
      // calls in parallel and tolerate per-schema failures so a single bad
      // permissions error doesn't block the rest of the tree from indexing.
      await Promise.allSettled(
        schemas.flatMap((schema) => {
          const tablesKey = `${schema.id}/tables`;
          const viewsKey = `${schema.id}/views`;
          const matviewsKey = `${schema.id}/matviews`;
          return [
            get().loadChildren(schema.id),
            get().loadChildren(tablesKey),
            get().loadChildren(viewsKey),
            get().loadChildren(matviewsKey),
          ];
        }),
      );
    } finally {
      set({ searchPreloading: false });
    }
  },
}));

// Test-only escape hatch: lets the store unit test reset internal module
// state (the in-flight dedup map) between cases. Not part of the public API.
export const __testing = {
  clearInFlight: () => inFlight.clear(),
  inFlightSize: () => inFlight.size,
};
