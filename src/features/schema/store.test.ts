import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ConnectInfo, MatviewSummary, SchemaInfo, TableInfo, ViewInfo } from "../../lib/tauri";

const connectionConnectMock = vi.fn();
const connectionDisconnectMock = vi.fn();
const schemaListSchemasMock = vi.fn();
const schemaListTablesMock = vi.fn();
const schemaListViewsMock = vi.fn();
const schemaListMatviewsMock = vi.fn();

vi.mock("../../lib/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../lib/tauri")>("../../lib/tauri");
  return {
    ...actual,
    connectionConnect: (id: string) => connectionConnectMock(id),
    connectionDisconnect: (id: string) => connectionDisconnectMock(id),
    schemaListSchemas: (connId: string) => schemaListSchemasMock(connId),
    schemaListTables: (connId: string, schema: string) => schemaListTablesMock(connId, schema),
    schemaListViews: (connId: string, schema: string) => schemaListViewsMock(connId, schema),
    schemaListMatviews: (connId: string, schema: string) => schemaListMatviewsMock(connId, schema),
  };
});

import { __testing, useSchema } from "./store";

const initial = useSchema.getState();

function reset() {
  __testing.clearInFlight();
  useSchema.setState(
    {
      ...initial,
      connection: { status: "idle" },
      cache: new Map(),
      selectedNode: null,
      filter: "",
    },
    true,
  );
}

const connectInfo: ConnectInfo = { serverVersion: "PostgreSQL 17", database: "myapp" };
const publicSchema: SchemaInfo = { name: "public", owner: "postgres" };
const usersTable: TableInfo = { name: "users", comment: null };
const ordersTable: TableInfo = { name: "orders", comment: null };
const activeUsersView: ViewInfo = {
  name: "active_users",
  definition: "SELECT * FROM users",
  comment: null,
};
const dailyStatsMatview: MatviewSummary = {
  name: "daily_stats",
  populated: true,
  comment: null,
};

beforeEach(() => {
  connectionConnectMock.mockReset();
  connectionDisconnectMock.mockReset();
  schemaListSchemasMock.mockReset();
  schemaListTablesMock.mockReset();
  schemaListViewsMock.mockReset();
  schemaListMatviewsMock.mockReset();
  reset();
});

describe("useSchema connection lifecycle", () => {
  test("connect: idle → connecting → connected with eager schemas load", async () => {
    connectionConnectMock.mockResolvedValueOnce(connectInfo);
    schemaListSchemasMock.mockResolvedValueOnce([publicSchema]);

    const promise = useSchema.getState().connect("conn-1");
    // Mid-flight should be in connecting state.
    expect(useSchema.getState().connection.status).toBe("connecting");

    await promise;
    const state = useSchema.getState();
    expect(state.connection).toEqual({
      status: "connected",
      connId: "conn-1",
      serverVersion: "PostgreSQL 17",
      database: "myapp",
    });
    // Schemas root must be cached after eager load.
    expect(state.cache.get("schemas")).toEqual([
      { id: "schema:public", name: "public", kind: "schema", hasChildren: true },
    ]);
    expect(connectionConnectMock).toHaveBeenCalledWith("conn-1");
    expect(schemaListSchemasMock).toHaveBeenCalledWith("conn-1");
  });

  test("connect: idle → connecting → error on connectionConnect failure", async () => {
    connectionConnectMock.mockRejectedValueOnce(new Error("auth failed"));

    await useSchema.getState().connect("conn-1");

    const state = useSchema.getState();
    expect(state.connection).toEqual({
      status: "error",
      connId: "conn-1",
      error: null,
      message: "auth failed",
    });
    expect(state.cache.size).toBe(0);
    // Should not attempt to list schemas on a failed connection.
    expect(schemaListSchemasMock).not.toHaveBeenCalled();
  });

  test("connect succeeds even if eager schemas load fails (state stays connected)", async () => {
    connectionConnectMock.mockResolvedValueOnce(connectInfo);
    schemaListSchemasMock.mockRejectedValueOnce(new Error("transient"));

    await useSchema.getState().connect("conn-1");

    expect(useSchema.getState().connection.status).toBe("connected");
    expect(useSchema.getState().cache.has("schemas")).toBe(false);
  });

  test("disconnect from connected: clears cache, selection, filter", async () => {
    connectionDisconnectMock.mockResolvedValueOnce(undefined);
    useSchema.setState({
      connection: {
        status: "connected",
        connId: "conn-1",
        serverVersion: "PG",
        database: "db",
      },
      cache: new Map([
        ["schemas", [{ id: "schema:public", name: "public", kind: "schema", hasChildren: true }]],
      ]),
      selectedNode: "table:public/users",
      filter: "us",
    });

    await useSchema.getState().disconnect();

    const state = useSchema.getState();
    expect(state.connection).toEqual({ status: "idle" });
    expect(state.cache.size).toBe(0);
    expect(state.selectedNode).toBeNull();
    expect(state.filter).toBe("");
    expect(connectionDisconnectMock).toHaveBeenCalledWith("conn-1");
  });

  test("disconnect when not connected: no-op (does not call backend)", async () => {
    await useSchema.getState().disconnect();
    expect(connectionDisconnectMock).not.toHaveBeenCalled();
    expect(useSchema.getState().connection.status).toBe("idle");
  });
});

