// — .
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const openEditorTab = vi.fn();

vi.mock("../../editor/store", () => ({
  useEditor: {
    getState: () => ({ openEditorTab }),
  },
}));

// Phase B's stubs — keep this test self-contained.
vi.mock("../timescaleDetect", () => ({
  detectTimeColumns: (cols: { name: string; typeName: string }[]) =>
    cols.filter((c) => /timestamp|date/i.test(c.typeName)),
}));

vi.mock("../continuousAggregateSql", () => ({
  buildContinuousAggregateSql: (form: {
    viewName: string;
    sourceHypertable: string;
    timeColumn: string;
    bucketInterval: string;
    aggregationsExpression: string;
    groupByExtra: string;
    withData: boolean;
  }) =>
    [
      `CREATE MATERIALIZED VIEW ${form.viewName}`,
      "WITH (timescaledb.continuous) AS",
      "SELECT",
      `  time_bucket(INTERVAL '${form.bucketInterval}', ${form.timeColumn}) AS bucket,`,
      form.groupByExtra ? `  ${form.groupByExtra},` : "",
      `  ${form.aggregationsExpression}`,
      `FROM ${form.sourceHypertable}`,
      `GROUP BY bucket${form.groupByExtra ? `, ${form.groupByExtra}` : ""}`,
      `WITH ${form.withData ? "" : "NO "}DATA;`,
    ]
      .filter(Boolean)
      .join("\n"),
}));

import { ContinuousAggregateWizard } from "../ContinuousAggregateWizard";

const COLUMNS = [
  { name: "ts", typeName: "timestamptz" },
  { name: "device_id", typeName: "int4" },
  { name: "temperature", typeName: "float8" },
];

describe("ContinuousAggregateWizard", () => {
  it("renders the form with required fields", () => {
    render(      <ContinuousAggregateWizard
        open={true}
        connId="conn-1"
        qualifiedTable={'"public"."metrics"'}
        schema="public"
        table="metrics"
        columns={COLUMNS}
        onClose={() => {}}
      />,
);
    expect(screen.getByTestId("continuous-aggregate-wizard")).toBeInTheDocument();
    expect(screen.getByTestId("continuous-aggregate-wizard-view-name")).toBeInTheDocument();
    expect(screen.getByTestId("continuous-aggregate-wizard-time-col")).toBeInTheDocument();
    expect(screen.getByTestId("continuous-aggregate-wizard-aggregations")).toBeInTheDocument();
  });

  it("emits SQL with quoted view name and WITH NO DATA by default on Apply", () => {
    openEditorTab.mockClear();
    const onClose = vi.fn();
    render(      <ContinuousAggregateWizard
        open={true}
        connId="conn-1"
        qualifiedTable={'"public"."metrics"'}
        schema="public"
        table="metrics"
        columns={COLUMNS}
        onClose={onClose}
      />,
);
    fireEvent.change(screen.getByTestId("continuous-aggregate-wizard-view-name"), {
      target: { value: "hourly_metrics" },
    });
    fireEvent.change(screen.getByTestId("continuous-aggregate-wizard-aggregations"), {
      target: { value: "count(*) AS n" },
    });
    fireEvent.click(screen.getByTestId("continuous-aggregate-wizard-apply"));

    expect(openEditorTab).toHaveBeenCalledTimes(1);
    const [, opts] = openEditorTab.mock.calls[0];
    const sql = (opts as { prefillSql: string }).prefillSql;
    expect(sql).toContain("time_bucket(");
    expect(sql).toContain("WITH (timescaledb.continuous)");
    expect(sql).toContain('"public"."hourly_metrics"');
    expect(sql).toContain("WITH NO DATA");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("emits WITH DATA when the checkbox is enabled", () => {
    openEditorTab.mockClear();
    render(      <ContinuousAggregateWizard
        open={true}
        connId="conn-1"
        qualifiedTable={'"public"."metrics"'}
        schema="public"
        table="metrics"
        columns={COLUMNS}
        onClose={() => {}}
      />,
);
    fireEvent.change(screen.getByTestId("continuous-aggregate-wizard-view-name"), {
      target: { value: "hourly_metrics" },
    });
    fireEvent.click(screen.getByTestId("continuous-aggregate-wizard-with-data"));
    fireEvent.click(screen.getByTestId("continuous-aggregate-wizard-apply"));

    const [, opts] = openEditorTab.mock.calls[0];
    const sql = (opts as { prefillSql: string }).prefillSql;
    expect(sql).toContain("WITH DATA");
    expect(sql).not.toContain("WITH NO DATA");
  });

  it("uses custom raw view name when 'use custom qualified name' is enabled", () => {
    openEditorTab.mockClear();
    render(      <ContinuousAggregateWizard
        open={true}
        connId="conn-1"
        qualifiedTable={'"public"."metrics"'}
        schema="public"
        table="metrics"
        columns={COLUMNS}
        onClose={() => {}}
      />,
);
    fireEvent.click(screen.getByTestId("continuous-aggregate-wizard-custom-name"));
    fireEvent.change(screen.getByTestId("continuous-aggregate-wizard-view-name-raw"), {
      target: { value: "analytics.cagg_v1" },
    });
    fireEvent.click(screen.getByTestId("continuous-aggregate-wizard-apply"));

    const [, opts] = openEditorTab.mock.calls[0];
    const sql = (opts as { prefillSql: string }).prefillSql;
    expect(sql).toContain("analytics.cagg_v1");
  });
});
