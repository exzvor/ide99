import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TimescaleTablePanel, type TimescaleTablePanelProps } from "../TimescaleTablePanel";

vi.mock("../HypertableWizard", () => ({
  HypertableWizard: ({ open }: { open: boolean }) =>
    open ? <div data-testid="hypertable-wizard-mock-open" /> : null,
}));
vi.mock("../ContinuousAggregateWizard", () => ({
  ContinuousAggregateWizard: ({ open }: { open: boolean }) =>
    open ? <div data-testid="continuous-aggregate-wizard-mock-open" /> : null,
}));
vi.mock("../CompressionPolicyDialog", () => ({
  CompressionPolicyDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="compression-policy-dialog-mock-open" /> : null,
}));
vi.mock("../RetentionPolicyDialog", () => ({
  RetentionPolicyDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="retention-policy-dialog-mock-open" /> : null,
}));
vi.mock("../RefreshPolicyDialog", () => ({
  RefreshPolicyDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="refresh-policy-dialog-mock-open" /> : null,
}));

function baseProps(overrides: Partial<TimescaleTablePanelProps> = {}): TimescaleTablePanelProps {
  return {
    connId: "conn-1",
    schema: "public",
    table: "metrics",
    qualifiedTable: '"public"."metrics"',
    isHypertable: false,
    isContinuousAggregate: false,
    columns: [
      { name: "ts", typeName: "timestamptz" },
      { name: "value", typeName: "double precision" },
    ],
    ...overrides,
  };
}

describe("TimescaleTablePanel", () => {
  it("regular table: only Convert is enabled and opens hypertable wizard", () => {
    render(<TimescaleTablePanel {...baseProps({ isHypertable: false })} />);

    expect(screen.getByTestId("timescale-table-panel")).toBeTruthy();

    const convert = screen.getByTestId("ts-panel-convert") as HTMLButtonElement;
    expect(convert.disabled).toBe(false);

    const ca = screen.getByTestId("ts-panel-ca") as HTMLButtonElement;
    const compression = screen.getByTestId("ts-panel-compression") as HTMLButtonElement;
    const retention = screen.getByTestId("ts-panel-retention") as HTMLButtonElement;
    expect(ca.disabled).toBe(true);
    expect(compression.disabled).toBe(true);
    expect(retention.disabled).toBe(true);
    expect(ca.getAttribute("title")).toBe("Convert to hypertable first");
    expect(compression.getAttribute("title")).toBe("Convert to hypertable first");
    expect(retention.getAttribute("title")).toBe("Convert to hypertable first");

    expect(screen.queryByTestId("ts-panel-refresh")).toBeNull();

    fireEvent.click(convert);
    expect(screen.getByTestId("hypertable-wizard-mock-open")).toBeTruthy();
  });

  it("hypertable (not CA): Convert hidden, 3 buttons enabled, each opens its dialog", () => {
    render(      <TimescaleTablePanel {...baseProps({ isHypertable: true, isContinuousAggregate: false })} />,
);

    expect(screen.queryByTestId("ts-panel-convert")).toBeNull();
    expect(screen.queryByTestId("ts-panel-refresh")).toBeNull();

    const ca = screen.getByTestId("ts-panel-ca") as HTMLButtonElement;
    const compression = screen.getByTestId("ts-panel-compression") as HTMLButtonElement;
    const retention = screen.getByTestId("ts-panel-retention") as HTMLButtonElement;
    expect(ca.disabled).toBe(false);
    expect(compression.disabled).toBe(false);
    expect(retention.disabled).toBe(false);

    fireEvent.click(ca);
    expect(screen.getByTestId("continuous-aggregate-wizard-mock-open")).toBeTruthy();

    fireEvent.click(compression);
    expect(screen.getByTestId("compression-policy-dialog-mock-open")).toBeTruthy();
    expect(screen.queryByTestId("continuous-aggregate-wizard-mock-open")).toBeNull();

    fireEvent.click(retention);
    expect(screen.getByTestId("retention-policy-dialog-mock-open")).toBeTruthy();
    expect(screen.queryByTestId("compression-policy-dialog-mock-open")).toBeNull();
  });

  it("continuous aggregate: 4 buttons enabled, Refresh opens refresh dialog", () => {
    render(      <TimescaleTablePanel {...baseProps({ isHypertable: true, isContinuousAggregate: true })} />,
);

    expect(screen.queryByTestId("ts-panel-convert")).toBeNull();

    const ca = screen.getByTestId("ts-panel-ca") as HTMLButtonElement;
    const compression = screen.getByTestId("ts-panel-compression") as HTMLButtonElement;
    const retention = screen.getByTestId("ts-panel-retention") as HTMLButtonElement;
    const refresh = screen.getByTestId("ts-panel-refresh") as HTMLButtonElement;

    expect(ca.disabled).toBe(false);
    expect(compression.disabled).toBe(false);
    expect(retention.disabled).toBe(false);
    expect(refresh.disabled).toBe(false);

    fireEvent.click(refresh);
    expect(screen.getByTestId("refresh-policy-dialog-mock-open")).toBeTruthy();
  });
});
