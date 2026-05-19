/**
 * —
 *
 * RollbackDialog renders a read-only Monaco preview of `.down.sql`.
 * For non-prod connections the user can hit Rollback directly. For prod
 * the dialog wraps the action behind `TypingConfirmModal` (existing
 * S8 component) — Rollback is enabled only after the user types the
 * connection name.
 *
 * If `downPath === null` the migration cannot be rolled back from disk;
 * the dialog renders a tooltip explaining the cause and disables the
 * action.
 */

import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Migration } from "./store";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

const FAKE_DICT: Record<string, string> = {
  "migrations.rollback.title": "Rollback migration {{version}}",
  "migrations.rollback.noDownFile": "No rollback file (.down.sql missing)",
  "migrations.rollback.previewLoading": "Loading preview…",
  "migrations.rollback.previewError": "Failed: {{error}}",
  "migrations.rollback.prodTitle": "Rollback on production",
  "migrations.rollback.prodDescription":
    "Rolling back «{{version}}» on «{{name}}». Type the connection name.",
  "migrations.rollback.prodInputLabel": "Type connection name",
  "migrations.rollback.rollback": "Rollback",
  "migrations.rollback.rollingBack": "Rolling back…",
  "migrations.rollback.cancel": "Cancel",
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

vi.mock("@monaco-editor/react", () => ({
  Editor: (props: { value?: string }) => (
    <textarea data-testid="rollback-monaco-mock" readOnly value={props.value ?? ""} />
  ),
}));

import { RollbackDialog } from "./RollbackDialog";

function migration(overrides: Partial<Migration> = {}): Migration {
  return {
    version: "0001",
    name: "create_users",
    upPath: "/m/0001.up.sql",
    downPath: "/m/0001.down.sql",
    status: "applied",
    appliedAt: "2026-04-12T14:22:00Z",
    appliedBy: "alice",
    durationMs: 100,
    diskChecksum: "abc",
    appliedChecksum: "abc",
    hasSnapshot: false,
    parseError: null,
    ...overrides,
  };
}

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation(async (cmd: string, args: { version?: string }) => {
    if (cmd === "migrations_preview_down") {
      return { sql: `DROP TABLE for ${args.version};` };
    }
    if (cmd === "migrations_rollback") {
      return { rolledBack: args.version, error: null };
    }
    return null;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("RollbackDialog", () => {
  it("non-prod: shows .down.sql in read-only Monaco; Rollback button enabled", async () => {
    render(
      <RollbackDialog
        open
        connectionId="c1"
        connectionName="local"
        environment="local"
        migration={migration({ version: "0007" })}
        onClose={() => {}}
        onRolledBack={() => {}}
      />,
    );
    await waitFor(() => {
      const ta = screen.getByTestId("rollback-monaco-mock") as HTMLTextAreaElement;
      expect(ta.value).toContain("DROP TABLE for 0007");
    });
    expect(screen.getByTestId("rollback-dialog-confirm")).not.toBeDisabled();
  });

  it("prod: TypingConfirmModal blocks Rollback until connection name typed", async () => {
    const user = userEvent.setup();
    render(
      <RollbackDialog
        open
        connectionId="c1"
        connectionName="payments"
        environment="prod"
        migration={migration({ version: "0007" })}
        onClose={() => {}}
        onRolledBack={() => {}}
      />,
    );
    await user.click(screen.getByTestId("rollback-dialog-confirm"));
    // Typing modal appears; disabled confirm.
    const typingInput = await screen.findByLabelText(/Type connection name/i);
    const typingConfirm = screen.getByTestId("rollback-dialog-typing-confirm");
    expect(typingConfirm).toBeDisabled();
    await user.type(typingInput, "payments");
    expect(typingConfirm).not.toBeDisabled();
  });

  it("missing .down.sql: Rollback disabled with tooltip 'no rollback file'", () => {
    render(
      <RollbackDialog
        open
        connectionId="c1"
        connectionName="local"
        environment="local"
        migration={migration({ version: "0008", downPath: null })}
        onClose={() => {}}
        onRolledBack={() => {}}
      />,
    );
    const button = screen.getByTestId("rollback-dialog-confirm");
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "No rollback file (.down.sql missing)");
  });

  it("on confirm: invokes migrations_rollback Tauri command with version", async () => {
    const user = userEvent.setup();
    const onRolledBack = vi.fn();
    render(
      <RollbackDialog
        open
        connectionId="c1"
        connectionName="local"
        environment="local"
        migration={migration({ version: "0009" })}
        onClose={() => {}}
        onRolledBack={onRolledBack}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("rollback-dialog-confirm")).not.toBeDisabled();
    });
    await user.click(screen.getByTestId("rollback-dialog-confirm"));
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("migrations_rollback", {
        connId: "c1",
        version: "0009",
      });
      expect(onRolledBack).toHaveBeenCalled();
    });
  });
});
