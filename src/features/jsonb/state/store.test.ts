import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Connection } from "../../../lib/tauri";
import { jsonbResolveRowKey, jsonbSave } from "../../../lib/tauri";
import { useConnections } from "../../connections/store";
import { type RunState, useEditor } from "../../editor/store";
import { useJsonbEditor } from "./store";

vi.mock("../../../lib/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/tauri")>("../../../lib/tauri");
  return {
    ...actual,
    jsonbResolveRowKey: vi.fn(),
    jsonbSave: vi.fn(),
  };
});

const fakeConn = (id: string, env: Connection["environment"]): Connection => ({
  id,
  name: id,
  host: "localhost",
  port: 5432,
  database: "db",
  username: "u",
  sslMode: "disable",
  hasPassword: false,
  createdAt: "",
  updatedAt: "",
  lastTestedAt: null,
  lastTestOk: null,
  excludeFromHistory: false,
  excludeFromRecentPlans: false,
  environment: env,
  readOnly: false,
  slowQueryWarning: false,
  confirmDestructive: false,
});

function streamingRun(rows: Array<Array<string | null>>): RunState {
  return {
    status: "streaming",
    cursorId: "cur-1",
    columns: [
      { name: "id", typeName: "int4", isNumeric: true },
      { name: "data", typeName: "jsonb", isNumeric: false },
    ],
    rows,
    loadedCount: rows.length,
    exhausted: false,
    durationMs: 0,
    prefetching: false,
    affectedRows: null,
    statusMessage: "",
    sort: null,
    columnWidths: new Map(),
    columnOrder: [0, 1],
  };
}

const initial = useJsonbEditor.getState();

beforeEach(() => {
  // Reset jsonb editor state.
  useJsonbEditor.setState(initial, true);
  // Seed a single connected editor tab with a streaming run.
  const tab = useEditor.getState().openEditorTab("c1");
  const editor = useEditor.getState();
  const next = new Map(editor.runStates);
  next.set(tab.id, streamingRun([["1", '{"a":1}']]));
  useEditor.setState({
    runStates: next,
    tabs: editor.tabs.map((t) =>
      t.id === tab.id && t.kind === "editor" ? { ...t, connectionId: "c1" } : t,
),
  });
  useConnections.setState({
    connections: [fakeConn("c1", "local")],
  } as Partial<ReturnType<typeof useConnections.getState>> as ReturnType<
    typeof useConnections.getState
  >);
  vi.clearAllMocks();
});

afterEach(() => {
  // Clean up tabs to keep the next test isolated.
  useEditor.setState({ tabs: [], runStates: new Map(), activeTabId: null });
});

