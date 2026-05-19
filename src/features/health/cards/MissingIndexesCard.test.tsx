import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import i18n from "../../../i18n";
import { MissingIndexesCard } from "./MissingIndexesCard";

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

describe("MissingIndexesCard", () => {
  it("loading → skeleton", () => {
    render(<MissingIndexesCard connId="c1" state={{ status: "loading" }} />);
    expect(screen.getByTestId("health-card-missing_indexes-skeleton")).toBeTruthy();
  });

  it("empty rows → centered no-issues message", () => {
    render(
      <MissingIndexesCard
        connId="c1"
        state={{
          status: "ready",
          card: { id: "missing_indexes", data: { rows: [] } },
        }}
      />,
    );
    expect(screen.getByTestId("health-card-missing_indexes-empty")).toBeTruthy();
  });

  it("ready: warn tone when any rows present", () => {
    render(
      <MissingIndexesCard
        connId="c1"
        state={{
          status: "ready",
          card: {
            id: "missing_indexes",
            data: {
              rows: [
                { schema: "public", table: "logs", seqScan: 5_000, seqTupRead: 1e7, indexScan: 0 },
              ],
            },
          },
        }}
      />,
    );
    expect(screen.getAllByTestId("missing-index-row")).toHaveLength(1);
    expect(screen.getByTestId("health-card-missing_indexes-status").getAttribute("data-tone")).toBe(
      "warn",
    );
  });
});
