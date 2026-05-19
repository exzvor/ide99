import { create } from "zustand";
import type { Connection } from "../../lib/tauri";
import { connectionSetExcludeFromHistory, listConnections } from "../../lib/tauri";
import { useLiveOps } from "../live-ops/store";

/**
 * Zustand store for the connection-manager feature.
 *
 * - Holds the canonical list of connections (mirrored from the Rust SQLite store).
 * - Tracks the currently-selected row and modal form mode.
 * - Exposes optimistic local mutators (`upsertLocal`, `removeLocal`) so the
 * UI can apply changes immediately after a Tauri command resolves without
 * a round-trip refetch.
 */

type FormPrefill = Partial<
  Pick<Connection, "name" | "host" | "port" | "database" | "username" | "sslMode">
> & {
  password?: string;
  /**
   * Server-side dbId for an Instant DB that was provisioned just before the
   * form opened. When set, closing the form without a successful save drops
   * the orphan on the control service so the next attempt is not blocked by
   * the per-device active-DB quota (429 "limit: 1 active DB per device").
   */
  instantDbId?: string;
};

type FormMode =
  | { type: "closed" }
  | { type: "create"; prefill?: FormPrefill }
  | { type: "edit"; id: string };

interface State {
  connections: Connection[];
  selectedId: string | null;
  formMode: FormMode;
  loading: boolean;
  error: string | null;
}

interface Actions {
  load: () => Promise<void>;
  select: (id: string | null) => void;
  openCreateForm: (prefill?: FormPrefill) => void;
  openEditForm: (id: string) => void;
  closeForm: () => void;
  upsertLocal: (c: Connection) => void;
  removeLocal: (id: string) => void;
  setExcludeFromHistory: (id: string, exclude: boolean) => Promise<void>;
}

export type ConnectionsState = State & Actions;
export type { FormMode, FormPrefill };

export const useConnections = create<ConnectionsState>((set) => ({
  connections: [],
  selectedId: null,
  formMode: { type: "closed" },
  loading: false,
  error: null,
  load: async () => {
    set({ loading: true, error: null });
    try {
      const list = await listConnections();
      set({ connections: list, loading: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), loading: false });
    }
  },
  select: (id) => set({ selectedId: id }),
  openCreateForm: (prefill) => set({ formMode: { type: "create", prefill } }),
  openEditForm: (id) => set({ formMode: { type: "edit", id } }),
  closeForm: () => set({ formMode: { type: "closed" } }),
  upsertLocal: (c) =>
    set((s) => ({
      connections: s.connections.some((x) => x.id === c.id)
        ? s.connections.map((x) => (x.id === c.id ? c : x))
        : [...s.connections, c].sort((a, b) => a.name.localeCompare(b.name)),
    })),
  removeLocal: (id) => {
    // — drop the per-connection Live Ops slice + LS prefs so they
    // don't leak into a future connection that may reuse the same id.
    useLiveOps.getState().clearConn(id);
    set((s) => ({
      connections: s.connections.filter((c) => c.id !== id),
      selectedId: s.selectedId === id ? null : s.selectedId,
    }));
  },
  setExcludeFromHistory: async (id, exclude) => {
    await connectionSetExcludeFromHistory(id, exclude);
    set((s) => ({
      connections: s.connections.map((c) =>
        c.id === id ? { ...c, excludeFromHistory: exclude } : c,
),
    }));
  },
}));
