import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useLiveOps } from "../store";
import { ReplicationPane } from "./ReplicationPane";

function setReady(data: unknown) {
  useLiveOps.getState().ensureConn("c1", "local");
  useLiveOps.getState().setActiveSubTab("c1", "replication");
  useLiveOps.setState((s) => {
    const m = new Map(s.byConn);
    const slice = m.get("c1");
    if (!slice) return s;
    m.set("c1", {
      ...slice,
      replication: {
        ...slice.replication,
        data: { status: "ready", data: data as never, fetchedAt: Date.now() },
      },
    });
    return { byConn: m };
  });
}

describe("ReplicationPane", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    useLiveOps.setState({ byConn: new Map() });
    window.localStorage.clear();
  });

  it("empty single-node renders no_replication", () => {
    setReady({
      slots: [],
      publications: [],
      subscriptions: [],
      fetchedAt: new Date().toISOString(),
    });
    render(<ReplicationPane connId="c1" />);
    expect(screen.getByTestId("live-ops-no-replication")).toBeInTheDocument();
  });

  it("show-empty toggle reveals all 3 sections", () => {
    setReady({
      slots: [],
      publications: [],
      subscriptions: [],
      fetchedAt: new Date().toISOString(),
    });
    useLiveOps.getState().setShowEmpty("c1", true);
    render(<ReplicationPane connId="c1" />);
    expect(screen.getByTestId("live-ops-slots")).toBeInTheDocument();
    expect(screen.getByTestId("live-ops-pubs")).toBeInTheDocument();
    expect(screen.getByTestId("live-ops-subs")).toBeInTheDocument();
  });

  it("slot >1GB has tone-warn class", () => {
    setReady({
      slots: [
        {
          slotName: "s1",
          slotType: "physical",
          database: null,
          active: true,
          walStatus: null,
          lagBytes: 2_000_000_000,
          lagSeconds: 1,
          state: "streaming",
          retentionBytes: 2_000_000_000,
          retentionPctOfMax: null,
        },
      ],
      publications: [],
      subscriptions: [],
      fetchedAt: new Date().toISOString(),
    });
    render(<ReplicationPane connId="c1" />);
    const slot = screen.getByTestId("live-ops-slots").querySelector(".live-ops-slot");
    expect(slot?.className).toContain("tone-warn");
  });

  it("subscription password redaction visible", () => {
    setReady({
      slots: [],
      publications: [],
      subscriptions: [
        {
          subname: "sub1",
          subenabled: true,
          subconninfoRedacted: "host=db user=u password=*** port=5432",
          publications: ["pub_main"],
          stat: null,
        },
      ],
      fetchedAt: new Date().toISOString(),
    });
    render(<ReplicationPane connId="c1" />);
    expect(screen.getByText(/password=\*\*\*/)).toBeInTheDocument();
  });
});
