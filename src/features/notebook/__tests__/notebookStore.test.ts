/**
 * — Notebook store tests.
 *
 * Mocks the `@tauri-apps/api/core` invoke layer + the typed `lib/tauri`
 * `queryExecute` wrapper so the store can be exercised end-to-end (load,
 * save, runCell, runFrom, error path) without spinning up Tauri.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

const queryExecuteMock = vi.fn();
vi.mock("../../../lib/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/tauri")>("../../../lib/tauri");
  return {
    ...actual,
    queryExecute: (...args: unknown[]) => queryExecuteMock(...args),
  };
});

import { useNotebooks } from "../store";
import type { Notebook } from "../types";

function nb(partial: Partial<Notebook> = {}): Notebook {
  return {
    id: "nb-1",
    name: "Untitled",
    cells: [],
    connectionId: null,
    filePath: null,
    createdAt: "2026-05-06T00:00:00Z",
    updatedAt: "2026-05-06T00:00:00Z",
    ...partial,
  };
}

beforeEach(() => {
  invokeMock.mockReset();
  queryExecuteMock.mockReset();
  useNotebooks.setState({
    byId: {},
    loaded: false,
    runStateByCellId: {},
    runningByNotebookId: {},
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("notebook store — hydrate / load / save", () => {
  it("hydrate populates byId from notebook_list", async () => {
    invokeMock.mockResolvedValueOnce([nb({ id: "a" }), nb({ id: "b" })]);
    await useNotebooks.getState().hydrate();
    expect(invokeMock).toHaveBeenCalledWith("notebook_list");
    const ids = Object.keys(useNotebooks.getState().byId).sort();
    expect(ids).toEqual(["a", "b"]);
    expect(useNotebooks.getState().loaded).toBe(true);
  });

  it("load returns cached value without hitting the backend", async () => {
    useNotebooks.setState({ byId: { a: nb({ id: "a", name: "cached" }) } });
    const res = await useNotebooks.getState().load("a");
    expect(res?.name).toBe("cached");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("load falls back to notebook_get and caches", async () => {
    invokeMock.mockResolvedValueOnce(nb({ id: "x", name: "from-disk" }));
    const res = await useNotebooks.getState().load("x");
    expect(invokeMock).toHaveBeenCalledWith("notebook_get", { id: "x" });
    expect(res?.name).toBe("from-disk");
    expect(useNotebooks.getState().byId.x?.name).toBe("from-disk");
  });

  it("save round-trips through notebook_save and updates the cache", async () => {
    invokeMock.mockResolvedValueOnce(nb({ id: "n2", name: "saved" }));
    const saved = await useNotebooks
      .getState()
      .save({ id: "n2", name: "saved", cells: [], connectionId: null });
    expect(saved.name).toBe("saved");
    expect(useNotebooks.getState().byId.n2?.name).toBe("saved");
  });

  it("remove invokes notebook_delete and drops from the cache", async () => {
    useNotebooks.setState({ byId: { dead: nb({ id: "dead" }) } });
    invokeMock.mockResolvedValueOnce(undefined);
    await useNotebooks.getState().remove("dead");
    expect(invokeMock).toHaveBeenCalledWith("notebook_delete", { id: "dead" });
    expect(useNotebooks.getState().byId.dead).toBeUndefined();
  });

  it("composeSql delegates to notebook_compose_sql with the correct payload", async () => {
    invokeMock.mockResolvedValueOnce({ sql: "SELECT 1", importedNames: [] });
    const cells: Parameters<ReturnType<typeof useNotebooks.getState>["composeSql"]>[0] = [
      { kind: "sql", id: "c1", source: "SELECT 1", shareAsCte: false },
    ];
    const res = await useNotebooks.getState().composeSql(cells, 0);
    expect(invokeMock).toHaveBeenCalledWith("notebook_compose_sql", { cells, targetIdx: 0 });
    expect(res.sql).toBe("SELECT 1");
  });

  it("import / export wrap the file IPC commands", async () => {
    invokeMock.mockResolvedValueOnce(undefined); // export_file
    const target = nb({ id: "exp" });
    await useNotebooks.getState().exportFile(target, "/tmp/foo.ide99nb");
    expect(invokeMock).toHaveBeenCalledWith("notebook_export_file", {
      notebook: target,
      path: "/tmp/foo.ide99nb",
    });
    invokeMock.mockResolvedValueOnce(nb({ id: "imp", name: "imported" }));
    const imp = await useNotebooks.getState().importFile("/tmp/foo.ide99nb");
    expect(imp.name).toBe("imported");
    expect(useNotebooks.getState().byId.imp).toBeDefined();
  });
});

describe("notebook store — runCell", () => {
  it("composes SQL, executes, and persists the result snapshot", async () => {
    const initial = nb({
      id: "n3",
      cells: [{ kind: "sql", id: "c1", source: "SELECT 1", shareAsCte: false }],
    });
    useNotebooks.setState({ byId: { n3: initial } });

    invokeMock
      .mockResolvedValueOnce({ sql: "SELECT 1", importedNames: [] }) // notebook_compose_sql
      // notebook_save returns the persisted notebook with the new result.
      .mockImplementation(async (_cmd: string, args: { input?: Notebook }) => args.input ?? null);

    queryExecuteMock.mockResolvedValueOnce({
      columns: [{ name: "n", typeName: "int4", isNumeric: true }],
      rows: [["1"]],
      truncated: false,
      durationMs: 5,
      affectedRows: null,
      statusMessage: "SELECT 1",
    });

    await useNotebooks.getState().runCell("n3", "c1", "conn-1");
    const persisted = useNotebooks.getState().byId.n3;
    const cell = persisted?.cells[0];
    if (!cell || cell.kind !== "sql") throw new Error("expected sql cell");
    expect(cell.result?.columns).toEqual(["n"]);
    expect(cell.result?.rows).toEqual([["1"]]);
    expect(useNotebooks.getState().runStateByCellId.c1?.status).toBe("ok");
    expect(useNotebooks.getState().runningByNotebookId.n3).toBe(false);
  });

  it("records an error state when query_execute throws", async () => {
    const initial = nb({
      id: "err",
      cells: [{ kind: "sql", id: "boom", source: "BAD", shareAsCte: false }],
    });
    useNotebooks.setState({ byId: { err: initial } });

    invokeMock.mockResolvedValueOnce({ sql: "BAD", importedNames: [] });
    queryExecuteMock.mockRejectedValueOnce(new Error("syntax error"));

    await expect(useNotebooks.getState().runCell("err", "boom", "conn-1")).rejects.toThrow(      "syntax error",
);
    const rs = useNotebooks.getState().runStateByCellId.boom;
    expect(rs?.status).toBe("error");
    if (rs?.status === "error") expect(rs.message).toContain("syntax error");
  });

  it("runFrom skips non-SQL cells but executes the rest in order", async () => {
    const cells = [
      { kind: "markdown", id: "m1", source: "# hi" },
      { kind: "sql", id: "s1", source: "SELECT 1", shareAsCte: false },
      { kind: "sql", id: "s2", source: "SELECT 2", shareAsCte: false },
    ] satisfies Notebook["cells"];
    useNotebooks.setState({ byId: { multi: nb({ id: "multi", cells }) } });

    invokeMock.mockImplementation(async (cmd: string, args: { input?: Notebook }) => {
      if (cmd === "notebook_compose_sql") return { sql: "SELECT", importedNames: [] };
      if (cmd === "notebook_save") return args.input ?? null;
      return null;
    });
    queryExecuteMock.mockResolvedValue({
      columns: [],
      rows: [],
      truncated: false,
      durationMs: 1,
      affectedRows: null,
      statusMessage: "SELECT 0",
    });

    await useNotebooks.getState().runFrom("multi", null, "conn-1");
    expect(queryExecuteMock).toHaveBeenCalledTimes(2);
    const states = useNotebooks.getState().runStateByCellId;
    expect(states.s1?.status).toBe("ok");
    expect(states.s2?.status).toBe("ok");
  });

  it("runFrom stops the cascade on the first error", async () => {
    const cells = [
      { kind: "sql", id: "s1", source: "BAD", shareAsCte: false },
      { kind: "sql", id: "s2", source: "GOOD", shareAsCte: false },
    ] satisfies Notebook["cells"];
    useNotebooks.setState({ byId: { c: nb({ id: "c", cells }) } });

    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "notebook_compose_sql") return { sql: "X", importedNames: [] };
      return null;
    });
    queryExecuteMock.mockRejectedValueOnce(new Error("boom"));

    await useNotebooks.getState().runFrom("c", null, "conn-1");
    expect(queryExecuteMock).toHaveBeenCalledTimes(1);
    expect(useNotebooks.getState().runStateByCellId.s1?.status).toBe("error");
    expect(useNotebooks.getState().runStateByCellId.s2).toBeUndefined();
  });

  it("cache replaces the in-memory notebook without IPC", () => {
    const fresh = nb({ id: "x", name: "local" });
    useNotebooks.getState().cache(fresh);
    expect(useNotebooks.getState().byId.x?.name).toBe("local");
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