describe("useJsonbEditor store", () => {
  it("openEditor seeds draft, resolves rowKey, and sets envIsProd=false for local", async () => {
    const tabId = useEditor.getState().tabs[0]?.id ?? "";
    vi.mocked(jsonbResolveRowKey).mockResolvedValueOnce({
      kind: "pk",
      schema: "public",
      table: "events",
      columns: [{ name: "id", value: "1", typeName: "int4" }],
    });

    await useJsonbEditor.getState().openEditor({ tabId, rowIdx: 0, srcColIdx: 1 }, '{"a":1}');

    const s = useJsonbEditor.getState();
    expect(s.open).toBe(true);
    expect(s.original).toBe('{"a":1}');
    expect(s.draft).toBe('{"a":1}');
    expect(s.draftParsed).toEqual({ a: 1 });
    expect(s.draftParseError).toBeNull();
    expect(s.envIsProd).toBe(false);
    expect(s.fqTableName).toBe("public.events");
    expect(s.rowKey?.kind).toBe("pk");
    expect(s.mode).toBe("tree");
  });

  it("openEditor sets envIsProd=true for prod connection", async () => {
    useConnections.setState({
      connections: [fakeConn("c1", "prod")],
    } as Partial<ReturnType<typeof useConnections.getState>> as ReturnType<
      typeof useConnections.getState
    >);
    vi.mocked(jsonbResolveRowKey).mockResolvedValueOnce({
      kind: "pk",
      schema: "public",
      table: "events",
      columns: [{ name: "id", value: "1", typeName: "int4" }],
    });
    const tabId = useEditor.getState().tabs[0]?.id ?? "";
    await useJsonbEditor.getState().openEditor({ tabId, rowIdx: 0, srcColIdx: 1 }, '{"a":1}');
    expect(useJsonbEditor.getState().envIsProd).toBe(true);
  });

  it("openEditor falls back to readOnly with noColumnMetadata on resolve error", async () => {
    const tabId = useEditor.getState().tabs[0]?.id ?? "";
    vi.mocked(jsonbResolveRowKey).mockRejectedValueOnce(new Error("boom"));
    await useJsonbEditor.getState().openEditor({ tabId, rowIdx: 0, srcColIdx: 1 }, '{"a":1}');
    const s = useJsonbEditor.getState();
    expect(s.rowKey).toEqual({ kind: "readOnly", reason: "noColumnMetadata" });
    expect(s.status).toEqual({ kind: "error", message: "boom" });
  });

  it("close resets to initial state", () => {
    useJsonbEditor.setState({ open: true, draft: '{"x":2}' });
    useJsonbEditor.getState().close();
    const s = useJsonbEditor.getState();
    expect(s.open).toBe(false);
    expect(s.draft).toBe("");
    expect(s.args).toBeNull();
  });

  it("setDraft updates draft, parsed, error, and recomputes diff", () => {
    useJsonbEditor.setState({ original: '{"a":1}', draft: '{"a":1}' });
    useJsonbEditor.getState().setDraft('{"a":2}');
    const s = useJsonbEditor.getState();
    expect(s.draft).toBe('{"a":2}');
    expect(s.draftParseError).toBeNull();
    expect(s.diff.ops.length).toBe(1);
    expect(s.diff.ops[0]).toEqual({ kind: "set", path: ["a"], value: 2 });
  });

  it("setDraft with invalid JSON sets draftParseError and empty diff", () => {
    useJsonbEditor.setState({ original: '{"a":1}', draft: '{"a":1}' });
    useJsonbEditor.getState().setDraft("{not json");
    const s = useJsonbEditor.getState();
    expect(s.draftParseError).not.toBeNull();
    expect(s.diff.ops.length).toBe(0);
    expect(s.diff.fullReplace).toBe(false);
  });

  it("setMode updates mode", () => {
    useJsonbEditor.getState().setMode("text");
    expect(useJsonbEditor.getState().mode).toBe("text");
    useJsonbEditor.getState().setMode("table");
    expect(useJsonbEditor.getState().mode).toBe("table");
  });

  it("save invokes jsonbSave and patches the row cell on success", async () => {
    const tabId = useEditor.getState().tabs[0]?.id ?? "";
    useJsonbEditor.setState({
      open: true,
      args: { tabId, rowIdx: 0, srcColIdx: 1 },
      original: '{"a":1}',
      draft: '{"a":2}',
      draftParsed: { a: 2 },
      draftParseError: null,
      rowKey: {
        kind: "pk",
        schema: "public",
        table: "events",
        columns: [{ name: "id", value: "1", typeName: "int4" }],
      },
      fqTableName: "public.events",
      envIsProd: false,
    });
    vi.mocked(jsonbSave).mockResolvedValueOnce({
      sqlExecuted: "UPDATE …",
      affectedRows: 1,
      durationMs: 12,
      newCellValue: '{"a": 2}',
    });

    await useJsonbEditor.getState().save(null);

    expect(jsonbSave).toHaveBeenCalledOnce();
    const ctxArg = vi.mocked(jsonbSave).mock.calls[0][0];
    expect(ctxArg.confirmedTableName).toBeNull();
    expect(ctxArg.column).toBe("data");
    expect(ctxArg.oldValue).toBe('{"a":1}');
    expect(ctxArg.newValue).toBe('{"a":2}');
    expect(useJsonbEditor.getState().status).toEqual({
      kind: "saved",
      affectedRows: 1,
      durationMs: 12,
    });
    // Verify the editor row got patched.
    const run = useEditor.getState().runStates.get(tabId);
    expect(run?.status).toBe("streaming");
    if (run?.status === "streaming") {
      expect(run.rows[0]).toEqual(["1", '{"a": 2}']);
    }
  });

  it("save passes confirmedTableName when supplied (prod path)", async () => {
    const tabId = useEditor.getState().tabs[0]?.id ?? "";
    useJsonbEditor.setState({
      open: true,
      args: { tabId, rowIdx: 0, srcColIdx: 1 },
      original: '{"a":1}',
      draft: '{"a":3}',
      draftParseError: null,
      rowKey: {
        kind: "pk",
        schema: "public",
        table: "events",
        columns: [{ name: "id", value: "1", typeName: "int4" }],
      },
      fqTableName: "public.events",
      envIsProd: true,
    });
    vi.mocked(jsonbSave).mockResolvedValueOnce({
      sqlExecuted: "UPDATE …",
      affectedRows: 1,
      durationMs: 9,
      newCellValue: '{"a": 3}',
    });
    await useJsonbEditor.getState().save("public.events");
    const ctxArg = vi.mocked(jsonbSave).mock.calls[0][0];
    expect(ctxArg.confirmedTableName).toBe("public.events");
  });

  it("save sets error status when jsonbSave rejects", async () => {
    const tabId = useEditor.getState().tabs[0]?.id ?? "";
    useJsonbEditor.setState({
      open: true,
      args: { tabId, rowIdx: 0, srcColIdx: 1 },
      original: '{"a":1}',
      draft: '{"a":4}',
      draftParseError: null,
      rowKey: {
        kind: "pk",
        schema: "public",
        table: "events",
        columns: [{ name: "id", value: "1", typeName: "int4" }],
      },
      fqTableName: "public.events",
    });
    vi.mocked(jsonbSave).mockRejectedValueOnce(new Error("constraint violation"));
    await useJsonbEditor.getState().save(null);
    const s = useJsonbEditor.getState();
    expect(s.status).toEqual({ kind: "error", message: "constraint violation" });
  });

  it("save is a no-op when rowKey is readOnly", async () => {
    const tabId = useEditor.getState().tabs[0]?.id ?? "";
    useJsonbEditor.setState({
      open: true,
      args: { tabId, rowIdx: 0, srcColIdx: 1 },
      original: '{"a":1}',
      draft: '{"a":2}',
      draftParseError: null,
      rowKey: { kind: "readOnly", reason: "viewWithoutPk" },
    });
    await useJsonbEditor.getState().save(null);
    expect(jsonbSave).not.toHaveBeenCalled();
  });

  it("save is a no-op when draft has parse error", async () => {
    const tabId = useEditor.getState().tabs[0]?.id ?? "";
    useJsonbEditor.setState({
      open: true,
      args: { tabId, rowIdx: 0, srcColIdx: 1 },
      original: '{"a":1}',
      draft: "{not",
      draftParseError: "Unexpected token n",
      rowKey: {
        kind: "pk",
        schema: "public",
        table: "events",
        columns: [{ name: "id", value: "1", typeName: "int4" }],
      },
    });
    await useJsonbEditor.getState().save(null);
    expect(jsonbSave).not.toHaveBeenCalled();
  });
});
