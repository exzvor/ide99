/**
 * —
 *
 * ApplyDialog renders three radio modes (Single / Range / All-pending)
 * with a read-only Monaco preview built from concatenated `.up.sql`
 * fragments fetched via `migrations_preview_up`.
 *
 * Mocks:
 * - `@tauri-apps/api/core` — invoke() returns canned `SqlPreview`s.
 * - `@monaco-editor/react` — flat textarea so we can read the
 * concatenated value verbatim.
 * - `react-i18next` — small lookup dict.
 */

import "@testing-library/jest-dom/vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLintStore } from "./squawk/lintStore";
import type { Migration } from "./store";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

type Listener = (event: { payload: unknown }) => void;
const eventListeners = new Map<string, Set<Listener>>();
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (eventName: string, cb: Listener) => {
    let bucket = eventListeners.get(eventName);
    if (!bucket) {
      bucket = new Set();
      eventListeners.set(eventName, bucket);
    }
    bucket.add(cb);
    return () => {
      bucket?.delete(cb);
    };
  }),
}));

const setMarkersMock = vi.fn();
vi.mock("monaco-editor", () => ({
  editor: { setModelMarkers: (...args: unknown[]) => setMarkersMock(...args) },
  Uri: { parse: (s: string) => ({ toString: () => s }) },
}));

const FAKE_DICT: Record<string, string> = {
  "migrations.apply.title": "Apply migrations",
  "migrations.apply.modeSingle": "Single",
  "migrations.apply.modeRange": "Range",
  "migrations.apply.modeAllPending": "All pending",
  "migrations.apply.from": "From",
  "migrations.apply.to": "To",
  "migrations.apply.version": "Version",
  "migrations.apply.rangeError": "Range must be contiguous and contain only pending migrations",
  "migrations.apply.noPending": "No pending migrations to apply",
  "migrations.apply.selectVersion": "Select a version",
  "migrations.apply.previewLoading": "Loading preview…",
  "migrations.apply.previewError": "Failed to load preview: {{error}}",
  "migrations.apply.prodBanner": "Applying {{count}} migrations on production «{{name}}»",
  "migrations.apply.applying": "Applying…",
  "migrations.apply.apply": "Apply {{count}} migration",
  "migrations.apply.apply_other": "Apply {{count}} migrations",
  "migrations.apply.cancel": "Cancel",
  "migrations.apply.pendingCount": "{{count}} pending migration",
  "migrations.apply.pendingCount_other": "{{count}} pending migrations",
  "migrations.dryrun.checkbox": "Dry-run on disposable DB first",
  "migrations.dryrun.running": "Dry-run running…",
  "migrations.dryrun.phase.pulling": "Pulling postgres:17-alpine",
  "migrations.dryrun.phase.starting": "Starting container",
  "migrations.dryrun.phase.seeding": "Seeding ledger",
  "migrations.dryrun.phase.running": "Running migrations",
  "migrations.dryrun.phase.done": "Done",
  "migrations.dryrun.phase.failed": "Failed",
  "migrations.dryrun.succeeded": "Dry-run succeeded in {{ms}}ms",
  "migrations.dryrun.failed": "Dry-run failed at {{version}}",
  "migrations.dryrun.containerStats":
    "Container: pull {{pull}}ms, start {{start}}ms, run {{run}}ms",
  "migrations.dryrun.applyForReal": "Apply for real",
  "migrations.dryrun.close": "Close",
  "migrations.dryrun.findings": "Squawk: {{count}} finding",
  "migrations.dryrun.findings_other": "Squawk: {{count}} findings",
  "migrations.dryrun.errorPrefix": "error:",
  "migrations.dryrun.hintFix": "Fix the migration and re-open Apply",
};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown> & { count?: number }) => {
      let template = FAKE_DICT[key] ?? key;
      if (vars && typeof vars.count === "number" && vars.count !== 1) {
        const otherKey = `${key}_other`;
        template = FAKE_DICT[otherKey] ?? template;
      }
      if (!vars) return template;
      return Object.entries(vars).reduce<string>(
        (acc, [k, v]) => acc.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), String(v)),
        template,
      );
    },
  }),
}));

vi.mock("@monaco-editor/react", () => ({
  Editor: (props: {
    value?: string;
    onMount?: (
      editor: { getModel: () => { id: string } },
      monaco: { editor: { setModelMarkers: (...a: unknown[]) => void } },
    ) => void;
  }) => {
    // Invoke onMount synchronously on first render so the dialog's
    // marker-application code path runs.
    if (props.onMount) {
      const fakeModel = { id: "model-1" };
      const fakeEditor = { getModel: () => fakeModel };
      const fakeMonaco = {
        editor: { setModelMarkers: (...a: unknown[]) => setMarkersMock(...a) },
      };
      props.onMount(fakeEditor, fakeMonaco);
    }
    return <textarea data-testid="apply-monaco-mock" readOnly value={props.value ?? ""} />;
  },
}));

import { ApplyDialog } from "./ApplyDialog";

