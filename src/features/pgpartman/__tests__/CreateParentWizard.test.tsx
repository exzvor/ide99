// — .
// Strategy: mock the editor store so we can assert the SQL emitted to the
// query editor, plus mock the partman SQL builder + IntervalInput to keep
// the wizard test independent of unit-tested helpers.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const openEditorTab = vi.fn();

vi.mock("../../editor/store", () => ({
  useEditor: {
    getState: () => ({ openEditorTab }),
  },
}));

import { CreateParentWizard } from "../CreateParentWizard";

const COLUMNS = [
  { name: "id", typeName: "int8" },
  { name: "created_at", typeName: "timestamptz" },
  { name: "name", typeName: "text" },
];

describe("CreateParentWizard", () => {
  it("returns null when closed", () => {
    render(
      <CreateParentWizard
        open={false}
        connId="conn-1"
        schema="public"
        table="events"
        qualifiedTable={'"public"."events"'}
        columns={COLUMNS}
        onClose={() => {}}
      />,
    );
    expect(screen.queryByTestId("pg-partman-create-parent-wizard")).not.toBeInTheDocument();
  });

  it("renders only time/integer columns in the control select", () => {
    render(
      <CreateParentWizard
        open={true}
        connId="conn-1"
        schema="public"
        table="events"
        qualifiedTable={'"public"."events"'}
        columns={COLUMNS}
        onClose={() => {}}
      />,
    );
    expect(screen.getByTestId("pg-partman-create-parent-wizard")).toBeInTheDocument();
    const select = screen.getByTestId("pg-partman-create-parent-control-col") as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toContain("id");
    expect(options).toContain("created_at");
    expect(options).not.toContain("name");
  });

  it("emits SQL via openEditorTab when Apply is clicked with default values", () => {
    openEditorTab.mockClear();
    const onClose = vi.fn();
    render(
      <CreateParentWizard
        open={true}
        connId="conn-1"
        schema="public"
        table="events"
        qualifiedTable={'"public"."events"'}
        columns={COLUMNS}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByTestId("pg-partman-create-parent-apply"));
    expect(openEditorTab).toHaveBeenCalledTimes(1);
    const [connArg, opts] = openEditorTab.mock.calls[0];
    expect(connArg).toBe("conn-1");
    const sql = (opts as { prefillSql: string }).prefillSql;
    expect(sql).toContain("partman.create_parent(");
    expect(sql).toContain("p_parent_table => 'public.events'");
    // fix: default control prefers a temporal column when one
    // exists; for this fixture (id + created_at) that's `created_at`.
    expect(sql).toContain("p_control => 'created_at'");
    // fix: p_type is no longer emitted (partman 5.x rejects
    // the legacy 'native' value; default 'range' covers the wizard flow).
    expect(sql).not.toContain("p_type");
    // Default interval is 1 day → `1 days` literal from IntervalInput helper.
    expect(sql).toContain("p_interval => '1 days'");
    // Default premake (4) is left out because we treat 4 as the partman
    // default — the wizard only emits p_premake when the user changes it.
    expect(sql).not.toContain("p_premake");
    // Retention is off by default.
    expect(sql).not.toContain("UPDATE partman.part_config");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("emits premake + retention when set by the user", () => {
    openEditorTab.mockClear();
    const onClose = vi.fn();
    render(
      <CreateParentWizard
        open={true}
        connId="conn-1"
        schema="public"
        table="events"
        qualifiedTable={'"public"."events"'}
        columns={COLUMNS}
        onClose={onClose}
      />,
    );

    // Change premake to 8.
    const premakeInput = screen.getByTestId("pg-partman-create-parent-premake") as HTMLInputElement;
    fireEvent.change(premakeInput, { target: { value: "8" } });

    // Toggle retention on (default 6 month).
    const retentionToggle = screen.getByTestId(
      "pg-partman-create-parent-retention-toggle",
    ) as HTMLInputElement;
    fireEvent.click(retentionToggle);

    fireEvent.click(screen.getByTestId("pg-partman-create-parent-apply"));

    const [, opts] = openEditorTab.mock.calls[0];
    const sql = (opts as { prefillSql: string }).prefillSql;
    expect(sql).toContain("p_premake => 8");
    expect(sql).toContain("UPDATE partman.part_config");
    expect(sql).toContain("retention = '6 months'");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Cancel closes without emitting SQL", () => {
    openEditorTab.mockClear();
    const onClose = vi.fn();
    render(
      <CreateParentWizard
        open={true}
        connId="conn-1"
        schema="public"
        table="events"
        qualifiedTable={'"public"."events"'}
        columns={COLUMNS}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByTestId("pg-partman-create-parent-cancel"));
    expect(openEditorTab).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
