// — .
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const openEditorTab = vi.fn();
const loadRetentionPolicy = vi.fn();

vi.mock("../../editor/store", () => ({
  useEditor: {
    getState: () => ({ openEditorTab }),
  },
}));

vi.mock("../policyState", () => ({
  loadRetentionPolicy: (connId: string, schema: string, table: string) =>
    loadRetentionPolicy(connId, schema, table),
}));

vi.mock("../retentionPolicySql", () => ({
  buildRetentionPolicySql: (form: {
    qualifiedTable: string;
    dropAfter: string;
    mode: "create" | "drop";
  }) =>
    form.mode === "drop"
      ? `SELECT remove_retention_policy('${form.qualifiedTable}');`
      : `SELECT add_retention_policy('${form.qualifiedTable}', INTERVAL '${form.dropAfter}');`,
}));

import { RetentionPolicyDialog } from "../RetentionPolicyDialog";

describe("RetentionPolicyDialog", () => {
  it("creates a retention policy when none exists", async () => {
    openEditorTab.mockClear();
    loadRetentionPolicy.mockResolvedValueOnce(null);
    const onClose = vi.fn();

    render(
      <RetentionPolicyDialog
        open={true}
        connId="conn-1"
        qualifiedTable={'"public"."metrics"'}
        schema="public"
        table="metrics"
        onClose={onClose}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("retention-policy-dialog-apply")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("retention-policy-dialog-drop")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("retention-policy-dialog-apply"));

    expect(openEditorTab).toHaveBeenCalledTimes(1);
    const [, opts] = openEditorTab.mock.calls[0];
    expect((opts as { prefillSql: string }).prefillSql).toContain("add_retention_policy");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("drops an existing retention policy", async () => {
    openEditorTab.mockClear();
    loadRetentionPolicy.mockResolvedValueOnce({ jobId: 2002, dropAfter: "30 days" });
    const onClose = vi.fn();

    render(
      <RetentionPolicyDialog
        open={true}
        connId="conn-1"
        qualifiedTable={'"public"."metrics"'}
        schema="public"
        table="metrics"
        onClose={onClose}
      />,
    );

    await waitFor(() => expect(screen.getByText(/Policy active/i)).toBeInTheDocument());
    expect(screen.getByText(/Policy active/i).textContent).toContain("30 days");

    fireEvent.click(screen.getByTestId("retention-policy-dialog-drop"));

    const [, opts] = openEditorTab.mock.calls[0];
    expect((opts as { prefillSql: string }).prefillSql).toContain("remove_retention_policy");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
