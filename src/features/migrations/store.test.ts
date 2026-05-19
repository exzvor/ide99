/**
 * —
 *
 * Zustand store for the Migrations panel. Holds the list of discovered
 * migrations + their statuses, the per-connection selected directory,
 * and the two opt-in toggles (tracking table + schema snapshots).
 *
 * Backend round-trip is exercised through the panel; this store stays
 * pure (no IPC calls) so tests can freely mutate state without mocks.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { type Migration, useMigrationsStore } from "./store";

function migration(overrides: Partial<Migration> = {}): Migration {
  return {
    version: "0001",
    name: "create_users",
    upPath: "/repo/db/migrations/0001_create_users.up.sql",
    downPath: "/repo/db/migrations/0001_create_users.down.sql",
    status: "pending",
    appliedAt: null,
    appliedBy: null,
    durationMs: null,
    diskChecksum: "abc123",
    appliedChecksum: null,
    hasSnapshot: false,
    parseError: null,
    ...overrides,
  };
}

describe("migrations store", () => {
  beforeEach(() => {
    // Re-initialize to defaults between tests.
    useMigrationsStore.setState({
      migrationsDir: null,
      trackingEnabled: true,
      snapshotsEnabled: false,
      migrations: [],
      selectedVersion: null,
      trackingTableMissing: false,
    });
  });

  it("initial state has empty migrations and no selection", () => {
    const s = useMigrationsStore.getState();
    expect(s.migrations).toEqual([]);
    expect(s.selectedVersion).toBeNull();
    expect(s.migrationsDir).toBeNull();
    expect(s.trackingEnabled).toBe(true);
    expect(s.snapshotsEnabled).toBe(false);
    expect(s.trackingTableMissing).toBe(false);
  });

  it("setMigrations replaces list and clears selection if version no longer present", () => {
    useMigrationsStore.setState({ selectedVersion: "0001" });
    useMigrationsStore.getState().setMigrations([migration({ version: "0002" })], false);
    const s = useMigrationsStore.getState();
    expect(s.migrations).toHaveLength(1);
    expect(s.migrations[0]?.version).toBe("0002");
    expect(s.selectedVersion).toBeNull();
  });

  it("setMigrations preserves selection if version still present", () => {
    useMigrationsStore.setState({ selectedVersion: "0001" });
    useMigrationsStore
      .getState()
      .setMigrations([migration({ version: "0001" }), migration({ version: "0002" })], false);
    expect(useMigrationsStore.getState().selectedVersion).toBe("0001");
  });

  it("select sets selected version", () => {
    useMigrationsStore.getState().select("0042");
    expect(useMigrationsStore.getState().selectedVersion).toBe("0042");
    useMigrationsStore.getState().select(null);
    expect(useMigrationsStore.getState().selectedVersion).toBeNull();
  });

  it("isContiguousRange returns true for adjacent pending versions", () => {
    useMigrationsStore
      .getState()
      .setMigrations(
        [
          migration({ version: "0001", status: "applied" }),
          migration({ version: "0002", status: "pending" }),
          migration({ version: "0003", status: "pending" }),
          migration({ version: "0004", status: "pending" }),
        ],
        false,
      );
    expect(useMigrationsStore.getState().isContiguousRange("0002", "0004")).toBe(true);
  });

  it("isContiguousRange returns false for non-adjacent versions (applied in middle)", () => {
    useMigrationsStore
      .getState()
      .setMigrations(
        [
          migration({ version: "0001", status: "pending" }),
          migration({ version: "0002", status: "applied" }),
          migration({ version: "0003", status: "pending" }),
        ],
        false,
      );
    expect(useMigrationsStore.getState().isContiguousRange("0001", "0003")).toBe(false);
  });

  it("isContiguousRange returns false for unknown version", () => {
    useMigrationsStore
      .getState()
      .setMigrations([migration({ version: "0001", status: "pending" })], false);
    expect(useMigrationsStore.getState().isContiguousRange("0001", "9999")).toBe(false);
    expect(useMigrationsStore.getState().isContiguousRange("9999", "0001")).toBe(false);
  });

  it("countByStatus returns counts of pending/applied/dirty", () => {
    useMigrationsStore
      .getState()
      .setMigrations(
        [
          migration({ version: "0001", status: "applied" }),
          migration({ version: "0002", status: "applied" }),
          migration({ version: "0003", status: "pending" }),
          migration({ version: "0004", status: "dirty" }),
        ],
        false,
      );
    const counts = useMigrationsStore.getState().countByStatus();
    expect(counts.applied).toBe(2);
    expect(counts.pending).toBe(1);
    expect(counts.dirty).toBe(1);
  });

  it("setOptions updates trackingEnabled and snapshotsEnabled", () => {
    useMigrationsStore.getState().setOptions(false, true);
    const s = useMigrationsStore.getState();
    expect(s.trackingEnabled).toBe(false);
    expect(s.snapshotsEnabled).toBe(true);
  });

  it("setDir updates migrationsDir; clearDir resets dir + migrations + selection", () => {
    useMigrationsStore.getState().setDir("/path/to/migrations");
    expect(useMigrationsStore.getState().migrationsDir).toBe("/path/to/migrations");

    useMigrationsStore.setState({
      migrations: [migration({ version: "0001" })],
      selectedVersion: "0001",
    });
    useMigrationsStore.getState().clearDir();
    const s = useMigrationsStore.getState();
    expect(s.migrationsDir).toBeNull();
    expect(s.migrations).toEqual([]);
    expect(s.selectedVersion).toBeNull();
  });
});
