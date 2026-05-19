import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Connection } from "../../../lib/tauri";
import { useHealthActions } from "./store";

vi.mock("../../../lib/tauri", async (orig) => {
  const real = await orig<typeof import("../../../lib/tauri")>();
  return {
    ...real,
    healthActionVacuum: vi.fn().mockResolvedValue({
      actionId: "a1",
      durationMs: 123,
      status: "completed",
    }),
    healthActionReindexTable: vi.fn().mockResolvedValue({
      actionId: "a1",
      durationMs: 50,
      status: "completed",
    }),
    healthActionAnalyze: vi.fn().mockResolvedValue({
      actionId: "a1",
      durationMs: 50,
      status: "completed",
    }),
    healthActionDropIndex: vi.fn().mockResolvedValue({
      actionId: "a1",
      durationMs: 50,
      status: "completed",
    }),
    healthActionKillPid: vi.fn().mockResolvedValue({
      actionId: "a1",
      durationMs: 50,
      status: "completed",
    }),
    healthActionProgress: vi.fn().mockResolvedValue({
      actionId: "a1",
      phase: "starting",
      percent: null,
      blocksScanned: null,
      blocksTotal: null,
      finished: true,
    }),
    onHealthActionStarted: vi.fn().mockResolvedValue(() => undefined),
    healthActionCheckPid: vi.fn().mockResolvedValue(false),
  };
});

vi.mock("../store", () => ({
  useHealth: { getState: () => ({ refreshOne: vi.fn() }) },
}));

vi.mock("../../editor/store", () => ({
  useEditor: { getState: () => ({ openEditorTab: vi.fn() }) },
}));

const mockToast = {
  success: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  errorWithAction: vi.fn(),
};

const conn: Connection = {
  id: "c1",
  name: "test",
  host: "localhost",
  port: 5432,
  database: "test",
  username: "test",
  sslMode: "prefer",
  hasPassword: false,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  lastTestedAt: null,
  lastTestOk: null,
  excludeFromHistory: false,
  excludeFromRecentPlans: false,
  environment: "local",
  readOnly: false,
  slowQueryWarning: false,
  confirmDestructive: false,
} as Connection;

describe("useHealthActions — phase machine basics", () => {
  beforeEach(() => useHealthActions.setState({ phase: { kind: "idle" } }));

  it("starts in idle", () => {
    expect(useHealthActions.getState().phase.kind).toBe("idle");
  });

  it("openPreview transitions to preview phase", () => {
    useHealthActions
      .getState()
      .openPreview({ kind: "vacuum", schema: "public", table: "users" }, conn);
    const p = useHealthActions.getState().phase;
    expect(p.kind).toBe("preview");
    if (p.kind === "preview") {
      expect(p.target.kind).toBe("vacuum");
      expect(p.conn.id).toBe("c1");
    }
  });

  it("cancel resets to idle", () => {
    useHealthActions
      .getState()
      .openPreview({ kind: "analyze", schema: "public", table: "users" }, conn);
    useHealthActions.getState().cancel();
    expect(useHealthActions.getState().phase.kind).toBe("idle");
  });
});

describe("useHealthActions.runAction — happy path", () => {
  beforeEach(() => useHealthActions.setState({ phase: { kind: "idle" } }));

  it("vacuum completes, phase returns to idle", async () => {
    useHealthActions
      .getState()
      .openPreview({ kind: "vacuum", schema: "public", table: "users" }, conn);
    await useHealthActions.getState().runAction(mockToast);
    expect(useHealthActions.getState().phase.kind).toBe("idle");
  });

  it("explain target opens editor tab without backend invoke", async () => {
    useHealthActions.getState().openPreview({ kind: "explain", sql: "SELECT 1" }, conn);
    await useHealthActions.getState().runAction(mockToast);
    // Explain branch never enters running:
    expect(useHealthActions.getState().phase.kind).toBe("idle");
  });
});

describe("confirmTerminate", () => {
  beforeEach(() => useHealthActions.setState({ phase: { kind: "idle" } }));

  it("invokes terminate kill and returns to idle", async () => {
    const { healthActionKillPid } = await import("../../../lib/tauri");
    (healthActionKillPid as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      actionId: "a1",
      durationMs: 5,
      status: "terminated",
    });
    useHealthActions.setState({
      phase: { kind: "kill_fallback", conn, pid: 99 },
    });
    await useHealthActions.getState().confirmTerminate(mockToast);
    expect(useHealthActions.getState().phase.kind).toBe("idle");
    expect(healthActionKillPid).toHaveBeenCalledWith("c1", 99, true);
  });
});

describe("abortLongRunning", () => {
  beforeEach(() => useHealthActions.setState({ phase: { kind: "idle" } }));

  it("invokes pg_cancel_backend on the registered pid", async () => {
    const { healthActionKillPid } = await import("../../../lib/tauri");
    (healthActionKillPid as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      actionId: "x",
      durationMs: 1,
      status: "completed",
    });
    useHealthActions.setState({
      phase: {
        kind: "running",
        target: { kind: "vacuum", schema: "public", table: "users" },
        conn,
        actionId: "a1",
        pid: 4242,
        progress: null,
      },
    });
    await useHealthActions.getState().abortLongRunning(mockToast);
    expect(healthActionKillPid).toHaveBeenCalledWith("c1", 4242, false);
  });
});
