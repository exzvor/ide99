/**
 * — HypoPgEstimate subcomponent tests.
 *
 * Covers each variant of the HypoPgEstimate discriminated union
 * plus the loading state.
 */

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import i18n from "../../../i18n";
import { HypoPgEstimate } from "./HypoPgEstimate";

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

describe("HypoPgEstimate", () => {
  it("renders loading spinner", () => {
    render(<HypoPgEstimate state={{ kind: "loading" }} />);
    expect(screen.getByTestId("hypopg-loading")).toBeInTheDocument();
    // The EN key is "Computing…"
    expect(screen.getByTestId("hypopg-loading").textContent).toContain("Computing");
  });

  it("renders computed result", () => {
    render(
      <HypoPgEstimate
        state={{
          kind: "computed",
          baselineCost: 1500.0,
          hypotheticalCost: 200.0,
          reductionPct: 86.7,
        }}
      />,
    );
    expect(screen.getByTestId("hypopg-computed")).toBeInTheDocument();
    // The pct badge is rendered separately and always shows
    expect(screen.getByTestId("hypopg-pct")).toBeInTheDocument();
    expect(screen.getByTestId("hypopg-pct").textContent).toContain("86.7");
  });

  it("renders computed result with green color when reduction > 0", () => {
    render(
      <HypoPgEstimate
        state={{
          kind: "computed",
          baselineCost: 1000.0,
          hypotheticalCost: 100.0,
          reductionPct: 90.0,
        }}
      />,
    );
    const pctEl = screen.getByTestId("hypopg-pct");
    // Should have a color style (green for positive reduction)
    expect(pctEl.style.color).toBeTruthy();
  });

  it("renders extensionMissing unavailable with install SQL", () => {
    render(
      <HypoPgEstimate
        state={{
          kind: "unavailable",
          reason: { kind: "extensionMissing" },
        }}
      />,
    );
    expect(screen.getByTestId("hypopg-unavailable-extensionMissing")).toBeInTheDocument();
    expect(screen.getByTestId("hypopg-install-sql")).toBeInTheDocument();
    // The install SQL code block shows the actual SQL from i18n
    expect(screen.getByTestId("hypopg-install-sql").textContent).toContain("hypopg");
  });

  it("renders pgVersionTooOld unavailable with version number", () => {
    render(
      <HypoPgEstimate
        state={{
          kind: "unavailable",
          reason: { kind: "pgVersionTooOld", actual: "15.2", required: "16" },
        }}
      />,
    );
    expect(screen.getByTestId("hypopg-unavailable-pgTooOld")).toBeInTheDocument();
    // EN translation: "Hypothetical EXPLAIN requires PostgreSQL 16+ (current: {{actual}})"
    expect(screen.getByTestId("hypopg-unavailable-pgTooOld").textContent).toContain("15.2");
  });

  it("renders noRepresentativeQuery unavailable", () => {
    render(
      <HypoPgEstimate
        state={{
          kind: "unavailable",
          reason: { kind: "noRepresentativeQuery" },
        }}
      />,
    );
    expect(screen.getByTestId("hypopg-unavailable-noRepresentativeQuery")).toBeInTheDocument();
    // EN: "No usage data — install pg_stat_statements to enable cost estimation"
    expect(screen.getByTestId("hypopg-unavailable-noRepresentativeQuery").textContent).toContain(
      "No usage data",
    );
  });

  it("renders plannerError unavailable with message", () => {
    render(
      <HypoPgEstimate
        state={{
          kind: "unavailable",
          reason: { kind: "plannerError", message: "could not plan" },
        }}
      />,
    );
    expect(screen.getByTestId("hypopg-unavailable-plannerError")).toBeInTheDocument();
    // EN: "Planner error: {{message}}"
    expect(screen.getByTestId("hypopg-unavailable-plannerError").textContent).toContain(
      "could not plan",
    );
  });
});
