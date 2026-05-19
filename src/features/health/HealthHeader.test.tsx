import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import type { Connection } from "../../lib/tauri";
import { useConnections } from "../connections/store";
import { HealthHeader } from "./HealthHeader";
import { useHealth } from "./store";

const fakeConn = (
  id: string,
  name: string,
  env: Connection["environment"] = "local",
): Connection => ({
  id,
  name,
  host: "127.0.0.1",
  port: 5432,
  database: "db",
  username: "u",
  sslMode: "disable",
  hasPassword: false,
  readOnly: false,
  confirmDestructive: false,
  slowQueryWarning: false,
  excludeFromHistory: false,
  excludeFromRecentPlans: false,
  environment: env,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  lastTestedAt: null,
  lastTestOk: null,
});

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  useHealth.setState({ byConn: new Map() });
  useConnections.setState({ ...useConnections.getState(), connections: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("HealthHeader", () => {
  it("renders 'Never refreshed' when lastRefreshAt is null", () => {
    useConnections.setState({
      ...useConnections.getState(),
      connections: [fakeConn("c1", "dev-myapp")],
    });
    render(
      <HealthHeader
        connId="c1"
        lastRefreshAt={null}
        refreshIntervalMs={null}
        refreshInProgress={false}
      />,
    );
    expect(screen.getByTestId("health-last-refreshed").textContent).toMatch(/Never/);
    expect(screen.getByTestId("health-header").textContent).toMatch(/dev-myapp/);
  });

  it("renders relative time when lastRefreshAt is recent", () => {
    useConnections.setState({
      ...useConnections.getState(),
      connections: [fakeConn("c1", "dev-myapp")],
    });
    render(
      <HealthHeader
        connId="c1"
        lastRefreshAt={Date.now() - 12_000}
        refreshIntervalMs={30_000}
        refreshInProgress={false}
      />,
    );
    const t = screen.getByTestId("health-last-refreshed").textContent ?? "";
    expect(t).toMatch(/seconds|sec/);
  });

  it("falls back to first 8 id chars when conn unknown", () => {
    render(
      <HealthHeader
        connId="abcdef0123456789"
        lastRefreshAt={null}
        refreshIntervalMs={null}
        refreshInProgress={false}
      />,
    );
    expect(screen.getByTestId("health-header").textContent).toContain("abcdef01");
  });

  it("Refresh button calls refreshAll on the store", () => {
    const refreshAll = vi.fn().mockResolvedValue(undefined);
    useHealth.setState({ ...useHealth.getState(), refreshAll });
    render(
      <HealthHeader
        connId="c1"
        lastRefreshAt={null}
        refreshIntervalMs={null}
        refreshInProgress={false}
      />,
    );
    fireEvent.click(screen.getByTestId("health-refresh-now"));
    expect(refreshAll).toHaveBeenCalledWith("c1");
  });

  it("shows spinning RefreshCw when refreshInProgress is true", () => {
    render(
      <HealthHeader
        connId="c1"
        lastRefreshAt={null}
        refreshIntervalMs={null}
        refreshInProgress={true}
      />,
    );
    const button = screen.getByTestId("health-refresh-now");
    // animate-spin is applied to the inner svg
    expect(button.querySelector(".animate-spin")).toBeTruthy();
  });

  it("auto-refresh dropdown disables 5s/10s for prod env (cap_tooltip)", () => {
    useConnections.setState({
      ...useConnections.getState(),
      connections: [fakeConn("prod-1", "prod-db", "prod")],
    });
    render(
      <HealthHeader
        connId="prod-1"
        lastRefreshAt={null}
        refreshIntervalMs={60_000}
        refreshInProgress={false}
      />,
    );
    const select = screen.getByTestId("health-auto-refresh-select") as HTMLSelectElement;
    const opts = Array.from(select.querySelectorAll("option"));
    const fiveS = opts.find((o) => o.value === "5000");
    const tenS = opts.find((o) => o.value === "10000");
    const thirtyS = opts.find((o) => o.value === "30000");
    expect(fiveS?.disabled).toBe(true);
    expect(tenS?.disabled).toBe(true);
    expect(thirtyS?.disabled).toBe(false);
    expect(fiveS?.title).toMatch(/disabled on prod/);
  });

  it("auto-refresh select onChange persists via setRefreshInterval", () => {
    const setRefreshInterval = vi.fn();
    useHealth.setState({ ...useHealth.getState(), setRefreshInterval });
    render(
      <HealthHeader
        connId="c1"
        lastRefreshAt={null}
        refreshIntervalMs={null}
        refreshInProgress={false}
      />,
    );
    fireEvent.change(screen.getByTestId("health-auto-refresh-select"), {
      target: { value: "30000" },
    });
    expect(setRefreshInterval).toHaveBeenCalledWith("c1", 30_000);
  });

  it("dropdown 'Off' option maps to null on change", () => {
    const setRefreshInterval = vi.fn();
    useHealth.setState({ ...useHealth.getState(), setRefreshInterval });
    render(
      <HealthHeader
        connId="c1"
        lastRefreshAt={null}
        refreshIntervalMs={30_000}
        refreshInProgress={false}
      />,
    );
    fireEvent.change(screen.getByTestId("health-auto-refresh-select"), {
      target: { value: "off" },
    });
    expect(setRefreshInterval).toHaveBeenCalledWith("c1", null);
  });
});
