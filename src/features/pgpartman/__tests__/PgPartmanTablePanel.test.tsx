// — .
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { vi } from "vitest";

vi.mock("../CreateParentWizard", () => ({
  CreateParentWizard: ({ open }: { open: boolean }) =>
    open ? <div data-testid="pg-partman-create-parent-wizard-mock-open" /> : null,
}));

vi.mock("../ConfigViewerDialog", () => ({
  ConfigViewerDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="pg-partman-config-viewer-mock-open" /> : null,
}));

import { PgPartmanTablePanel, type PgPartmanTablePanelProps } from "../PgPartmanTablePanel";
import type { PartmanParent } from "../store";

const COLUMNS = [
  { name: "id", typeName: "int8" },
  { name: "ts", typeName: "timestamptz" },
  { name: "name", typeName: "text" },
];

const PARENT: PartmanParent = {
  schema: "public",
  table: "events",
  controlColumn: "ts",
  intervalText: "1 day",
  retentionText: "6 months",
  premakeCount: 4,
};

function baseProps(overrides: Partial<PgPartmanTablePanelProps> = {}): PgPartmanTablePanelProps {
  return {
    connId: "conn-1",
    schema: "public",
    table: "events",
    qualifiedTable: '"public"."events"',
    isPartmanParent: false,
    partmanInfo: null,
    columns: COLUMNS,
    ...overrides,
  };
}

describe("PgPartmanTablePanel", () => {
  it("regular table: renders only the Create button and opens the wizard", () => {
    render(<PgPartmanTablePanel {...baseProps()} />);

    expect(screen.getByTestId("pg-partman-table-panel")).toBeInTheDocument();
    const create = screen.getByTestId("pg-partman-panel-create") as HTMLButtonElement;
    expect(create).toBeInTheDocument();
    expect(screen.queryByTestId("pg-partman-panel-config")).toBeNull();

    fireEvent.click(create);
    expect(screen.getByTestId("pg-partman-create-parent-wizard-mock-open")).toBeInTheDocument();
  });

  it("partman parent: renders the inline summary, hides Create, opens config dialog", () => {
    render(<PgPartmanTablePanel {...baseProps({ isPartmanParent: true, partmanInfo: PARENT })} />);

    expect(screen.queryByTestId("pg-partman-panel-create")).toBeNull();

    const config = screen.getByTestId("pg-partman-panel-config") as HTMLButtonElement;
    expect(config).toBeInTheDocument();

    // Summary line is rendered with control / interval / retention / premake.
    const summary = screen.getByTestId("pg-partman-panel-summary");
    expect(summary.textContent).toContain("ts");
    expect(summary.textContent).toContain("1 day");
    expect(summary.textContent).toContain("6 months");
    expect(summary.textContent).toContain("4");

    fireEvent.click(config);
    expect(screen.getByTestId("pg-partman-config-viewer-mock-open")).toBeInTheDocument();
  });

  it("partman parent without retention: summary reads 'none'", () => {
    render(      <PgPartmanTablePanel
        {...baseProps({
          isPartmanParent: true,
          partmanInfo: { ...PARENT, retentionText: null },
        })}
      />,
);
    const summary = screen.getByTestId("pg-partman-panel-summary");
    expect(summary.textContent).toContain("none");
  });
});