describe("useSchema loadChildren", () => {
  beforeEach(() => {
    useSchema.setState({
      connection: {
        status: "connected",
        connId: "conn-1",
        serverVersion: "PG",
        database: "db",
      },
      cache: new Map(),
    });
  });

  test('"schemas" → maps to schema:NAME children', async () => {
    schemaListSchemasMock.mockResolvedValueOnce([publicSchema]);

    const children = await useSchema.getState().loadChildren("schemas");

    expect(children).toEqual([
      { id: "schema:public", name: "public", kind: "schema", hasChildren: true },
    ]);
    expect(useSchema.getState().cache.get("schemas")).toEqual(children);
  });

  test('"schema:NAME" → synthetic tables-group + views-group + matviews-group, no backend call', async () => {
    const children = await useSchema.getState().loadChildren("schema:public");

    expect(children).toEqual([
      {
        id: "schema:public/tables",
        name: "schema.tree.tables_group",
        kind: "tables-group",
        hasChildren: true,
      },
      {
        id: "schema:public/views",
        name: "schema.tree.views_group",
        kind: "views-group",
        hasChildren: true,
      },
      {
        id: "schema:public/matviews",
        name: "schema.tree.matviews_group",
        kind: "matviews-group",
        hasChildren: true,
      },
    ]);
    expect(schemaListTablesMock).not.toHaveBeenCalled();
    expect(schemaListViewsMock).not.toHaveBeenCalled();
    expect(schemaListMatviewsMock).not.toHaveBeenCalled();
  });

  test('"schema:NAME/tables" → maps to table leaf children', async () => {
    schemaListTablesMock.mockResolvedValueOnce([usersTable, ordersTable]);

    const children = await useSchema.getState().loadChildren("schema:public/tables");

    expect(children).toEqual([
      { id: "table:public/users", name: "users", kind: "table", hasChildren: true },
      { id: "table:public/orders", name: "orders", kind: "table", hasChildren: true },
    ]);
    expect(schemaListTablesMock).toHaveBeenCalledWith("conn-1", "public");
  });

  test('"schema:NAME/views" → maps to view leaf children', async () => {
    schemaListViewsMock.mockResolvedValueOnce([activeUsersView]);

    const children = await useSchema.getState().loadChildren("schema:public/views");

    expect(children).toEqual([
      {
        id: "view:public/active_users",
        name: "active_users",
        kind: "view",
        hasChildren: false,
      },
    ]);
    expect(schemaListViewsMock).toHaveBeenCalledWith("conn-1", "public");
  });

  test('"schema:NAME/matviews" → maps to matview leaf children', async () => {
    schemaListMatviewsMock.mockResolvedValueOnce([dailyStatsMatview]);

    const children = await useSchema.getState().loadChildren("schema:public/matviews");

    expect(children).toEqual([
      {
        id: "matview:public/daily_stats",
        name: "daily_stats",
        kind: "matview",
        hasChildren: false,
      },
    ]);
    expect(schemaListMatviewsMock).toHaveBeenCalledWith("conn-1", "public");
  });

  test("returns cached value without re-fetching", async () => {
    schemaListSchemasMock.mockResolvedValueOnce([publicSchema]);
    await useSchema.getState().loadChildren("schemas");
    expect(schemaListSchemasMock).toHaveBeenCalledTimes(1);

    await useSchema.getState().loadChildren("schemas");
    expect(schemaListSchemasMock).toHaveBeenCalledTimes(1);
  });

  test("deduplicates concurrent calls for the same key", async () => {
    let resolve: (value: SchemaInfo[]) => void = () => {};
    const pending = new Promise<SchemaInfo[]>((r) => {
      resolve = r;
    });
    schemaListSchemasMock.mockReturnValueOnce(pending);

    const a = useSchema.getState().loadChildren("schemas");
    const b = useSchema.getState().loadChildren("schemas");

    // Only one fetch should be in-flight.
    expect(schemaListSchemasMock).toHaveBeenCalledTimes(1);
    expect(__testing.inFlightSize()).toBe(1);

    resolve([publicSchema]);
    const [aResult, bResult] = await Promise.all([a, b]);
    expect(aResult).toEqual(bResult);
    expect(__testing.inFlightSize()).toBe(0);
  });

  test("throws when not connected", async () => {
    useSchema.setState({ connection: { status: "idle" } });
    await expect(useSchema.getState().loadChildren("schemas")).rejects.toThrow(/not connected/);
  });
});

