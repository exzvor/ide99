import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import i18n from "../../../i18n";
import { LongRunningCard } from "./LongRunningCard";

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

describe("LongRunningCard", () => {
  it("loading → skeleton", () => {
    render(<LongRunningCard connId="c1" state={{ status: "loading" }} />);
    expect(screen.getByTestId("health-card-long_running-skeleton")).toBeTruthy();
  });

  it("empty rows → centered no-issues message", () => {
    render(      <LongRunningCard
        connId="c1"
        state={{
          status: "ready",
          card: { id: "long_running", data: { rows: [] } },
        }}
      />,
);
    expect(screen.getByTestId("health-card-long_running-empty")).toBeTruthy();
  });

  it("ready: warn tone when any rows; renders rows table", () => {
    render(      <LongRunningCard
        connId="c1"
        state={{
          status: "ready",
          card: {
            id: "long_running",
            data: {
              rows: [
                {
                  pid: 12345,
                  durationSeconds: 60,
                  query: "SELECT pg_sleep(60)",
                  state: "active",
                  username: "postgres",
                },
              ],
            },
          },
        }}
      />,
);
    expect(screen.getAllByTestId("long-running-row")).toHaveLength(1);
    expect(screen.getByTestId("health-card-long_running-status").getAttribute("data-tone")).toBe(      "warn",
);
  });
});
