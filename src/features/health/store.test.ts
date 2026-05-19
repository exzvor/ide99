import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ActiveConnectionsData,
  type BloatTopData,
  type CacheHitData,
  type CardResult,
  type Connection,
  type DbSizeData,
  type LongRunningData,
  type MissingIndexesData,
  type ReplicationLagData,
  type SlowQueriesData,
  type UnusedIndexesData,
  type VacuumStatusData,
  type WalThroughputData,
  healthActiveConnections,
  healthBloat,
  healthCacheHit,
  healthDbSize,
  healthLongRunning,
  healthMissingIndexes,
  healthReplicationLag,
  healthSlowQueries,
  healthSnapshotsSave,
  healthUnusedIndexes,
  healthVacuumStatus,
  healthWalThroughput,
} from "../../lib/tauri";
import { useConnections } from "../connections/store";
import { lsKey } from "./refreshInterval";
import { ALL_CARDS, useHealth } from "./store";

vi.mock("../../lib/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../lib/tauri")>("../../lib/tauri");
  return {
    ...actual,
    healthDbSize: vi.fn(),
    healthBloat: vi.fn(),
    healthSlowQueries: vi.fn(),
    healthMissingIndexes: vi.fn(),
    healthUnusedIndexes: vi.fn(),
    healthCacheHit: vi.fn(),
    healthActiveConnections: vi.fn(),
    healthLongRunning: vi.fn(),
    healthVacuumStatus: vi.fn(),
    healthReplicationLag: vi.fn(),
    healthWalThroughput: vi.fn(),
    healthSnapshotsSave: vi.fn().mockResolvedValue(undefined),
  };
});

const fakeConn = (id: string, env: Connection["environment"] = "local"): Connection => ({
  id,
  name: `conn-${id}`,
  host: "localhost",
  port: 5432,
  database: "db",
  username: "u",
  sslMode: "disable",
  hasPassword: false,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  lastTestedAt: null,
  lastTestOk: null,
  excludeFromHistory: false,
  excludeFromRecentPlans: false,
  environment: env,
  readOnly: false,
  slowQueryWarning: false,
  confirmDestructive: false,
});

const okDbSize: DbSizeData = {
  bytes: 12345,
  pretty: "12 kB",
  growth7dBytes: null,
  growth7dPct: null,
  sparklinePoints: [],
};
const okBloat: BloatTopData = { rows: [] };
const okSlow: SlowQueriesData = {
  rows: [{ query: "SELECT 1", meanTimeMs: 1, totalTimeMs: 1, calls: 1 }],
};
const okMissing: MissingIndexesData = { rows: [] };
const okUnused: UnusedIndexesData = { rows: [] };
const okCache: CacheHitData = { ratioPct: 99.5 };
const okActive: ActiveConnectionsData = { current: 5, max: 100, byState: { active: 5 } };
const okLong: LongRunningData = {
  rows: [
    {
      pid: 1,
      durationSeconds: 60,
      query: "SELECT pg_sleep(60)",
      state: "active",
      username: "u",
    },
  ],
};
const okVacuum: VacuumStatusData = { rows: [] };
const okReplStreaming: ReplicationLagData = {
  state: "streaming",
  slots: [{ slot: "s1", lagBytes: 0, lagSeconds: 0, state: "streaming" }],
};
const okReplNone: ReplicationLagData = { state: "no_replicas", slots: [] };
const okWal: WalThroughputData = {
  bytesPerSec: 1024,
  totalBytes: 1024,
  secondsSinceReset: 1,
};

function ok<T>(data: T): CardResult<T> {
  return { ok: true, data };
}
// biome-ignore lint/suspicious/noExplicitAny: discriminated unions of card error variants.
function err(error: any): CardResult<any> {
  return { ok: false, error };
}

/** Wire all 11 IPC mocks to ok-results in the default happy-path shape. */
function wireHappyPath(): void {
  vi.mocked(healthDbSize).mockResolvedValue(ok(okDbSize));
  vi.mocked(healthBloat).mockResolvedValue(ok(okBloat));
  vi.mocked(healthSlowQueries).mockResolvedValue(ok(okSlow));
  vi.mocked(healthMissingIndexes).mockResolvedValue(ok(okMissing));
  vi.mocked(healthUnusedIndexes).mockResolvedValue(ok(okUnused));
  vi.mocked(healthCacheHit).mockResolvedValue(ok(okCache));
  vi.mocked(healthActiveConnections).mockResolvedValue(ok(okActive));
  vi.mocked(healthLongRunning).mockResolvedValue(ok(okLong));
  vi.mocked(healthVacuumStatus).mockResolvedValue(ok(okVacuum));
  vi.mocked(healthReplicationLag).mockResolvedValue(ok(okReplStreaming));
  vi.mocked(healthWalThroughput).mockResolvedValue(ok(okWal));
}

