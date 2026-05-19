import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../../i18n";
import { useHealth } from "../store";
import { CardShell } from "./CardShell";

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  useHealth.setState({ byConn: new Map() });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CardShell — UI matrix", () => {
  it("loading state shows shimmer skeleton + spinner", () => {
    render(<CardShell cardId="db_size" connId="c1" state={{ status: "loading" }} />);
    expect(screen.getByTestId("health-card-db_size")).toBeTruthy();
    expect(screen.getByTestId("health-card-db_size-skeleton")).toBeTruthy();
    expect(screen.getByTestId("health-card-db_size-spinner")).toBeTruthy();
  });

  it("ready state shows body + ok status badge (info tooltip temporarily disabled)", () => {
    render(
      <CardShell
        cardId="cache_hit"
        connId="c1"
        state={{
          status: "ready",
          card: { id: "cache_hit", data: { ratioPct: 99 } },
        }}
        body={<div>BODY</div>}
        status={{ tone: "ok" }}
      />,
    );
    const badge = screen.getByTestId("health-card-cache_hit-status");
    expect(badge.getAttribute("data-tone")).toBe("ok");
    expect(screen.getByTestId("health-card-cache_hit-body").textContent).toBe("BODY");
    // Info-icon is hidden; when it is brought back, flip this assertion back to toBeTruthy.
    expect(screen.queryByTestId("health-card-cache_hit-info")).toBeNull();
  });

  it("ready state with warn/danger tones renders AlertCircle (data-tone)", () => {
    const { rerender } = render(
      <CardShell
        cardId="bloat"
        connId="c1"
        state={{
          status: "ready",
          card: { id: "bloat", data: { rows: [] } },
        }}
        body={<div>w</div>}
        status={{ tone: "warn" }}
      />,
    );
    expect(screen.getByTestId("health-card-bloat-status").getAttribute("data-tone")).toBe("warn");
    rerender(
      <CardShell
        cardId="bloat"
        connId="c1"
        state={{
          status: "ready",
          card: { id: "bloat", data: { rows: [] } },
        }}
        body={<div>d</div>}
        status={{ tone: "danger" }}
      />,
    );
    expect(screen.getByTestId("health-card-bloat-status").getAttribute("data-tone")).toBe("danger");
  });

  it("empty state renders translated reason text", () => {
    render(
      <CardShell
        cardId="long_running"
        connId="c1"
        state={{ status: "empty", reason: "no_data" }}
      />,
    );
    const empty = screen.getByTestId("health-card-long_running-empty");
    expect(empty.textContent).toMatch(/No issues found/i);
  });

  it("unavailable state renders install SQL + copy button writes to clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(
      <CardShell
        cardId="slow_queries"
        connId="c1"
        state={{
          status: "unavailable",
          extension: "pg_stat_statements",
          installSql: "CREATE EXTENSION pg_stat_statements;",
        }}
      />,
    );
    const block = screen.getByTestId("health-card-slow_queries-unavailable");
    expect(block.textContent).toMatch(/pg_stat_statements/);
    fireEvent.click(screen.getByTestId("health-card-slow_queries-copy"));
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledWith("CREATE EXTENSION pg_stat_statements;");
  });

  it("forbidden state renders GRANT snippet + copy", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(
      <CardShell
        cardId="replication_lag"
        connId="c1"
        state={{ status: "forbidden", requiredRole: "pg_monitor" }}
      />,
    );
    const block = screen.getByTestId("health-card-replication_lag-forbidden");
    expect(block.textContent).toMatch(/pg_monitor/);
    fireEvent.click(screen.getByTestId("health-card-replication_lag-copy"));
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledWith("GRANT pg_monitor TO current_user;");
  });

  it("error state shows details + retry triggers refreshOne", () => {
    const refreshOne = vi.fn();
    useHealth.setState({
      ...useHealth.getState(),
      refreshOne,
    });
    render(
      <CardShell cardId="bloat" connId="conn-A" state={{ status: "error", message: "oops" }} />,
    );
    const block = screen.getByTestId("health-card-bloat-error");
    expect(block.textContent).toMatch(/Failed to load/);
    expect(block.textContent).toMatch(/oops/);
    fireEvent.click(screen.getByTestId("health-card-bloat-retry"));
    expect(refreshOne).toHaveBeenCalledWith("conn-A", "bloat");
  });
});
