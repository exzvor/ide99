import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import i18n from "../../../i18n";
import { CacheHitCard } from "./CacheHitCard";

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

describe("CacheHitCard", () => {
  it("loading → skeleton", () => {
    render(<CacheHitCard connId="c1" state={{ status: "loading" }} />);
    expect(screen.getByTestId("health-card-cache_hit-skeleton")).toBeTruthy();
  });

  it("ready: ok tone for ratio >= 95", () => {
    render(
      <CacheHitCard
        connId="c1"
        state={{ status: "ready", card: { id: "cache_hit", data: { ratioPct: 99 } } }}
      />,
    );
    expect(screen.getByTestId("cache-hit-pct").textContent).toBe("99.00%");
    expect(screen.getByTestId("health-card-cache_hit-status").getAttribute("data-tone")).toBe("ok");
  });

  it("ready: warn for 85 ≤ ratio < 95", () => {
    render(
      <CacheHitCard
        connId="c1"
        state={{ status: "ready", card: { id: "cache_hit", data: { ratioPct: 90 } } }}
      />,
    );
    expect(screen.getByTestId("health-card-cache_hit-status").getAttribute("data-tone")).toBe(
      "warn",
    );
  });

  it("ready: danger for ratio < 85; horizontal bar present", () => {
    render(
      <CacheHitCard
        connId="c1"
        state={{ status: "ready", card: { id: "cache_hit", data: { ratioPct: 70 } } }}
      />,
    );
    expect(screen.getByTestId("health-card-cache_hit-status").getAttribute("data-tone")).toBe(
      "danger",
    );
    expect(screen.getByTestId("cache-hit-bar")).toBeTruthy();
  });
});
