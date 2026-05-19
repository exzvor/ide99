/**
 * — Spg99StatusBarWidget tests ().
 *
 * The widget renders nothing in two cases (== "visible without subscription
 * = no clutter"):
 * 1. No active Instant DB attached.
 * 2. User is not subscribed (even if some stale activeInstantDb is
 * passed — backend desync guard).
 *
 * When subscribed AND there is an active Instant DB, it renders a status
 * line with template + minutes-to-auto-stop.
 */

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "../../../i18n";
import { usePaidModules } from "../store";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

import { Spg99StatusBarWidget } from "../Spg99StatusBarWidget";

function setSubscription(spg99Subscribed: boolean): void {
  usePaidModules.setState({
    subscription: {
      spg99Subscribed,
      vibepgSubscribed: false,
      upgradeUrlSpg99: "https://spg99.ru/instant-db",
      upgradeUrlVibepg: "https://vibepg.ai/upgrade",
    },
    loaded: true,
    loading: false,
  });
}

beforeEach(() => {
  usePaidModules.setState({ subscription: null, loaded: false, loading: false });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Spg99StatusBarWidget", () => {
  it("renders nothing when activeInstantDb is null (no clutter on the status bar)", () => {
    setSubscription(true);
    const { container } = render(<Spg99StatusBarWidget activeInstantDb={null} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId("spg99-status-bar")).toBeNull();
  });

  it("renders nothing when not subscribed even if an activeInstantDb is passed", () => {
    setSubscription(false);
    const { container } = render(      <Spg99StatusBarWidget activeInstantDb={{ template: "pgvector", expiresInMinutes: 12 }} />,
);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the badge when subscribed and active Instant DB is provided", () => {
    setSubscription(true);
    render(      <Spg99StatusBarWidget activeInstantDb={{ template: "pgvector", expiresInMinutes: 12 }} />,
);
    const badge = screen.getByTestId("spg99-status-bar");
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toMatch(/pgvector/);
    expect(badge.textContent).toMatch(/12/);
  });
});
