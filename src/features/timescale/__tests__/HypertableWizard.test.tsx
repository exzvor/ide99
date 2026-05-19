// — .
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const openEditorTab = vi.fn();

vi.mock("../../editor/store", () => ({
  useEditor: {
    getState: () => ({ openEditorTab }),
  },
}));

// owns the real builder + detection — keep this test self-contained.
vi.mock("../timescaleDetect", () => ({
  detectTimeColumns: (cols: { name: string; typeName: string }[]) =>
    cols.filter((c) => /timestamp|date/i.test(c.typeName)),
}));

vi.mock("../hypertableSql", () => ({
  buildCreateHypertableSql: (form: {
    qualifiedTable: string;
    timeColumn: string;
    chunkTimeInterval: string;
    partitioningColumn?: string;
    migrateData?: boolean;
    ifNotExists?: boolean;
    createDefaultIndexes?: boolean;
  }) =>
    [
      "SELECT create_hypertable(",
      `  '${form.qualifiedTable}',`,
      `  '${form.timeColumn}',`,
      `  chunk_time_interval => INTERVAL '${form.chunkTimeInterval}'`,
      form.partitioningColumn ? `  , partitioning_column => '${form.partitioningColumn}'` : "",
      form.migrateData ? "  , migrate_data => true" : "",
      form.ifNotExists ? "  , if_not_exists => true" : "",
      form.createDefaultIndexes ? "  , create_default_indexes => true" : "",
      ");",
    ]
      .filter(Boolean)
      .join("\n"),
}));

import { HypertableWizard } from "../HypertableWizard";

const COLUMNS = [
  { name: "id", typeName: "int8" },
  { name: "ts", typeName: "timestamptz" },
  { name: "device_id", typeName: "int4" },
  { name: "temperature", typeName: "float8" },
];

describe("HypertableWizard", () => {
  it("returns null when closed", () => {
    render(      <HypertableWizard
        open={false}
        connId="conn-1"
        qualifiedTable={'"public"."metrics"'}
        columns={COLUMNS}
        onClose={() => {}}
      />,
);
    expect(screen.queryByTestId("hypertable-wizard")).not.toBeInTheDocument();
  });

  it("renders the Basic section visible and Advanced section hidden by default", () => {
    render(      <HypertableWizard
        open={true}
        connId="conn-1"
        qualifiedTable={'"public"."metrics"'}
        columns={COLUMNS}
        onClose={() => {}}
      />,
);
    expect(screen.getByTestId("hypertable-wizard")).toBeInTheDocument();
    // Time column select is part of Basic.
    expect(screen.getByTestId("hypertable-wizard-time-col")).toBeInTheDocument();
    // Advanced section is hidden initially — its toggle is present but the
    // partitioning column select is not rendered yet.
    expect(screen.getByTestId("hypertable-wizard-advanced-toggle")).toBeInTheDocument();
    expect(screen.queryByTestId("hypertable-wizard-partitioning-col")).not.toBeInTheDocument();
  });

  it("expands the Advanced section when the disclosure toggle is clicked", () => {
    render(      <HypertableWizard
        open={true}
        connId="conn-1"
        qualifiedTable={'"public"."metrics"'}
        columns={COLUMNS}
        onClose={() => {}}
      />,
);
    fireEvent.click(screen.getByTestId("hypertable-wizard-advanced-toggle"));
    expect(screen.getByTestId("hypertable-wizard-partitioning-col")).toBeInTheDocument();
    expect(screen.getByTestId("hypertable-wizard-migrate-data")).toBeInTheDocument();
    expect(screen.getByTestId("hypertable-wizard-if-not-exists")).toBeInTheDocument();
    expect(screen.getByTestId("hypertable-wizard-create-default-indexes")).toBeInTheDocument();
  });

  it("emits SQL via openEditorTab when Apply is clicked with default values", () => {
    openEditorTab.mockClear();
    const onClose = vi.fn();
    render(      <HypertableWizard
        open={true}
        connId="conn-1"
        qualifiedTable={'"public"."metrics"'}
        columns={COLUMNS}
        onClose={onClose}
      />,
);
    fireEvent.click(screen.getByTestId("hypertable-wizard-apply"));
    expect(openEditorTab).toHaveBeenCalledTimes(1);
    const [connArg, opts] = openEditorTab.mock.calls[0];
    expect(connArg).toBe("conn-1");
    const sql = (opts as { prefillSql: string }).prefillSql;
    expect(sql).toContain("create_hypertable");
    expect(sql).toContain('"public"."metrics"');
    // Time column defaults to first detected candidate ("ts").
    expect(sql).toContain("'ts'");
    // Default chunk_time_interval is 7 days.
    expect(sql).toContain("INTERVAL '7 days'");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
