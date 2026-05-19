import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Connection } from "../../lib/tauri";

const listConnectionsMock = vi.fn();
const connectionSetExcludeFromHistoryMock = vi.fn();

vi.mock("../../lib/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../lib/tauri")>("../../lib/tauri");
  return {
    ...actual,
    listConnections: () => listConnectionsMock(),
    connectionSetExcludeFromHistory: (id: string, exclude: boolean) =>
      connectionSetExcludeFromHistoryMock(id, exclude),
  };
});

import { useConnections } from "./store";

function makeConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: overrides.id ?? "id-1",
    name: overrides.name ?? "alpha",
    host: overrides.host ?? "localhost",
    port: overrides.port ?? 5432,
    database: overrides.database ?? "postgres",
    username: overrides.username ?? "postgres",
    sslMode: overrides.sslMode ?? "prefer",
    hasPassword: overrides.hasPassword ?? false,
    createdAt: overrides.createdAt ?? "2026-04-27T00:00:00Z",
    updatedAt: overrides.updatedAt ?? "2026-04-27T00:00:00Z",
    lastTestedAt: overrides.lastTestedAt ?? null,
    lastTestOk: overrides.lastTestOk ?? null,
    excludeFromHistory: overrides.excludeFromHistory ?? false,
    excludeFromRecentPlans: overrides.excludeFromRecentPlans ?? false,
    environment: overrides.environment ?? "local",
    readOnly: overrides.readOnly ?? false,
    slowQueryWarning: overrides.slowQueryWarning ?? false,
    confirmDestructive: overrides.confirmDestructive ?? false,
  };
}

const initialState = useConnections.getState();

beforeEach(() => {
  listConnectionsMock.mockReset();
  connectionSetExcludeFromHistoryMock.mockReset();
  connectionSetExcludeFromHistoryMock.mockResolvedValue(undefined);
  useConnections.setState(
    {
      ...initialState,
      connections: [],
      selectedId: null,
      formMode: { type: "closed" },
      loading: false,
      error: null,
    },
    true,
  );
});

describe("useConnections store", () => {
  test("load() populates connections from listConnections", async () => {
    const conn = makeConnection();
    listConnectionsMock.mockResolvedValueOnce([conn]);

    await useConnections.getState().load();

    const state = useConnections.getState();
    expect(state.connections).toEqual([conn]);
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
  });

  test("load() captures errors and resets loading", async () => {
    listConnectionsMock.mockRejectedValueOnce(new Error("boom"));

    await useConnections.getState().load();

    const state = useConnections.getState();
    expect(state.error).toContain("boom");
    expect(state.loading).toBe(false);
    expect(state.connections).toEqual([]);
  });

  test("select() sets selectedId", () => {
    useConnections.getState().select("abc");
    expect(useConnections.getState().selectedId).toBe("abc");

    useConnections.getState().select(null);
    expect(useConnections.getState().selectedId).toBeNull();
  });

  test("openCreateForm() switches form mode with prefill", () => {
    useConnections.getState().openCreateForm({ host: "db.example.com", port: 5433 });
    const { formMode } = useConnections.getState();
    expect(formMode.type).toBe("create");
    if (formMode.type === "create") {
      expect(formMode.prefill).toEqual({ host: "db.example.com", port: 5433 });
    }
  });

  test("openCreateForm() defaults prefill to undefined", () => {
    useConnections.getState().openCreateForm();
    const { formMode } = useConnections.getState();
    expect(formMode.type).toBe("create");
    if (formMode.type === "create") {
      expect(formMode.prefill).toBeUndefined();
    }
  });

  test("openEditForm() captures id", () => {
    useConnections.getState().openEditForm("xyz");
    const { formMode } = useConnections.getState();
    expect(formMode).toEqual({ type: "edit", id: "xyz" });
  });

  test("closeForm() returns to closed", () => {
    useConnections.getState().openEditForm("xyz");
    useConnections.getState().closeForm();
    expect(useConnections.getState().formMode).toEqual({ type: "closed" });
  });

  test("upsertLocal() inserts new connection sorted by name", () => {
    const a = makeConnection({ id: "a", name: "zeta" });
    const b = makeConnection({ id: "b", name: "alpha" });
    useConnections.setState({ connections: [a] });

    useConnections.getState().upsertLocal(b);

    expect(useConnections.getState().connections.map((c) => c.id)).toEqual(["b", "a"]);
  });

  test("upsertLocal() updates existing connection in place", () => {
    const a = makeConnection({ id: "a", name: "alpha", host: "old" });
    useConnections.setState({ connections: [a] });

    useConnections.getState().upsertLocal({ ...a, host: "new" });

    const list = useConnections.getState().connections;
    expect(list).toHaveLength(1);
    expect(list[0]?.host).toBe("new");
  });

  test("removeLocal() removes connection and clears selection if it matched", () => {
    const a = makeConnection({ id: "a" });
    const b = makeConnection({ id: "b", name: "beta" });
    useConnections.setState({ connections: [a, b], selectedId: "a" });

    useConnections.getState().removeLocal("a");

    const state = useConnections.getState();
    expect(state.connections.map((c) => c.id)).toEqual(["b"]);
    expect(state.selectedId).toBeNull();
  });

  test("removeLocal() preserves selectedId when removing a different connection", () => {
    const a = makeConnection({ id: "a" });
    const b = makeConnection({ id: "b", name: "beta" });
    useConnections.setState({ connections: [a, b], selectedId: "b" });

    useConnections.getState().removeLocal("a");

    expect(useConnections.getState().selectedId).toBe("b");
  });

  test("setExcludeFromHistory() forwards to IPC and mutates the local row", async () => {
    const a = makeConnection({ id: "a", excludeFromHistory: false });
    const b = makeConnection({ id: "b", name: "beta", excludeFromHistory: false });
    useConnections.setState({ connections: [a, b] });

    await useConnections.getState().setExcludeFromHistory("a", true);

    expect(connectionSetExcludeFromHistoryMock).toHaveBeenCalledWith("a", true);
    const list = useConnections.getState().connections;
    expect(list.find((c) => c.id === "a")?.excludeFromHistory).toBe(true);
    expect(list.find((c) => c.id === "b")?.excludeFromHistory).toBe(false);
  });

  test("setExcludeFromHistory() leaves state untouched when IPC throws", async () => {
    const a = makeConnection({ id: "a", excludeFromHistory: false });
    useConnections.setState({ connections: [a] });
    connectionSetExcludeFromHistoryMock.mockRejectedValueOnce(new Error("boom"));

    await expect(useConnections.getState().setExcludeFromHistory("a", true)).rejects.toThrow(
      "boom",
    );

    const list = useConnections.getState().connections;
    expect(list.find((c) => c.id === "a")?.excludeFromHistory).toBe(false);
  });
});