beforeEach(() => {
  // Fresh store between tests.
  useHealth.setState({ byConn: new Map() });
  useConnections.setState({ connections: [fakeConn("c1", "local")] });
  window.localStorage.clear();
});
afterEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe("ensureConn", () => {
  it("creates a per-conn slice with env-default interval on first call", () => {
    useConnections.setState({ connections: [fakeConn("c1", "prod")] });
    const slice = useHealth.getState().ensureConn("c1");
    // Health opens with auto-refresh Off until the user opts in.
    expect(slice.refreshIntervalMs).toBeNull();
    expect(slice.cards.size).toBe(0);
    expect(useHealth.getState().byConn.has("c1")).toBe(true);
  });

  it("is idempotent — second call returns same slice", () => {
    const a = useHealth.getState().ensureConn("c1");
    const b = useHealth.getState().ensureConn("c1");
    expect(a).toBe(b);
  });

  it("defaults env to 'local' when connection isn't in the connections store", () => {
    useConnections.setState({ connections: [] });
    const slice = useHealth.getState().ensureConn("ghost");
    expect(slice.refreshIntervalMs).toBeNull();
  });
});

describe("forConn", () => {
  it("returns the existing per-conn slice without mutation", () => {
    useHealth.getState().ensureConn("c1");
    const before = useHealth.getState().byConn.size;
    useHealth.getState().forConn("c1");
    expect(useHealth.getState().byConn.size).toBe(before);
  });

  it("returns a default skeleton without inserting into byConn", () => {
    const slice = useHealth.getState().forConn("ghost");
    expect(slice.cards.size).toBe(0);
    expect(slice.refreshInProgress).toBe(false);
    expect(useHealth.getState().byConn.has("ghost")).toBe(false);
  });
});

describe("refreshAll happy path", () => {
  it("populates all cards as ready (with empty-positive translation)", async () => {
    wireHappyPath();
    await useHealth.getState().refreshAll("c1");
    const slice = useHealth.getState().forConn("c1");
    expect(slice.cards.size).toBe(ALL_CARDS.length);
    // All non-empty-positive cards → ready.
    expect(slice.cards.get("db_size")?.status).toBe("ready");
    expect(slice.cards.get("bloat")?.status).toBe("ready");
    expect(slice.cards.get("cache_hit")?.status).toBe("ready");
    expect(slice.cards.get("active_connections")?.status).toBe("ready");
    expect(slice.cards.get("vacuum_status")?.status).toBe("ready");
    expect(slice.cards.get("replication_lag")?.status).toBe("ready");
    // Long_running has 1 row → ready; slow_queries has 1 row → ready.
    expect(slice.cards.get("long_running")?.status).toBe("ready");
    expect(slice.cards.get("slow_queries")?.status).toBe("ready");
    expect(slice.refreshInProgress).toBe(false);
    expect(slice.lastRefreshAt).not.toBeNull();
  });

  it("fires snapshot save with db_size bytes on success", async () => {
    wireHappyPath();
    await useHealth.getState().refreshAll("c1");
    // healthSnapshotsSave is fire-and-forget; allow microtasks to flush.
    await Promise.resolve();
    expect(vi.mocked(healthSnapshotsSave)).toHaveBeenCalledWith("c1", okDbSize.bytes);
  });
});

describe("refreshAll mixed states", () => {
  it("translates each error variant to its CardState", async () => {
    vi.mocked(healthDbSize).mockResolvedValue(ok(okDbSize));
    vi.mocked(healthBloat).mockResolvedValue(ok(okBloat));
    vi.mocked(healthCacheHit).mockResolvedValue(ok(okCache));
    vi.mocked(healthActiveConnections).mockResolvedValue(ok(okActive));
    // 3 unavailable
    vi.mocked(healthSlowQueries).mockResolvedValue(
      err({ kind: "unavailable", extension: "pg_stat_statements", installSql: "CREATE …;" }),
    );
    vi.mocked(healthMissingIndexes).mockResolvedValue(
      err({ kind: "unavailable", extension: "x", installSql: "CREATE EXTENSION x;" }),
    );
    vi.mocked(healthUnusedIndexes).mockResolvedValue(
      err({ kind: "unavailable", extension: "y", installSql: "CREATE EXTENSION y;" }),
    );
    // 1 forbidden
    vi.mocked(healthReplicationLag).mockResolvedValue(
      err({ kind: "forbidden", requiredRole: "pg_monitor" }),
    );
    // 1 queryFailed
    vi.mocked(healthVacuumStatus).mockResolvedValue(err({ kind: "queryFailed", message: "boom" }));
    // 1 empty-translation (long_running rows=[])
    vi.mocked(healthLongRunning).mockResolvedValue(ok({ rows: [] } as LongRunningData));

    await useHealth.getState().refreshAll("c1");
    const cards = useHealth.getState().forConn("c1").cards;

    expect(cards.get("slow_queries")).toMatchObject({
      status: "unavailable",
      extension: "pg_stat_statements",
    });
    expect(cards.get("missing_indexes")?.status).toBe("unavailable");
    expect(cards.get("unused_indexes")?.status).toBe("unavailable");
    expect(cards.get("replication_lag")).toMatchObject({
      status: "forbidden",
      requiredRole: "pg_monitor",
    });
    expect(cards.get("vacuum_status")).toMatchObject({ status: "error", message: "boom" });
    expect(cards.get("long_running")).toMatchObject({ status: "empty", reason: "no_data" });

    // OK results stay ready.
    expect(cards.get("db_size")?.status).toBe("ready");
    expect(cards.get("bloat")?.status).toBe("ready");
    expect(cards.get("cache_hit")?.status).toBe("ready");
    expect(cards.get("active_connections")?.status).toBe("ready");
  });

  it("notConnected error maps to error with i18n key", async () => {
    wireHappyPath();
    vi.mocked(healthDbSize).mockResolvedValue(err({ kind: "notConnected" }));
    await useHealth.getState().refreshAll("c1");
    expect(useHealth.getState().forConn("c1").cards.get("db_size")).toMatchObject({
      status: "error",
      message: "editor.run.no_connection",
    });
  });

  it("does NOT fire snapshot save when db_size errors", async () => {
    wireHappyPath();
    vi.mocked(healthDbSize).mockResolvedValue(err({ kind: "queryFailed", message: "oops" }));
    await useHealth.getState().refreshAll("c1");
    await Promise.resolve();
    expect(vi.mocked(healthSnapshotsSave)).not.toHaveBeenCalled();
  });
});

