import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import i18n from "../../../i18n";

// — SlowQueriesCard mounts ReproduceOnDisposableButton, which
// auto-hydrates the paid-module subscription store on render. Stub the
// Tauri invoke to prevent `window.__TAURI_INTERNALS__` undefined errors.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue({
    spg99Subscribed: false,
    vibepgSubscribed: false,
    upgradeUrlSpg99: "https://spg99.ru/instant-db",
    upgradeUrlVibepg: "https://vibepg.ai/upgrade",
  }),
}));

import { SlowQueriesCard } from "./SlowQueriesCard";

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

describe("SlowQueriesCard", () => {
  it("loading → skeleton", () => {
    render(<SlowQueriesCard connId="c1" state={{ status: "loading" }} />);
    expect(screen.getByTestId("health-card-slow_queries-skeleton")).toBeTruthy();
  });

  it("unavailable extension → install SQL block", () => {
    render(
      <SlowQueriesCard
        connId="c1"
        state={{
          status: "unavailable",
          extension: "pg_stat_statements",
          installSql: "CREATE EXTENSION pg_stat_statements;",
        }}
      />,
    );
    expect(screen.getByTestId("health-card-slow_queries-unavailable")).toBeTruthy();
  });

  it("ready: renders top-3 truncated to 80c with mean+calls + danger tone for >1000ms", () => {
    const rows = [
      {
        query:
          "SELECT * FROM users WHERE x = 1 AND y = 2 AND z = 3 AND a = 4 AND b = 5 AND c = 6 AND d = 7;",
        meanTimeMs: 1500,
        totalTimeMs: 30_000,
        calls: 20,
      },
      { query: "SELECT 1", meanTimeMs: 50, totalTimeMs: 100, calls: 2 },
      { query: "SELECT 2", meanTimeMs: 80, totalTimeMs: 200, calls: 3 },
      { query: "SELECT 3", meanTimeMs: 90, totalTimeMs: 300, calls: 4 },
    ];
    render(
      <SlowQueriesCard
        connId="c1"
        state={{ status: "ready", card: { id: "slow_queries", data: { rows } } }}
      />,
    );
    expect(screen.getAllByTestId("slow-row")).toHaveLength(3);
    expect(screen.getByTestId("health-card-slow_queries-status").getAttribute("data-tone")).toBe(
      "danger",
    );
  });
});
