// — .
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const openEditorTab = vi.fn();
const loadCompressionPolicy = vi.fn();

vi.mock("../../editor/store", () => ({
  useEditor: {
    getState: () => ({ openEditorTab }),
  },
}));

vi.mock("../policyState", () => ({
  loadCompressionPolicy: (connId: string, schema: string, table: string) =>
    loadCompressionPolicy(connId, schema, table),
}));

vi.mock("../compressionPolicySql", () => ({
  buildCompressionPolicySql: (form: {
    qualifiedTable: string;
    segmentBy?: string;
    orderBy?: string;
    compressAfter: string;
    mode: "create" | "drop";
  }) => {
    if (form.mode === "drop") {
      return `SELECT remove_compression_policy('${form.qualifiedTable}');`;
    }
    return [
      `ALTER TABLE ${form.qualifiedTable} SET (`,
      "  timescaledb.compress,",
      form.segmentBy ? `  timescaledb.compress_segmentby = '${form.segmentBy}',` : "",
      form.orderBy ? `  timescaledb.compress_orderby = '${form.orderBy}'` : "",
      ");",
      `SELECT add_compression_policy('${form.qualifiedTable}', INTERVAL '${form.compressAfter}');`,
    ]
      .filter(Boolean)
      .join("\n");
  },
}));

import { CompressionPolicyDialog } from "../CompressionPolicyDialog";

describe("CompressionPolicyDialog", () => {
  it("creates a policy when none exists", async () => {
    openEditorTab.mockClear();
    loadCompressionPolicy.mockResolvedValueOnce(null);
    const onClose = vi.fn();

    render(
      <CompressionPolicyDialog
        open={true}
        connId="conn-1"
        qualifiedTable={'"public"."metrics"'}
        schema="public"
        table="metrics"
        columns={[{ name: "device_id", typeName: "int4" }]}
        onClose={onClose}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("compression-policy-dialog-apply")).toBeInTheDocument(),
    );

    // No existing policy → Drop button is hidden, "Policy active" banner absent.
    expect(screen.queryByTestId("compression-policy-dialog-drop")).not.toBeInTheDocument();
    expect(screen.queryByText(/Policy active/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("compression-policy-dialog-apply"));

    expect(openEditorTab).toHaveBeenCalledTimes(1);
    const [, opts] = openEditorTab.mock.calls[0];
    const sql = (opts as { prefillSql: string }).prefillSql;
    expect(sql).toContain("ALTER TABLE");
    expect(sql).toContain("add_compression_policy");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders the active-policy banner and emits a drop SQL when Drop is clicked", async () => {
    openEditorTab.mockClear();
    loadCompressionPolicy.mockResolvedValueOnce({ jobId: 1001, compressAfter: "30 days" });
    const onClose = vi.fn();

    render(
      <CompressionPolicyDialog
        open={true}
        connId="conn-1"
        qualifiedTable={'"public"."metrics"'}
        schema="public"
        table="metrics"
        columns={[]}
        onClose={onClose}
      />,
    );

    await waitFor(() => expect(screen.getByText(/Policy active/i)).toBeInTheDocument());
    expect(screen.getByText(/Policy active/i).textContent).toContain("30 days");
    expect(screen.getByText(/Policy active/i).textContent).toContain("1001");

    // IntervalInput should be prefilled to {30, day}.
    const intervalRoot = screen.getByTestId("interval-input-compress-after");
    const numberInput = intervalRoot.querySelector("input[type='number']") as HTMLInputElement;
    const select = intervalRoot.querySelector("select") as HTMLSelectElement;
    expect(numberInput.value).toBe("30");
    expect(select.value).toBe("day");

    fireEvent.click(screen.getByTestId("compression-policy-dialog-drop"));

    expect(openEditorTab).toHaveBeenCalledTimes(1);
    const [, opts] = openEditorTab.mock.calls[0];
    const sql = (opts as { prefillSql: string }).prefillSql;
    expect(sql).toContain("remove_compression_policy");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
