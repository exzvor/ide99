import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { Connection } from "../../lib/tauri";
import { useConnections } from "../connections/store";
import { useHealthActions } from "../health/actions/store";
import { LiveOpsPane } from "./LiveOpsPane";
import { useLiveOps } from "./store";

// Mock the IPC layer so the smoke test never actually talks to Postgres.
vi.mock("../../lib/tauri", async (orig) => {
  const real = await orig<typeof import("../../lib/tauri")>();
  return {
    ...real,
    liveOpsSessions: vi.fn().mockResolvedValue({
      ok: true,
      data: {
        sessions: [
          {
            pid: 12345,
            state: "active",
            username: "u",
            applicationName: null,
            clientAddr: null,
            query: "SELECT pg_sleep(60)",
            queryStart: null,
            durationSeconds: 5,
            waitEventType: "Lock",
            waitEvent: "transactionid",
            backendType: "client backend",
          },
        ],
        blockingEdges: [],
        fetchedAt: new Date().toISOString(),
        truncated: false,
      },
    }),
    liveOpsSlow: vi.fn().mockResolvedValue({
      ok: true,
      data: { rows: [], sortBy: "meanExecTime", fetchedAt: "" },
    }),
    liveOpsReplication: vi.fn().mockResolvedValue({
      ok: true,
      data: { slots: [], publications: [], subscriptions: [], fetchedAt: "" },
    }),
  };
});

const conn: Connection = {
  id: "c1",
  name: "test",
  environment: "local",
  confirmDestructive: false,
} as Connection;

describe("LiveOps × Sessions integration smoke", () => {
  afterEach(() => {
    useLiveOps.setState({ byConn: new Map() });
    useConnections.setState({ connections: [] });
    useHealthActions.setState({ phase: { kind: "idle" } });
    vi.clearAllMocks();
  });

  it("left-click on a session → menu opens → Cancel → S13 preview phase active", async () => {
    useConnections.setState({ connections: [conn] });
    render(<LiveOpsPane connId="c1" />);

    const node = await screen.findByTestId("session-node-12345");
    fireEvent.click(node);

    // Context menu state populated in store
    expect(useLiveOps.getState().byConn.get("c1")?.contextMenu.open).toBe(true);

    // The menu emits via Radix portal; just verify we can find the cancel item.
    const menu = await screen.findByTestId("session-context-menu");
    const items = menu.querySelectorAll('[role="menuitem"]');
    expect(items.length).toBeGreaterThanOrEqual(2);

    // Click the first item (Cancel session); use onSelect → fireEvent.click
    fireEvent.click(items[0] as HTMLElement);

    expect(useHealthActions.getState().phase.kind).toBe("preview");
    const phase = useHealthActions.getState().phase as {
      kind: "preview";
      target: { kind: "killPid"; pid: number };
    };
    expect(phase.target.kind).toBe("killPid");
    expect(phase.target.pid).toBe(12345);
  });
});
