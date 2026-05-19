// — .
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const openEditorTab = vi.fn();

vi.mock("../../editor/store", () => ({
  useEditor: {
    getState: () => ({ openEditorTab }),
  },
}));

import { ConfigViewerDialog } from "../ConfigViewerDialog";
import type { PartmanParent } from "../store";

const PARENT_INFO: PartmanParent = {
  schema: "public",
  table: "events",
  controlColumn: "created_at",
  intervalText: "1 day",
  retentionText: "6 months",
  premakeCount: 4,
};

describe("ConfigViewerDialog", () => {
  it("returns null when closed", () => {
    render(
      <ConfigViewerDialog
        open={false}
        connId="conn-1"
        qualifiedTable="public.events"
        partmanInfo={PARENT_INFO}
        onClose={() => {}}
      />,
    );
    expect(screen.queryByTestId("pg-partman-config-viewer")).not.toBeInTheDocument();
  });

  it("renders the partman info as a description list", () => {
    render(
      <ConfigViewerDialog
        open={true}
        connId="conn-1"
        qualifiedTable="public.events"
        partmanInfo={PARENT_INFO}
        onClose={() => {}}
      />,
    );
    expect(screen.getByTestId("pg-partman-config-viewer")).toBeInTheDocument();
    // Spot-check the rendered values.
    expect(screen.getByText("created_at")).toBeInTheDocument();
    expect(screen.getByText("1 day")).toBeInTheDocument();
    expect(screen.getByText("6 months")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
  });

  it("renders — when retention is null", () => {
    render(
      <ConfigViewerDialog
        open={true}
        connId="conn-1"
        qualifiedTable="public.events"
        partmanInfo={{ ...PARENT_INFO, retentionText: null }}
        onClose={() => {}}
      />,
    );
    expect(screen.getByTestId("pg-partman-config-retention")).toHaveTextContent("—");
  });

  it("Run Maintenance emits the run_maintenance_proc SQL and closes", () => {
    openEditorTab.mockClear();
    const onClose = vi.fn();
    render(
      <ConfigViewerDialog
        open={true}
        connId="conn-1"
        qualifiedTable="public.events"
        partmanInfo={PARENT_INFO}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByTestId("pg-partman-run-maintenance"));

    expect(openEditorTab).toHaveBeenCalledTimes(1);
    const [connArg, opts] = openEditorTab.mock.calls[0];
    expect(connArg).toBe("conn-1");
    expect((opts as { prefillSql: string }).prefillSql).toContain("partman.run_maintenance_proc()");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Drop (keep data) emits undo_partition with p_keep_table => true and closes", () => {
    openEditorTab.mockClear();
    const onClose = vi.fn();
    render(
      <ConfigViewerDialog
        open={true}
        connId="conn-1"
        qualifiedTable="public.events"
        partmanInfo={PARENT_INFO}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByTestId("pg-partman-drop-keep-data"));

    expect(openEditorTab).toHaveBeenCalledTimes(1);
    const [, opts] = openEditorTab.mock.calls[0];
    const sql = (opts as { prefillSql: string }).prefillSql;
    expect(sql).toContain("partman.undo_partition(");
    expect(sql).toContain("p_parent_table => 'public.events'");
    expect(sql).toContain("p_keep_table => true");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Drop (drop data) requires typing the qualified table name to confirm", () => {
    openEditorTab.mockClear();
    const onClose = vi.fn();
    render(
      <ConfigViewerDialog
        open={true}
        connId="conn-1"
        qualifiedTable="public.events"
        partmanInfo={PARENT_INFO}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByTestId("pg-partman-drop-drop-data"));

    // The typing-confirm modal opens; its confirm button is disabled until
    // the user types the qualified table name.
    const confirmBtn = screen.getByTestId("pg-partman-drop-drop-data-confirm") as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(true);

    const input = screen.getByTestId("pg-partman-drop-drop-data-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "public.events" } });

    expect(confirmBtn.disabled).toBe(false);
    fireEvent.click(confirmBtn);

    expect(openEditorTab).toHaveBeenCalledTimes(1);
    const [, opts] = openEditorTab.mock.calls[0];
    const sql = (opts as { prefillSql: string }).prefillSql;
    expect(sql).toContain("p_parent_table => 'public.events'");
    expect(sql).toContain("p_keep_table => false");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