function migration(overrides: Partial<Migration> = {}): Migration {
  return {
    version: "0001",
    name: "create_users",
    upPath: "/m/0001.up.sql",
    downPath: "/m/0001.down.sql",
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

const PENDING_LIST: Migration[] = [
  migration({ version: "0001", status: "applied" }),
  migration({ version: "0002", status: "pending", name: "add_email" }),
  migration({ version: "0003", status: "pending", name: "add_index" }),
  migration({ version: "0004", status: "pending", name: "add_posts" }),
];

beforeEach(() => {
  invokeMock.mockReset();
  setMarkersMock.mockReset();
  eventListeners.clear();
  localStorage.clear();
  useLintStore.setState(useLintStore.getInitialState());
  invokeMock.mockImplementation(async (cmd: string, args: { version?: string }) => {
    if (cmd === "migrations_preview_up") {
      return { sql: `-- ${args.version} body` };
    }
    if (cmd === "migrations_apply") {
      return { applied: [], failed: null };
    }
    if (cmd === "migrations_dryrun") {
      return {
        success: true,
        containerPullMs: 100,
        containerStartMs: 50,
        steps: [{ version: "0002", status: "ok", durationMs: 10, error: null }],
        totalMs: 200,
        findings: [],
        error: null,
      };
    }
    return null;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ApplyDialog", () => {
  it("radio Single: selecting a version enables Apply", async () => {
    const user = userEvent.setup();
    render(
      <ApplyDialog
        open
        connectionId="c1"
        connectionName="local"
        environment="local"
        migrations={PENDING_LIST}
        onClose={() => {}}
        onApplied={() => {}}
      />,
    );
    await user.click(screen.getByLabelText("Single"));
    const apply = screen.getByTestId("apply-dialog-confirm");
    expect(apply).toBeDisabled();
    const select = screen.getByTestId("apply-dialog-single-version");
    await user.selectOptions(select, "0003");
    expect(apply).not.toBeDisabled();
  });

  it("radio Range: non-contiguous range shows inline error and disables Apply", async () => {
    const user = userEvent.setup();
    const list: Migration[] = [
      migration({ version: "0001", status: "pending" }),
      migration({ version: "0002", status: "applied" }),
      migration({ version: "0003", status: "pending" }),
    ];
    render(
      <ApplyDialog
        open
        connectionId="c1"
        connectionName="local"
        environment="local"
        migrations={list}
        onClose={() => {}}
        onApplied={() => {}}
      />,
    );
    await user.click(screen.getByLabelText("Range"));
    await user.selectOptions(screen.getByTestId("apply-dialog-range-from"), "0001");
    await user.selectOptions(screen.getByTestId("apply-dialog-range-to"), "0003");
    expect(screen.getByTestId("apply-dialog-range-error")).toHaveTextContent(/contiguous/i);
    expect(screen.getByTestId("apply-dialog-confirm")).toBeDisabled();
  });

  it("radio AllPending: shows count of pending migrations", async () => {
    const user = userEvent.setup();
    render(
      <ApplyDialog
        open
        connectionId="c1"
        connectionName="local"
        environment="local"
        migrations={PENDING_LIST}
        onClose={() => {}}
        onApplied={() => {}}
      />,
    );
    await user.click(screen.getByLabelText("All pending"));
    expect(screen.getByTestId("apply-dialog-pending-count").textContent).toMatch(/3/);
  });

  it("displays concatenated .up.sql in read-only Monaco", async () => {
    const user = userEvent.setup();
    render(
      <ApplyDialog
        open
        connectionId="c1"
        connectionName="local"
        environment="local"
        migrations={PENDING_LIST}
        onClose={() => {}}
        onApplied={() => {}}
      />,
    );
    await user.click(screen.getByLabelText("All pending"));
    await waitFor(() => {
      const textarea = screen.getByTestId("apply-monaco-mock") as HTMLTextAreaElement;
      expect(textarea.value).toContain("-- 0002 body");
      expect(textarea.value).toContain("-- 0003 body");
      expect(textarea.value).toContain("-- 0004 body");
    });
  });

  it("on prod connection: shows banner 'Applying N migrations on production' but no typed-confirm", async () => {
    const user = userEvent.setup();
    render(
      <ApplyDialog
        open
        connectionId="c1"
        connectionName="payments"
        environment="prod"
        migrations={PENDING_LIST}
        onClose={() => {}}
        onApplied={() => {}}
      />,
    );
    await user.click(screen.getByLabelText("All pending"));
    expect(screen.getByTestId("apply-dialog-prod-banner")).toHaveTextContent(
      /Applying 3 migrations on production «payments»/,
    );
    expect(screen.queryByLabelText(/Type connection name/i)).not.toBeInTheDocument();
    expect(screen.getByTestId("apply-dialog-confirm")).not.toBeDisabled();
  });
});

describe("ApplyDialog dry-run + lint (S22)", () => {
  it("checkbox initial state is OFF when no localStorage entry", () => {
    render(
      <ApplyDialog
        open
        connectionId="c1"
        connectionName="local"
        environment="local"
        migrations={PENDING_LIST}
        onClose={() => {}}
        onApplied={() => {}}
      />,
    );
    const cb = screen.getByTestId("apply-dialog-dryrun-checkbox") as HTMLInputElement;
    expect(cb.checked).toBe(false);
  });

  it("toggling checkbox persists to localStorage keyed by connId", async () => {
    const user = userEvent.setup();
    render(
      <ApplyDialog
        open
        connectionId="c1"
        connectionName="local"
        environment="local"
        migrations={PENDING_LIST}
        onClose={() => {}}
        onApplied={() => {}}
      />,
    );
    await user.click(screen.getByTestId("apply-dialog-dryrun-checkbox"));
    expect(localStorage.getItem("migrations.dryRun.enabled.c1")).toBe("true");
    await user.click(screen.getByTestId("apply-dialog-dryrun-checkbox"));
    expect(localStorage.getItem("migrations.dryRun.enabled.c1")).toBe("false");
  });

  it("clicking Apply with checkbox ON invokes migrations_dryrun, not migrations_apply", async () => {
    const user = userEvent.setup();
    render(
      <ApplyDialog
        open
        connectionId="c1"
        connectionName="local"
        environment="local"
        migrations={PENDING_LIST}
        onClose={() => {}}
        onApplied={() => {}}
      />,
    );
    await user.click(screen.getByLabelText("All pending"));
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        "migrations_preview_up",
        expect.objectContaining({ version: "0002" }),
      );
    });
    await user.click(screen.getByTestId("apply-dialog-dryrun-checkbox"));
    invokeMock.mockClear();
    await user.click(screen.getByTestId("apply-dialog-confirm"));
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        "migrations_dryrun",
        expect.objectContaining({ connId: "c1" }),
      );
    });
    expect(invokeMock).not.toHaveBeenCalledWith("migrations_apply", expect.anything());
  });

  it("dryrun success → Apply-for-real button rendered", async () => {
    const user = userEvent.setup();
    render(
      <ApplyDialog
        open
        connectionId="c1"
        connectionName="local"
        environment="local"
        migrations={PENDING_LIST}
        onClose={() => {}}
        onApplied={() => {}}
      />,
    );
    await user.click(screen.getByLabelText("All pending"));
    await user.click(screen.getByTestId("apply-dialog-dryrun-checkbox"));
    await user.click(screen.getByTestId("apply-dialog-confirm"));
    await waitFor(() => {
      expect(screen.getByTestId("apply-dialog-dryrun-apply-for-real")).toBeInTheDocument();
    });
  });

  it("dryrun failure → Apply-for-real button NOT rendered", async () => {
    invokeMock.mockImplementation(async (cmd: string, args: { version?: string }) => {
      if (cmd === "migrations_preview_up") {
        return { sql: `-- ${args.version} body` };
      }
      if (cmd === "migrations_dryrun") {
        return {
          success: false,
          containerPullMs: 100,
          containerStartMs: 50,
          steps: [{ version: "0002", status: "failed", durationMs: 10, error: "syntax" }],
          totalMs: 200,
          findings: [],
          error: { kind: "migrationFailed", message: "0002: syntax error" },
        };
      }
      return null;
    });
    const user = userEvent.setup();
    render(
      <ApplyDialog
        open
        connectionId="c1"
        connectionName="local"
        environment="local"
        migrations={PENDING_LIST}
        onClose={() => {}}
        onApplied={() => {}}
      />,
    );
    await user.click(screen.getByLabelText("All pending"));
    await user.click(screen.getByTestId("apply-dialog-dryrun-checkbox"));
    await user.click(screen.getByTestId("apply-dialog-confirm"));
    await waitFor(() => {
      expect(screen.getByTestId("apply-dialog-dryrun-results")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("apply-dialog-dryrun-apply-for-real")).not.toBeInTheDocument();
  });

  it("Squawk findings populate Monaco markers via findingsToMonacoMarkers", async () => {
    useLintStore.getState().setFindings("0002", [
      {
        rule: "prefer-text-field",
        severity: "warning",
        file: "0002",
        line: 1,
        column: 1,
        message: "Use text",
      },
    ]);
    const user = userEvent.setup();
    render(
      <ApplyDialog
        open
        connectionId="c1"
        connectionName="local"
        environment="local"
        migrations={PENDING_LIST}
        onClose={() => {}}
        onApplied={() => {}}
      />,
    );
    await user.click(screen.getByLabelText("All pending"));
    // Markers application happens in a useEffect after the preview resolves.
    await waitFor(() => {
      expect(setMarkersMock).toHaveBeenCalled();
    });
    // The third arg is the marker array; assert at least one is a warning.
    const calls = setMarkersMock.mock.calls;
    const lastCall = calls[calls.length - 1] as unknown[];
    const markers = lastCall[2] as { severity: number }[];
    expect(markers.length).toBeGreaterThan(0);
    expect(markers[0].severity).toBe(4);
    // Reference act() so the import is used (silences lint when present
    // but unused in current asserts).
    void act;
  });
});
