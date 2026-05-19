import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Connection } from "../../../lib/tauri";
import { useConnections } from "../../connections/store";
import { useLiveOps } from "../store";
import { SessionsPane } from "./SessionsPane";

vi.mock("../../../lib/tauri", async (orig) => {
  const real = await orig<typeof import("../../../lib/tauri")>();
  return {
    ...real,
    liveOpsSessions: vi.fn().mockResolvedValue({
      ok: true,
      data: {
        sessions: [],
        blockingEdges: [],
        fetchedAt: new Date().toISOString(),
        truncated: false,
      },
    }),
  };
});

const snap = {
  sessions: [
    {
      pid: 100,
      state: "active",
      username: "u",
      applicationName: null,
      clientAddr: null,
      query: "SELECT 1",
      queryStart: null,
      durationSeconds: 5,
      waitEventType: null,
      waitEvent: null,
      backendType: "client backend",
    },
    {
      pid: 200,
      state: "active",
      username: "u",
      applicationName: null,
      clientAddr: null,
      query: "UPDATE t",
      queryStart: null,
      durationSeconds: 6,
      waitEventType: "Lock",
      waitEvent: "transactionid",
      backendType: "client backend",
    },
  ],
  blockingEdges: [
    {
      blockerPid: 100,
      blockedPid: 200,
      lockMode: "ExclusiveLock",
      lockType: "tuple",
      relation: "t",
    },
  ],
  fetchedAt: new Date().toISOString(),
  truncated: false,
};

const conn: Connection = {
  id: "c1",
  name: "test",
  environment: "local",
  confirmDestructive: false,
} as Connection;

describe("SessionsPane", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    useLiveOps.setState({ byConn: new Map() });
    useConnections.setState({ connections: [] });
    window.localStorage.clear();
  });

  it("renders graph with both nodes", async () => {
    useConnections.setState({ connections: [conn] });
    useLiveOps.getState().ensureConn("c1", "local");
    useLiveOps.setState((s) => {
      const m = new Map(s.byConn);
      const slice = m.get("c1");
      if (!slice) return s;
      m.set("c1", {
        ...slice,
        sessions: {
          ...slice.sessions,
          data: { status: "ready", data: snap, fetchedAt: Date.now() },
        },
      });
      return { byConn: m };
    });
    render(<SessionsPane connId="c1" />);
    expect(await screen.findByTestId("session-node-100")).toBeInTheDocument();
    expect(screen.getByTestId("session-node-200")).toBeInTheDocument();
  });

  it("blocked node has tone-blocked class", async () => {
    useConnections.setState({ connections: [conn] });
    useLiveOps.getState().ensureConn("c1", "local");
    useLiveOps.setState((s) => {
      const m = new Map(s.byConn);
      const slice = m.get("c1");
      if (!slice) return s;
      m.set("c1", {
        ...slice,
        sessions: {
          ...slice.sessions,
          data: { status: "ready", data: snap, fetchedAt: Date.now() },
        },
      });
      return { byConn: m };
    });
    render(<SessionsPane connId="c1" />);
    const blockedNode = await screen.findByTestId("session-node-200");
    expect(blockedNode.className).toContain("tone-blocked");
  });

  it("view toggle dispatches setSessionsView (DAG <-> List)", async () => {
    useConnections.setState({ connections: [conn] });
    useLiveOps.getState().ensureConn("c1", "local");
    render(<SessionsPane connId="c1" />);
    fireEvent.click(screen.getByTestId("live-ops-view-list"));
    expect(useLiveOps.getState().byConn.get("c1")?.sessions.view).toBe("list");
    fireEvent.click(screen.getByTestId("live-ops-view-dag"));
    expect(useLiveOps.getState().byConn.get("c1")?.sessions.view).toBe("dag");
  });

  it("left-click on a node opens the action menu", async () => {
    useConnections.setState({ connections: [conn] });
    useLiveOps.getState().ensureConn("c1", "local");
    useLiveOps.setState((s) => {
      const m = new Map(s.byConn);
      const slice = m.get("c1");
      if (!slice) return s;
      m.set("c1", {
        ...slice,
        sessions: {
          ...slice.sessions,
          data: { status: "ready", data: snap, fetchedAt: Date.now() },
        },
      });
      return { byConn: m };
    });
    render(<SessionsPane connId="c1" />);
    const node = await screen.findByTestId("session-node-100");
    fireEvent.click(node);
    expect(useLiveOps.getState().byConn.get("c1")?.contextMenu.open).toBe(true);
  });
});
