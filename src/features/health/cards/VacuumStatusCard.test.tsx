import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import i18n from "../../../i18n";
import { VacuumStatusCard } from "./VacuumStatusCard";

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

describe("VacuumStatusCard", () => {
  it("loading → skeleton", () => {
    render(<VacuumStatusCard connId="c1" state={{ status: "loading" }} />);
    expect(screen.getByTestId("health-card-vacuum_status-skeleton")).toBeTruthy();
  });

  it("empty rows → no-issues message", () => {
    render(
      <VacuumStatusCard
        connId="c1"
        state={{
          status: "ready",
          card: { id: "vacuum_status", data: { rows: [] } },
        }}
      />,
    );
    expect(screen.getByTestId("health-card-vacuum_status-empty")).toBeTruthy();
  });

  it("ready: warn when any > 7d, danger when any > 30d", () => {
    const { rerender } = render(
      <VacuumStatusCard
        connId="c1"
        state={{
          status: "ready",
          card: {
            id: "vacuum_status",
            data: {
              rows: [
                {
                  schema: "public",
                  table: "logs",
                  lastVacuum: null,
                  lastAutovacuum: null,
                  daysSince: 10,
                },
              ],
            },
          },
        }}
      />,
    );
    expect(screen.getByTestId("health-card-vacuum_status-status").getAttribute("data-tone")).toBe(
      "warn",
    );
    rerender(
      <VacuumStatusCard
        connId="c1"
        state={{
          status: "ready",
          card: {
            id: "vacuum_status",
            data: {
              rows: [
                {
                  schema: "public",
                  table: "logs",
                  lastVacuum: null,
                  lastAutovacuum: null,
                  daysSince: 60,
                },
              ],
            },
          },
        }}
      />,
    );
    expect(screen.getByTestId("health-card-vacuum_status-status").getAttribute("data-tone")).toBe(
      "danger",
    );
  });

  it("renders 'never' row for daysSince=null", () => {
    render(
      <VacuumStatusCard
        connId="c1"
        state={{
          status: "ready",
          card: {
            id: "vacuum_status",
            data: {
              rows: [
                {
                  schema: "public",
                  table: "logs",
                  lastVacuum: null,
                  lastAutovacuum: null,
                  daysSince: null,
                },
              ],
            },
          },
        }}
      />,
    );
    const row = screen.getByTestId("vacuum-row");
    expect(row.textContent).toMatch(/never/i);
  });
});
