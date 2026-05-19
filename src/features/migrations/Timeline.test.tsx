/**
 * —
 *
 * Timeline.tsx is a vertical scroll list. Each row carries:
 * - the status icon (✔ / ⏸ / ⚠ / 🚫) with a colored badge,
 * - version + name + applied-at (or "pending"),
 * - a "no rollback file" hint when downPath === null,
 * - role="button" + aria-pressed for keyboard nav.
 *
 * The component does not own selection; the parent passes
 * `selectedVersion` + `onSelect` and the panel mirrors selection into the
 * Zustand store.
 */

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Timeline } from "./Timeline";
import { useLintStore } from "./squawk/lintStore";
import type { Migration } from "./store";

const FAKE_DICT: Record<string, string> = {
  "migrations.timeline.summary": "{{applied}} applied · {{pending}} pending · {{dirty}} dirty",
  "migrations.timeline.empty": "no rows",
  "migrations.timeline.applied": "applied",
  "migrations.timeline.pending": "pending",
  "migrations.timeline.dirty": "dirty",
  "migrations.timeline.noRollbackFile": "No rollback file",
  "migrations.timeline.duplicateVersion": "Duplicate version",
  "migrations.timeline.orphanRollback": "Orphan rollback file",
  "migrations.timeline.checksumMismatch": "Checksum mismatch",
  "migrations.timeline.fileMissing": "File missing",
};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => {
      const template = FAKE_DICT[key] ?? key;
      if (!vars) return template;
      return Object.entries(vars).reduce<string>(
        (acc, [k, v]) => acc.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), String(v)),
        template,
      );
    },
  }),
}));

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

function migration(overrides: Partial<Migration> = {}): Migration {
  return {
    version: "0001",
    name: "create_users",
    upPath: "/m/0001_create_users.up.sql",
    downPath: "/m/0001_create_users.down.sql",
    status: "pending",
    appliedAt: null,
    appliedBy: null,
    durationMs: null,
    diskChecksum: "abc",
    appliedChecksum: null,
    hasSnapshot: false,
    parseError: null,
    ...overrides,
  };
}

describe("Timeline", () => {
  it("renders applied badge for applied migrations", () => {
    render(
      <Timeline
        migrations={[
          migration({
            version: "0001",
            status: "applied",
            appliedAt: "2026-04-12T14:22:00Z",
            durationMs: 120,
          }),
        ]}
        selectedVersion={null}
        onSelect={() => {}}
      />,
    );
    const row = screen.getByTestId("migration-row-0001");
    expect(row).toHaveAttribute("data-status", "applied");
    expect(row.textContent).toContain("applied");
  });

  it("renders pending badge for pending migrations", () => {
    render(
      <Timeline
        migrations={[migration({ version: "0002", status: "pending" })]}
        selectedVersion={null}
        onSelect={() => {}}
      />,
    );
    const row = screen.getByTestId("migration-row-0002");
    expect(row).toHaveAttribute("data-status", "pending");
    expect(row.textContent).toContain("pending");
  });

  it("renders dirty badge with yellow indicator when status=dirty", () => {
    render(
      <Timeline
        migrations={[migration({ version: "0003", status: "dirty" })]}
        selectedVersion={null}
        onSelect={() => {}}
      />,
    );
    const row = screen.getByTestId("migration-row-0003");
    expect(row).toHaveAttribute("data-status", "dirty");
    expect(row.textContent).toContain("dirty");
  });

  it("renders 'no rollback file' tooltip when downPath=null", () => {
    render(
      <Timeline
        migrations={[migration({ version: "0004", downPath: null })]}
        selectedVersion={null}
        onSelect={() => {}}
      />,
    );
    const noRollback = screen.getByTestId("migration-row-0004-no-rollback");
    expect(noRollback).toBeInTheDocument();
    expect(noRollback).toHaveAttribute("title", "No rollback file");
  });

  it("clicking a row calls onSelect with version", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <Timeline
        migrations={[migration({ version: "0005" }), migration({ version: "0006" })]}
        selectedVersion={null}
        onSelect={onSelect}
      />,
    );
    await user.click(screen.getByTestId("migration-row-0006"));
    expect(onSelect).toHaveBeenCalledWith("0006");
  });

  it("ArrowDown / ArrowUp moves selection", () => {
    const onSelect = vi.fn();
    render(
      <Timeline
        migrations={[
          migration({ version: "0001" }),
          migration({ version: "0002" }),
          migration({ version: "0003" }),
        ]}
        selectedVersion="0002"
        onSelect={onSelect}
      />,
    );
    const list = screen.getByTestId("migrations-timeline");
    list.focus();
    fireEvent.keyDown(list, { key: "ArrowDown" });
    expect(onSelect).toHaveBeenLastCalledWith("0003");
    fireEvent.keyDown(list, { key: "ArrowUp" });
    expect(onSelect).toHaveBeenLastCalledWith("0001");
  });
});

describe("Timeline file-missing rendering ()", () => {
  it("renders red 🚫 + 'file missing' badge for applied row whose .up.sql was deleted", () => {
    render(
      <Timeline
        migrations={[
          migration({
            version: "0007",
            status: "applied",
            parseError: "file missing",
            appliedAt: "2026-04-12T14:22:00Z",
            durationMs: 50,
          }),
        ]}
        selectedVersion={null}
        onSelect={() => {}}
      />,
    );
    const row = screen.getByTestId("migration-row-0007");
    // Glyph cell holds 🚫 (not the green ✔).
    expect(row.textContent).toContain("🚫");
    // Badge cell shows 'File missing' instead of 'applied'.
    const badge = screen.getByTestId("migration-row-0007-badge");
    expect(badge).toHaveAttribute("data-file-missing", "true");
    expect(badge.textContent?.toLowerCase()).toContain("file missing");
    // Tooltip on the row reflects the same condition.
    expect(row.getAttribute("title") ?? "").toContain("File missing");
  });
});

describe("Timeline lint badge (S22)", () => {
  beforeEach(() => useLintStore.setState(useLintStore.getInitialState()));

  it("renders ⚠ N badge when findings present", () => {
    useLintStore.getState().setFindings("0001", [
      { rule: "a", severity: "warning", file: "f", line: 1, column: 1, message: "" },
      { rule: "b", severity: "warning", file: "f", line: 2, column: 1, message: "" },
    ]);
    render(
      <Timeline
        migrations={[migration({ version: "0001" })]}
        selectedVersion={null}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByTestId("squawk-badge-0001")).toHaveTextContent("⚠ 2");
  });

  it("hover tooltip lists rule names", () => {
    useLintStore.getState().setFindings("0001", [
      {
        rule: "prefer-text-field",
        severity: "warning",
        file: "f",
        line: 1,
        column: 1,
        message: "",
      },
    ]);
    render(
      <Timeline
        migrations={[migration({ version: "0001" })]}
        selectedVersion={null}
        onSelect={() => {}}
      />,
    );
    const badge = screen.getByTestId("squawk-badge-0001");
    expect(badge.title).toContain("prefer-text-field");
  });

  it("absent when 0 findings", () => {
    render(
      <Timeline
        migrations={[migration({ version: "0001" })]}
        selectedVersion={null}
        onSelect={() => {}}
      />,
    );
    expect(screen.queryByTestId("squawk-badge-0001")).not.toBeInTheDocument();
  });
});
