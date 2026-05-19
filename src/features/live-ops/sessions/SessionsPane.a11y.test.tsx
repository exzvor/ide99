/**
 * (a11y) — axe-core regression for SessionsPane plus assertion
 * for the screen-reader live region introduced for acceptance criterion #4.
 *
 * The live region is a `aria-live="polite"` `.sr-only` div that re-announces
 * blocking-chain state ONLY when the (sessions, top-blocker, blocker-fanout)
 * tuple changes — never on every 2 s poll. We assert both:
 * 1. Initial render with one chain → text matches the localized template.
 * 2. axe finds zero violations on the rendered DOM.
 */

import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Connection } from "../../../lib/tauri";
import { expectNoAxeViolations } from "../../../test/axeHelper";
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

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      // Resolve the two keys we explicitly need.
      if (key === "live_ops.sessions.aria.chain_active" && opts) {
        return `${opts.sessions} active sessions, PID ${opts.blockerPid} blocking ${opts.blocked} others`;
      }
      if (key === "live_ops.sessions.aria.chain_idle" && opts) {
        return `${opts.count} active sessions, no blocking`;
      }
      if (opts && typeof opts === "object") {
        return Object.entries(opts).reduce<string>(          (acc, [k, v]) => acc.replace(`{{${k}}}`, String(v)),
          key,
);
      }
      return key;
    },
    i18n: { language: "en" },
  }),
}));

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
    {
      pid: 300,
      state: "active",
      username: "u",
      applicationName: null,
      clientAddr: null,
      query: "UPDATE u",
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
    {
      blockerPid: 100,
      blockedPid: 300,
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

describe("SessionsPane accessibility", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    useLiveOps.setState({ byConn: new Map() });
    useConnections.setState({ connections: [] });
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it("blocking-chain live region announces top blocker (acceptance #4)", async () => {
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
    const aria = await screen.findByTestId("live-ops-blocking-chain-aria");
    await waitFor(() => {
      expect(aria.textContent ?? "").toContain("PID 100");
      expect(aria.textContent ?? "").toContain("blocking 2");
    });
    expect(aria).toHaveAttribute("aria-live", "polite");
  });

  it("has 0 axe violations with an active blocking chain", async () => {
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
    const { container } = render(<SessionsPane connId="c1" />);
    await screen.findByTestId("session-node-100");
    // The DAG arrow overlay uses `aria-hidden` already; we still allow color
    // contrast to be checked because the arrows use `currentColor` from the
    // theme tokens (HC overrides bump them to `--warn-q`).
    await expectNoAxeViolations(container);
  });
});
