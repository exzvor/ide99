import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { Connection } from "../../lib/tauri";
import { useConnections } from "../connections/store";
import { HealthPane } from "./HealthPane";
import { useHealthActions } from "./actions/store";
import { useHealth } from "./store";

// Mock the IPC layer so the smoke test never actually talks to Postgres.
// HealthPane.useEffect fires `refreshAll` on mount, which fans out 10 IPC
// calls — we mock the ones that matter (Bloat for the action target) and
// stub the others to return forbidden so they end up in a non-ready state
// without throwing. Inline literals because vi.mock is hoisted above any
// top-level const declarations.

vi.mock("../../lib/tauri", async (orig) => {
  const real = await orig<typeof import("../../lib/tauri")>();
  return {
    ...real,
    // Card data — only Bloat needs real data; rest stay non-ready.
    healthBloat: vi.fn().mockResolvedValue({
      ok: true,
      data: {
        rows: [
          {
            schema: "public",
            table: "users",
            bloatPct: 30,
            bloatBytes: 1024 * 1024 * 1024,
          },
        ],
      },
    }),
    healthDbSize: vi
      .fn()
      .mockResolvedValue({ ok: false, error: { kind: "forbidden", requiredRole: "x" } }),
    healthSlowQueries: vi
      .fn()
      .mockResolvedValue({ ok: false, error: { kind: "forbidden", requiredRole: "x" } }),
    healthMissingIndexes: vi
      .fn()
      .mockResolvedValue({ ok: false, error: { kind: "forbidden", requiredRole: "x" } }),
    healthUnusedIndexes: vi
      .fn()
      .mockResolvedValue({ ok: false, error: { kind: "forbidden", requiredRole: "x" } }),
    healthCacheHit: vi
      .fn()
      .mockResolvedValue({ ok: false, error: { kind: "forbidden", requiredRole: "x" } }),
    healthActiveConnections: vi
      .fn()
      .mockResolvedValue({ ok: false, error: { kind: "forbidden", requiredRole: "x" } }),
    healthLongRunning: vi
      .fn()
      .mockResolvedValue({ ok: false, error: { kind: "forbidden", requiredRole: "x" } }),
    healthVacuumStatus: vi
      .fn()
      .mockResolvedValue({ ok: false, error: { kind: "forbidden", requiredRole: "x" } }),
    healthReplicationLag: vi
      .fn()
      .mockResolvedValue({ ok: false, error: { kind: "forbidden", requiredRole: "x" } }),
    healthSnapshotsSave: vi.fn().mockResolvedValue(undefined),
    healthSnapshotsRecent: vi.fn().mockResolvedValue([]),
    // Action IPC — what the smoke really wants to verify.
    healthActionVacuum: vi.fn().mockResolvedValue({
      actionId: "a1",
      durationMs: 100,
      status: "completed",
    }),
    onHealthActionStarted: vi.fn().mockResolvedValue(() => undefined),
    healthActionProgress: vi.fn().mockResolvedValue({
      actionId: "a1",
      phase: "starting",
      percent: null,
      blocksScanned: null,
      blocksTotal: null,
      finished: true,
    }),
  };
});

const conn = {
  id: "c1",
  name: "test",
  environment: "local" as const,
  confirmDestructive: false,
} as Connection;

describe("HealthPane × actions integration smoke", () => {
  afterEach(() => {
    useHealthActions.setState({ phase: { kind: "idle" } });
    useHealth.setState({ byConn: new Map() });
    useConnections.setState({ connections: [] });
    vi.clearAllMocks();
  });

  it("clicking VACUUM on a bloat row → preview → run → cards refresh", async () => {
    useConnections.setState({ connections: [conn as Connection] });

    const refreshSpy = vi.spyOn(useHealth.getState(), "refreshOne").mockResolvedValue();

    // S14: ActionPreviewModal/ActionProgressModal are now mounted in Workspace,
    // not HealthPane. Mount them alongside HealthPane to keep this smoke test
    // self-contained.
    const { ActionPreviewModal } = await import("./actions/ActionPreviewModal");
    const { ActionProgressModal } = await import("./actions/ActionProgressModal");
    render(
      <>
        <HealthPane connId="c1" />
        <ActionPreviewModal />
        <ActionProgressModal />
      </>,
    );

    // Wait for the first-mount refreshAll to populate the bloat card.
    const button = await screen.findByTestId("health-action-vacuum-public.users");

    fireEvent.click(button);
    await waitFor(() => expect(useHealthActions.getState().phase.kind).toBe("preview"));

    fireEvent.click(screen.getByTestId("action-preview-run"));
    await waitFor(() => expect(useHealthActions.getState().phase.kind).toBe("idle"));

    expect(refreshSpy).toHaveBeenCalledWith("c1", "vacuum_status");
    expect(refreshSpy).toHaveBeenCalledWith("c1", "bloat");
  });
});