describe("useSchema refreshAll", () => {
  test("preserves expanded paths by re-fetching previously-cached real parents", async () => {
    // Seed a "previously expanded" tree: schemas → schema:public → tables
    useSchema.setState({
      connection: {
        status: "connected",
        connId: "conn-1",
        serverVersion: "PG",
        database: "db",
      },
      cache: new Map<string, ReturnType<typeof Array<unknown>>>([
        ["schemas", [{ id: "schema:public", name: "public", kind: "schema", hasChildren: true }]],
        [
          "schema:public",
          [
            {
              id: "schema:public/tables",
              name: "schema.tree.tables_group",
              kind: "tables-group",
              hasChildren: true,
            },
            {
              id: "schema:public/views",
              name: "schema.tree.views_group",
              kind: "views-group",
              hasChildren: true,
            },
          ],
        ],
        [
          "schema:public/tables",
          [{ id: "table:public/users", name: "users", kind: "table", hasChildren: true }],
        ],
      ]) as Map<string, never>,
    });

    schemaListSchemasMock.mockResolvedValueOnce([publicSchema]);
    schemaListTablesMock.mockResolvedValueOnce([usersTable]);

    await useSchema.getState().refreshAll();

    // Backend was hit for the real parents only.
    expect(schemaListSchemasMock).toHaveBeenCalledWith("conn-1");
    expect(schemaListTablesMock).toHaveBeenCalledWith("conn-1", "public");
    // Synthetic schema:public must NOT trigger a backend call.
    expect(schemaListViewsMock).not.toHaveBeenCalled();

    const state = useSchema.getState();
    expect(state.cache.get("schemas")).toBeDefined();
    expect(state.cache.get("schema:public/tables")).toEqual([
      { id: "table:public/users", name: "users", kind: "table", hasChildren: true },
    ]);
  });

  test("no-op when not connected", async () => {
    await useSchema.getState().refreshAll();
    expect(schemaListSchemasMock).not.toHaveBeenCalled();
  });

  test("tolerates per-parent errors and continues", async () => {
    useSchema.setState({
      connection: {
        status: "connected",
        connId: "conn-1",
        serverVersion: "PG",
        database: "db",
      },
      cache: new Map<string, never>([
        ["schemas", [] as never],
        ["schema:public/tables", [] as never],
      ]),
    });
    schemaListSchemasMock.mockRejectedValueOnce(new Error("boom"));
    schemaListTablesMock.mockResolvedValueOnce([usersTable]);

    await useSchema.getState().refreshAll();

    // Even after the first parent fails, the second should still load.
    expect(schemaListTablesMock).toHaveBeenCalledTimes(1);
    expect(useSchema.getState().cache.get("schema:public/tables")).toEqual([
      { id: "table:public/users", name: "users", kind: "table", hasChildren: true },
    ]);
  });
});

describe("useSchema setters", () => {
  test("selectNode + setFilter update state", () => {
    useSchema.getState().selectNode("table:public/users");
    expect(useSchema.getState().selectedNode).toBe("table:public/users");

    useSchema.getState().selectNode(null);
    expect(useSchema.getState().selectedNode).toBeNull();

    useSchema.getState().setFilter("usr");
    expect(useSchema.getState().filter).toBe("usr");
  });
});