describe("empty-positive translations", () => {
  it("replication_lag with state=no_replicas → empty/no_replicas", async () => {
    wireHappyPath();
    vi.mocked(healthReplicationLag).mockResolvedValue(ok(okReplNone));
    await useHealth.getState().refreshAll("c1");
    expect(useHealth.getState().forConn("c1").cards.get("replication_lag")).toEqual({
      status: "empty",
      reason: "no_replicas",
    });
  });

  it("long_running with rows=[] → empty/no_data", async () => {
    wireHappyPath();
    vi.mocked(healthLongRunning).mockResolvedValue(ok({ rows: [] } as LongRunningData));
    await useHealth.getState().refreshAll("c1");
    expect(useHealth.getState().forConn("c1").cards.get("long_running")).toEqual({
      status: "empty",
      reason: "no_data",
    });
  });

  it("slow_queries with rows=[] (extension installed) → empty/no_data", async () => {
    wireHappyPath();
    vi.mocked(healthSlowQueries).mockResolvedValue(ok({ rows: [] } as SlowQueriesData));
    await useHealth.getState().refreshAll("c1");
    expect(useHealth.getState().forConn("c1").cards.get("slow_queries")).toEqual({
      status: "empty",
      reason: "no_data",
    });
  });
});

describe("refreshOne", () => {
  it("updates only the targeted card", async () => {
    wireHappyPath();
    await useHealth.getState().refreshAll("c1");
    // Now flip cache_hit response and refresh just that card.
    vi.mocked(healthCacheHit).mockResolvedValue(ok({ ratioPct: 50 }));
    await useHealth.getState().refreshOne("c1", "cache_hit");
    const cards = useHealth.getState().forConn("c1").cards;
    const cacheState = cards.get("cache_hit");
    expect(cacheState?.status).toBe("ready");
    if (cacheState?.status === "ready" && cacheState.card.id === "cache_hit") {
      expect(cacheState.card.data.ratioPct).toBe(50);
    }
    // Other cards are untouched (still ready from refreshAll).
    expect(cards.get("db_size")?.status).toBe("ready");
  });

  it("snapshot save fires when refreshOne targets db_size", async () => {
    wireHappyPath();
    useHealth.getState().ensureConn("c1");
    await useHealth.getState().refreshOne("c1", "db_size");
    await Promise.resolve();
    expect(vi.mocked(healthSnapshotsSave)).toHaveBeenCalledWith("c1", okDbSize.bytes);
  });
});

describe("setRefreshInterval", () => {
  it("writes ms to LS and updates the slice", () => {
    useHealth.getState().ensureConn("c1");
    useHealth.getState().setRefreshInterval("c1", 60_000);
    expect(window.localStorage.getItem(lsKey("c1"))).toBe("60000");
    expect(useHealth.getState().forConn("c1").refreshIntervalMs).toBe(60_000);
  });

  it("writes 'off' to LS for null", () => {
    useHealth.getState().ensureConn("c1");
    useHealth.getState().setRefreshInterval("c1", null);
    expect(window.localStorage.getItem(lsKey("c1"))).toBe("off");
    expect(useHealth.getState().forConn("c1").refreshIntervalMs).toBeNull();
  });
});

describe("clearConn", () => {
  it("drops the entry from byConn", () => {
    useHealth.getState().ensureConn("c1");
    expect(useHealth.getState().byConn.has("c1")).toBe(true);
    useHealth.getState().clearConn("c1");
    expect(useHealth.getState().byConn.has("c1")).toBe(false);
  });

  it("is a no-op for unknown ids", () => {
    expect(() => useHealth.getState().clearConn("ghost")).not.toThrow();
  });
});

describe("ALL_CARDS", () => {
  it("contains exactly 12 ids (added jsonb_index_suggestions)", () => {
    expect(ALL_CARDS).toHaveLength(12);
    expect(ALL_CARDS).toContain("wal_throughput");
    expect(ALL_CARDS).toContain("jsonb_index_suggestions");
  });
});
