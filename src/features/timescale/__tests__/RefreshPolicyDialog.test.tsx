// — .
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const openEditorTab = vi.fn();
const loadRefreshPolicy = vi.fn();

vi.mock("../../editor/store", () => ({
  useEditor: {
    getState: () => ({ openEditorTab }),
  },
}));

vi.mock("../policyState", () => ({
  loadRefreshPolicy: (connId: string, schema: string, view: string) =>
    loadRefreshPolicy(connId, schema, view),
}));

vi.mock("../refreshPolicySql", () => ({
  buildRefreshPolicySql: (form: {
    qualifiedView: string;
    startOffset: string;
    endOffset: string;
    scheduleInterval: string;
    mode: "create" | "drop";
  }) =>
    form.mode === "drop"
      ? `SELECT remove_continuous_aggregate_policy('${form.qualifiedView}');`
      : `SELECT add_continuous_aggregate_policy('${form.qualifiedView}', INTERVAL '${form.startOffset}', INTERVAL '${form.endOffset}', INTERVAL '${form.scheduleInterval}');`,
}));

import { RefreshPolicyDialog } from "../RefreshPolicyDialog";

describe("RefreshPolicyDialog", () => {
  it("creates a refresh policy when none exists", async () => {
    openEditorTab.mockClear();
    loadRefreshPolicy.mockResolvedValueOnce(null);
    const onClose = vi.fn();

    render(      <RefreshPolicyDialog
        open={true}
        connId="conn-1"
        qualifiedView={'"public"."hourly_metrics"'}
        schema="public"
        view="hourly_metrics"
        onClose={onClose}
      />,
);

    await waitFor(() =>
      expect(screen.getByTestId("refresh-policy-dialog-apply")).toBeInTheDocument(),
);
    expect(screen.queryByTestId("refresh-policy-dialog-drop")).not.toBeInTheDocument();
    // Three IntervalInputs.
    expect(screen.getByTestId("interval-input-start-offset")).toBeInTheDocument();
    expect(screen.getByTestId("interval-input-end-offset")).toBeInTheDocument();
    expect(screen.getByTestId("interval-input-schedule-interval")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("refresh-policy-dialog-apply"));

    expect(openEditorTab).toHaveBeenCalledTimes(1);
    const [, opts] = openEditorTab.mock.calls[0];
    expect((opts as { prefillSql: string }).prefillSql).toContain(      "add_continuous_aggregate_policy",
);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("drops an existing refresh policy", async () => {
    openEditorTab.mockClear();
    loadRefreshPolicy.mockResolvedValueOnce({
      jobId: 3003,
      startOffset: "30 days",
      endOffset: "1 hour",
      scheduleInterval: "1 hour",
    });
    const onClose = vi.fn();

    render(      <RefreshPolicyDialog
        open={true}
        connId="conn-1"
        qualifiedView={'"public"."hourly_metrics"'}
        schema="public"
        view="hourly_metrics"
        onClose={onClose}
      />,
);

    await waitFor(() => expect(screen.getByText(/Policy active/i)).toBeInTheDocument());
    expect(screen.getByText(/Policy active/i).textContent).toContain("3003");

    fireEvent.click(screen.getByTestId("refresh-policy-dialog-drop"));

    const [, opts] = openEditorTab.mock.calls[0];
    expect((opts as { prefillSql: string }).prefillSql).toContain(      "remove_continuous_aggregate_policy",
);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
