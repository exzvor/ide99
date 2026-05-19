import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import i18n from "../../../i18n";
import { ReplicationLagCard } from "./ReplicationLagCard";

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

describe("ReplicationLagCard — 3 state branches", () => {
  it("no_replicas (already translated to empty by store) → empty UI", () => {
    render(<ReplicationLagCard connId="c1" state={{ status: "empty", reason: "no_replicas" }} />);
    const empty = screen.getByTestId("health-card-replication_lag-empty");
    expect(empty.textContent).toMatch(/No replication/i);
  });

  it("streaming with healthy lag <10MB → ok tone, slot list", () => {
    render(
      <ReplicationLagCard
        connId="c1"
        state={{
          status: "ready",
          card: {
            id: "replication_lag",
            data: {
              state: "streaming",
              slots: [{ slot: "slot1", lagBytes: 1024 * 1024, lagSeconds: 1, state: "streaming" }],
            },
          },
        }}
      />,
    );
    expect(screen.getAllByTestId("replication-slot-row")).toHaveLength(1);
    expect(screen.getByTestId("health-card-replication_lag-status").getAttribute("data-tone")).toBe(
      "ok",
    );
  });

  it("streaming with lag 10–100MB → warn", () => {
    render(
      <ReplicationLagCard
        connId="c1"
        state={{
          status: "ready",
          card: {
            id: "replication_lag",
            data: {
              state: "streaming",
              slots: [
                {
                  slot: "slot1",
                  lagBytes: 50 * 1024 * 1024,
                  lagSeconds: 30,
                  state: "streaming",
                },
              ],
            },
          },
        }}
      />,
    );
    expect(screen.getByTestId("health-card-replication_lag-status").getAttribute("data-tone")).toBe(
      "warn",
    );
  });

  it("lagging branch → red badge with pretty bytes", () => {
    render(
      <ReplicationLagCard
        connId="c1"
        state={{
          status: "ready",
          card: {
            id: "replication_lag",
            data: {
              state: "lagging",
              slots: [
                {
                  slot: "slot1",
                  lagBytes: 200 * 1024 * 1024,
                  lagSeconds: 120,
                  state: "catchup",
                },
              ],
            },
          },
        }}
      />,
    );
    const badge = screen.getByTestId("replication-lag-badge");
    expect(badge.textContent).toMatch(/200 MB/);
    expect(screen.getByTestId("health-card-replication_lag-status").getAttribute("data-tone")).toBe(
      "danger",
    );
  });
});
