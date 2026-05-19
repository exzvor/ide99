import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Connection } from "../../lib/tauri";
import { useConnections } from "../connections/store";
import { useEditor } from "./store";

vi.mock("../../lib/tauri", async () => ({
  ...(await vi.importActual<typeof import("../../lib/tauri")>("../../lib/tauri")),
  queryRunBatch: vi.fn(),
  queryExplainCost: vi.fn(),
  connectionSetSlowQueryWarning: vi.fn().mockResolvedValue(undefined),
}));

// Post-S14 — `runQuery` now routes through `queryRunBatch` instead of
// `queryOpenCursor`. The N=1 destructive-confirm path still delegates to
// `preflightSafety` (kind: "confirm" modal), so this suite continues to
// validate the single-statement preflight contract.
import { queryExplainCost, queryRunBatch } from "../../lib/tauri";

const conn = (overrides: Partial<Connection> = {}): Connection => ({
  id: "c1",
  name: "c1",
  host: "h",
  port: 5432,
  database: "d",
  username: "u",
  sslMode: "disable",
  hasPassword: false,
  createdAt: "",
  updatedAt: "",
  lastTestedAt: null,
  lastTestOk: null,
  excludeFromHistory: false,
  excludeFromRecentPlans: false,
  environment: "local",
  readOnly: false,
  slowQueryWarning: false,
  confirmDestructive: false,
  ...overrides,
});

const tab = (over: Record<string, unknown> = {}) => ({
  id: "t",
  kind: "editor" as const,
  name: "x",
  content: "SELECT 1",
  connectionId: "c1",
  cursorPos: { line: 1, col: 1 },
  dirty: false,
  createdAt: "",
  updatedAt: "",
  ...over,
});

describe("runQuery — safety pipeline", () => {
  beforeEach(() => {
    vi.mocked(queryRunBatch)
      .mockReset()
      .mockResolvedValue({
        statements: [
          {
            kind: "rowset",
            index: 0,
            sql: "SELECT 1",
            columns: [],
            rows: [],
            truncated: false,
            cursorId: null,
            exhausted: true,
            durationMs: 1,
            statusMessage: "",
          },
        ],
        totalDurationMs: 1,
        failedAt: null,
      } as never);
    vi.mocked(queryExplainCost).mockReset().mockResolvedValue(50);
    useEditor.setState({
      tabs: [tab({ content: "SELECT 1" })],
      activeTabId: "t",
      runStates: new Map(),
      safetyModal: { kind: "none" },
    } as never);
  });

  it("local + SELECT runs without modals", async () => {
    useConnections.setState({
      connections: [conn({ environment: "local" })],
      selectedId: null,
      formMode: { type: "closed" },
      loading: false,
      error: null,
    });
    await useEditor.getState().runQuery("t");
    expect(queryRunBatch).toHaveBeenCalled();
    expect(useEditor.getState().safetyModal.kind).toBe("none");
  });

  it("read-only blocks INSERT", async () => {
    useConnections.setState({
      connections: [conn({ readOnly: true })],
      selectedId: null,
      formMode: { type: "closed" },
      loading: false,
      error: null,
    });
    useEditor.setState({
      tabs: [tab({ content: "INSERT INTO t VALUES (1)" })],
    } as never);
    await useEditor.getState().runQuery("t");
    expect(queryRunBatch).not.toHaveBeenCalled();
    const state = useEditor.getState().runStates.get("t");
    expect(state?.status).toBe("error");
  });

  it("prod + DROP TABLE shows confirm modal; cancel → cancelled", async () => {
    useConnections.setState({
      connections: [conn({ environment: "prod" })],
      selectedId: null,
      formMode: { type: "closed" },
      loading: false,
      error: null,
    });
    useEditor.setState({
      tabs: [tab({ content: "DROP TABLE foo" })],
    } as never);
    const promise = useEditor.getState().runQuery("t");
    // Wait a microtask for the modal to be set.
    await Promise.resolve();
    expect(useEditor.getState().safetyModal.kind).toBe("confirm");
    const modal = useEditor.getState().safetyModal;
    if (modal.kind === "confirm") modal.onCancel();
    await promise;
    expect(queryRunBatch).not.toHaveBeenCalled();
    expect(useEditor.getState().runStates.get("t")?.status).toBe("cancelled");
  });

  it("prod + DROP TABLE — confirm proceeds to query_run_batch", async () => {
    useConnections.setState({
      connections: [conn({ environment: "prod" })],
      selectedId: null,
      formMode: { type: "closed" },
      loading: false,
      error: null,
    });
    useEditor.setState({
      tabs: [tab({ content: "DROP TABLE foo" })],
    } as never);
    const promise = useEditor.getState().runQuery("t");
    await Promise.resolve();
    expect(useEditor.getState().safetyModal.kind).toBe("confirm");
    const modal = useEditor.getState().safetyModal;
    if (modal.kind === "confirm") modal.onConfirm();
    await promise;
    expect(queryRunBatch).toHaveBeenCalled();
  });

  it("dev + DROP TABLE without confirm_destructive runs without modal", async () => {
    useConnections.setState({
      connections: [conn({ environment: "dev", confirmDestructive: false })],
      selectedId: null,
      formMode: { type: "closed" },
      loading: false,
      error: null,
    });
    useEditor.setState({
      tabs: [tab({ content: "DROP TABLE foo" })],
    } as never);
    await useEditor.getState().runQuery("t");
    expect(queryRunBatch).toHaveBeenCalled();
  });

  it("prod + slow query (cost 200K) shows warning modal; proceed → runs", async () => {
    useConnections.setState({
      connections: [
        conn({
          environment: "prod",
          slowQueryWarning: true,
          readOnly: false,
        }),
      ],
      selectedId: null,
      formMode: { type: "closed" },
      loading: false,
      error: null,
    });
    vi.mocked(queryExplainCost).mockResolvedValue(200_000);
    useEditor.setState({
      tabs: [tab({ content: "SELECT * FROM huge_table" })],
    } as never);
    const promise = useEditor.getState().runQuery("t");
    // Allow microtasks for explain_cost mock to resolve and modal to set.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(useEditor.getState().safetyModal.kind).toBe("slow");
    const modal = useEditor.getState().safetyModal;
    if (modal.kind === "slow") modal.onProceed(false);
    await promise;
    expect(queryRunBatch).toHaveBeenCalled();
  });
});
