/**
 * —
 *
 * Zustand store for the Migrations panel.
 *
 * - Holds the discovered list (`migrations`) + per-connection settings
 * (`migrationsDir`, `trackingEnabled`, `snapshotsEnabled`) and
 * selection (`selectedVersion`).
 * - Stays free of IPC: callers (the panel) populate the store from the
 * `migrations_list` Tauri command, and the store exposes derived
 * helpers (`isContiguousRange`, `countByStatus`) consumed by the
 * ApplyDialog and the Timeline header.
 *
 * All mutations are synchronous setters — no thunks, no event listeners.
 */

import { create } from "zustand";

export type MigrationStatus = "pending" | "applied" | "dirty";

export type Migration = {
  version: string;
  name: string;
  upPath: string;
  downPath: string | null;
  status: MigrationStatus;
  appliedAt: string | null;
  appliedBy: string | null;
  durationMs: number | null;
  diskChecksum: string;
  appliedChecksum: string | null;
  hasSnapshot: boolean;
  parseError: string | null;
};

interface State {
  migrationsDir: string | null;
  trackingEnabled: boolean;
  snapshotsEnabled: boolean;
  migrations: Migration[];
  selectedVersion: string | null;
  trackingTableMissing: boolean;
}

interface Actions {
  setDir(dir: string): void;
  clearDir(): void;
  setOptions(tracking: boolean, snapshots: boolean): void;
  setMigrations(m: Migration[], trackingTableMissing: boolean): void;
  select(version: string | null): void;
  isContiguousRange(from: string, to: string): boolean;
  countByStatus(): Record<MigrationStatus, number>;
}

export type MigrationsStore = State & Actions;

export const useMigrationsStore = create<MigrationsStore>((set, get) => ({
  migrationsDir: null,
  trackingEnabled: true,
  snapshotsEnabled: false,
  migrations: [],
  selectedVersion: null,
  trackingTableMissing: false,

  setDir: (dir) => set({ migrationsDir: dir }),

  clearDir: () => set({ migrationsDir: null, migrations: [], selectedVersion: null }),

  setOptions: (tracking, snapshots) =>
    set({ trackingEnabled: tracking, snapshotsEnabled: snapshots }),

  setMigrations: (m, trackingTableMissing) => {
    const sel = get().selectedVersion;
    const stillPresent = sel != null && m.some((x) => x.version === sel);
    set({
      migrations: m,
      selectedVersion: stillPresent ? sel : null,
      trackingTableMissing,
    });
  },

  select: (version) => set({ selectedVersion: version }),

  isContiguousRange: (from, to) => {
    const m = get().migrations;
    const fromIdx = m.findIndex((x) => x.version === from);
    const toIdx = m.findIndex((x) => x.version === to);
    if (fromIdx === -1 || toIdx === -1 || toIdx < fromIdx) return false;
    return m.slice(fromIdx, toIdx + 1).every((x) => x.status === "pending");
  },

  countByStatus: () => {
    const acc: Record<MigrationStatus, number> = { pending: 0, applied: 0, dirty: 0 };
    for (const x of get().migrations) acc[x.status]++;
    return acc;
  },
}));
