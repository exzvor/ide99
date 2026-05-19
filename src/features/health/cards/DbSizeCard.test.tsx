import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import i18n from "../../../i18n";
import { DbSizeCard, prettyBytes } from "./DbSizeCard";

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

describe("prettyBytes", () => {
  it("formats kB/MB/GB", () => {
    expect(prettyBytes(0)).toMatch(/0 B/);
    expect(prettyBytes(1024)).toMatch(/kB/);
    expect(prettyBytes(1024 * 1024)).toMatch(/MB/);
    expect(prettyBytes(1024 ** 3)).toMatch(/GB/);
  });

  it("handles negatives", () => {
    expect(prettyBytes(-2048)).toMatch(/^-/);
  });
});

describe("DbSizeCard", () => {
  it("loading → skeleton via shell", () => {
    render(<DbSizeCard connId="c1" state={{ status: "loading" }} />);
    expect(screen.getByTestId("health-card-db_size-skeleton")).toBeTruthy();
  });

  it("ready with full 7-day data renders pretty + growth + sparkline", () => {
    render(
      <DbSizeCard
        connId="c1"
        state={{
          status: "ready",
          card: {
            id: "db_size",
            data: {
              bytes: 100 * 1024 * 1024,
              pretty: "100 MB",
              growth7dBytes: 10 * 1024 * 1024,
              growth7dPct: 10,
              sparklinePoints: [90, 92, 94, 96, 98, 99, 100].map((n) => n * 1024 * 1024),
            },
          },
        }}
      />,
    );
    expect(screen.getByTestId("db-size-pretty").textContent).toBe("100 MB");
    expect(screen.getByTestId("db-size-growth").textContent).toMatch(/MB.*7d/);
    expect(screen.getByTestId("sparkline")).toBeTruthy();
  });

  it("shows growth_collecting when sparkline has fewer than 7 points", () => {
    render(
      <DbSizeCard
        connId="c1"
        state={{
          status: "ready",
          card: {
            id: "db_size",
            data: {
              bytes: 1024,
              pretty: "1 kB",
              growth7dBytes: null,
              growth7dPct: null,
              sparklinePoints: [1024, 1024, 1024],
            },
          },
        }}
      />,
    );
    expect(screen.getByTestId("db-size-growth").textContent).toMatch(/Collecting trend/);
  });

  it("ok status when |growth_pct| < 5", () => {
    render(
      <DbSizeCard
        connId="c1"
        state={{
          status: "ready",
          card: {
            id: "db_size",
            data: {
              bytes: 1024,
              pretty: "1 kB",
              growth7dBytes: 0,
              growth7dPct: 1,
              sparklinePoints: [1, 1, 1, 1, 1, 1, 1],
            },
          },
        }}
      />,
    );
    expect(screen.getByTestId("health-card-db_size-status").getAttribute("data-tone")).toBe("ok");
  });

  it("danger status when growth_pct > 20", () => {
    render(
      <DbSizeCard
        connId="c1"
        state={{
          status: "ready",
          card: {
            id: "db_size",
            data: {
              bytes: 1024,
              pretty: "1 kB",
              growth7dBytes: 500,
              growth7dPct: 50,
              sparklinePoints: [1, 1, 1, 1, 1, 1, 1],
            },
          },
        }}
      />,
    );
    expect(screen.getByTestId("health-card-db_size-status").getAttribute("data-tone")).toBe(
      "danger",
    );
  });
});
