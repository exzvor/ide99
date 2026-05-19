/**
 * — 
 *
 * DiffViewer renders the unified diff returned by `migrations_diff_snapshots`
 * in a read-only Monaco editor with `language="diff"`. Two version
 * dropdowns gate the IPC call — only versions where `hasSnapshot=true`
 * are selectable. When the unified diff is empty, the panel shows a
 * "No changes" placeholder instead of the editor.
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
  "migrations.diff.title": "Schema diff",
  "migrations.diff.from": "From",
  "migrations.diff.to": "To",
  "migrations.diff.noSnapshots": "No snapshots stored",
  "migrations.diff.loading": "Loading diff…",
  "migrations.diff.error": "Failed: {{error}}",
  "migrations.diff.noChanges": "No changes between snapshots",
  "migrations.diff.selectBoth": "Select two versions to compare",
};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => {
      const template = FAKE_DICT[key] ?? key;
      if (!vars) return template;
      return Object.entries(vars).reduce<string>(        (acc, [k, v]) => acc.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), String(v)),
        template,
);
    },
  }),
}));

vi.mock("@monaco-editor/react", () => ({
  Editor: (props: { value?: string; defaultLanguage?: string }) => (    <textarea
      data-testid="diff-monaco-mock"
      data-language={props.defaultLanguage}
      readOnly
      value={props.value ?? ""}
    />
),
}));

import { DiffViewer } from "./DiffViewer";

function migration(overrides: Partial<Migration> = {}): Migration {
  return {
    version: "0001",
    name: "create_users",
    upPath: "/m/0001.up.sql",
    downPath: "/m/0001.down.sql",
    status: "applied",
    appliedAt: "2026-04-12",
    appliedBy: "alice",
    durationMs: 100,
    diskChecksum: "abc",
    appliedChecksum: "abc",
    hasSnapshot: true,
    parseError: null,
    ...overrides,
  };
}

beforeEach(() => {
  invokeMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DiffViewer", () => {
  it("renders Monaco with the unified diff returned by migrations_diff_snapshots", async () => {
    const user = userEvent.setup();
    invokeMock.mockResolvedValue({
      unifiedDiff: "--- 0001\n+++ 0002\n@@ -1 +1,2 @@\n test\n+new\n",
    });
    render(      <DiffViewer
        connectionId="c1"
        migrations={[migration({ version: "0001" }), migration({ version: "0002" })]}
      />,
);
    await user.selectOptions(screen.getByTestId("diff-from-select"), "0001");
    await user.selectOptions(screen.getByTestId("diff-to-select"), "0002");
    await waitFor(() => {
      const ta = screen.getByTestId("diff-monaco-mock") as HTMLTextAreaElement;
      expect(ta.value).toContain("+new");
      expect(ta.dataset.language).toBe("diff");
    });
    expect(invokeMock).toHaveBeenCalledWith("migrations_diff_snapshots", {
      connId: "c1",
      fromVersion: "0001",
      toVersion: "0002",
    });
  });

  it("shows 'No changes' placeholder when unifiedDiff is empty string", async () => {
    const user = userEvent.setup();
    invokeMock.mockResolvedValue({ unifiedDiff: "" });
    render(      <DiffViewer
        connectionId="c1"
        migrations={[migration({ version: "0001" }), migration({ version: "0002" })]}
      />,
);
    await user.selectOptions(screen.getByTestId("diff-from-select"), "0001");
    await user.selectOptions(screen.getByTestId("diff-to-select"), "0002");
    await waitFor(() => {
      expect(screen.getByTestId("diff-no-changes")).toHaveTextContent(        "No changes between snapshots",
);
    });
  });
});
