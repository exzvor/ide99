import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import i18n from "../../../i18n";
import { ActiveConnectionsCard } from "./ActiveConnectionsCard";

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

describe("ActiveConnectionsCard", () => {
  it("loading → skeleton", () => {
    render(<ActiveConnectionsCard connId="c1" state={{ status: "loading" }} />);
    expect(screen.getByTestId("health-card-active_connections-skeleton")).toBeTruthy();
  });

  it("ready: ok when ratio < 50%, chips per state", () => {
    render(      <ActiveConnectionsCard
        connId="c1"
        state={{
          status: "ready",
          card: {
            id: "active_connections",
            data: { current: 10, max: 100, byState: { active: 8, idle: 2 } },
          },
        }}
      />,
);
    expect(screen.getByTestId("active-conn-current").textContent).toMatch(/10 \/ 100/);
    expect(screen.getAllByTestId("active-conn-state-chip")).toHaveLength(2);
    expect(      screen.getByTestId("health-card-active_connections-status").getAttribute("data-tone"),
).toBe("ok");
  });

  it("ready: danger when ratio >= 80%", () => {
    render(      <ActiveConnectionsCard
        connId="c1"
        state={{
          status: "ready",
          card: {
            id: "active_connections",
            data: { current: 90, max: 100, byState: { active: 90 } },
          },
        }}
      />,
);
    expect(      screen.getByTestId("health-card-active_connections-status").getAttribute("data-tone"),
).toBe("danger");
  });
});
