/**
 * — BackupWizard form fields, live preview, run dispatch, and
 * progress event integration.
 */

import "@testing-library/jest-dom/vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

type Listener = (event: { payload: unknown }) => void;
const listenerBuckets = new Map<string, Set<Listener>>();
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (eventName: string, cb: Listener) => {
    let bucket = listenerBuckets.get(eventName);
    if (!bucket) {
      bucket = new Set();
      listenerBuckets.set(eventName, bucket);
    }
    bucket.add(cb);
    return () => {
      bucket?.delete(cb);
    };
  }),
}));

const saveDialogMock = vi.fn();
const openDialogMock = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: (...args: unknown[]) => saveDialogMock(...args),
  open: (...args: unknown[]) => openDialogMock(...args),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => {
      if (!vars) return key;
      return Object.entries(vars).reduce<string>(
        (acc, [k, v]) => acc.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), String(v)),
        key,
      );
    },
  }),
}));

import { BackupWizard } from "../BackupWizard";
import { __resetBackupListenerForTests, useBackup } from "../store";

const initial = useBackup.getState();
beforeEach(() => {
  invokeMock.mockReset();
  saveDialogMock.mockReset();
  openDialogMock.mockReset();
  listenerBuckets.clear();
  __resetBackupListenerForTests();
  useBackup.setState({ ...initial, jobs: {}, schedules: [] });
  // Default invoke handler routes by command.
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === "list_connections") {
      return Promise.resolve([
        {
          id: "c1",
          name: "Local PG",
          host: "localhost",
          port: 5432,
          database: "postgres",
        },
      ]);
    }
    if (cmd === "schema_list_schemas") {
      return Promise.resolve([{ name: "public" }, { name: "audit" }]);
    }
    if (cmd === "schema_list_tables") {
      return Promise.resolve([{ name: "users", schema: "public" }]);
    }
    if (cmd === "backup_preview_command") {
      return Promise.resolve(["-Fc", "-Z5", "-f", "/tmp/x.dump"]);
    }
    if (cmd === "backup_run") return Promise.resolve();
    if (cmd === "backup_cancel") return Promise.resolve();
    return Promise.resolve(null);
  });
});

afterEach(() => vi.clearAllMocks());

function emitProgress(payload: unknown): void {
  const bucket = listenerBuckets.get("backup:progress");
  if (!bucket) return;
  for (const cb of bucket) cb({ payload });
}

describe("BackupWizard", () => {
  it("renders connection display once list_connections resolves", async () => {
    render(<BackupWizard connectionId="c1" />);
    await waitFor(() => {
      expect(screen.getByText("Local PG")).toBeInTheDocument();
    });
    expect(screen.getByText(/localhost:5432/)).toBeInTheDocument();
  });

  it("does NOT request preview while output path is empty", async () => {
    render(<BackupWizard connectionId="c1" />);
    await waitFor(() => screen.getByTestId("bk-format"));
    // Allow effects to settle.
    await new Promise((r) => setTimeout(r, 0));
    const previewCalls = invokeMock.mock.calls.filter((c) => c[0] === "backup_preview_command");
    expect(previewCalls.length).toBe(0);
  });

  it("re-requests preview when output path changes and renders the command", async () => {
    const user = userEvent.setup();
    render(<BackupWizard connectionId="c1" />);
    await waitFor(() => screen.getByTestId("bk-output-path"));
    const out = screen.getByTestId("bk-output-path");
    await user.type(out, "/tmp/x.dump");
    await waitFor(() => {
      expect(screen.getByTestId("backup-preview-cmd")).toHaveTextContent(/pg_dump.*-Fc/);
    });
    const previewCalls = invokeMock.mock.calls.filter((c) => c[0] === "backup_preview_command");
    expect(previewCalls.length).toBeGreaterThan(0);
  });

  it("changing format updates the opts payload sent to preview", async () => {
    const user = userEvent.setup();
    render(<BackupWizard connectionId="c1" />);
    await waitFor(() => screen.getByTestId("bk-output-path"));
    await user.type(screen.getByTestId("bk-output-path"), "/tmp/x.dump");
    await user.selectOptions(screen.getByTestId("bk-format"), "directory");
    await waitFor(() => {
      const last = invokeMock.mock.calls.filter((c) => c[0] === "backup_preview_command").at(-1);
      expect(last?.[1]).toMatchObject({ opts: { format: "directory" } });
    });
  });

  it("Run button is disabled until output path is provided", async () => {
    const user = userEvent.setup();
    render(<BackupWizard connectionId="c1" />);
    await waitFor(() => screen.getByTestId("backup-run"));
    expect(screen.getByTestId("backup-run")).toBeDisabled();
    await user.type(screen.getByTestId("bk-output-path"), "/tmp/x.dump");
    await waitFor(() => expect(screen.getByTestId("backup-run")).toBeEnabled());
  });

  it("clicking Run dispatches backup_run with current opts and a stable jobId", async () => {
    const user = userEvent.setup();
    render(<BackupWizard connectionId="c1" />);
    await waitFor(() => screen.getByTestId("bk-output-path"));
    await user.type(screen.getByTestId("bk-output-path"), "/tmp/x.dump");
    await waitFor(() => expect(screen.getByTestId("backup-run")).toBeEnabled());
    await user.click(screen.getByTestId("backup-run"));
    await waitFor(() => {
      const calls = invokeMock.mock.calls.filter((c) => c[0] === "backup_run");
      expect(calls.length).toBe(1);
      expect(calls[0]?.[1]).toMatchObject({
        opts: { connectionId: "c1", outputPath: "/tmp/x.dump" },
      });
      expect(typeof (calls[0]?.[1] as { jobId: string }).jobId).toBe("string");
    });
  });

  it("renders progress card on phase event and success card on done(true)", async () => {
    const user = userEvent.setup();
    render(<BackupWizard connectionId="c1" />);
    await waitFor(() => screen.getByTestId("bk-output-path"));
    await user.type(screen.getByTestId("bk-output-path"), "/tmp/x.dump");
    await user.click(screen.getByTestId("backup-run"));
    // jobId set on runBackup — read from store.
    const runCall = await waitFor(() => {
      const calls = invokeMock.mock.calls.filter((c) => c[0] === "backup_run");
      expect(calls.length).toBe(1);
      return calls[0];
    });
    const jobId = (runCall?.[1] as { jobId: string }).jobId;
    act(() => {
      emitProgress({ kind: "phase", jobId, phase: "dumping", detail: "public.users" });
    });
    await waitFor(() => {
      expect(screen.getByTestId("backup-progress-card")).toHaveTextContent(/dumping/);
    });
    act(() => {
      emitProgress({ kind: "percent", jobId, value: 73 });
    });
    await waitFor(() => {
      expect(screen.getByTestId("backup-progress-bar")).toHaveStyle({ width: "73%" });
    });
    act(() => {
      emitProgress({ kind: "done", jobId, success: true, stderrTail: "", exitCode: 0 });
    });
    await waitFor(() => {
      expect(screen.getByTestId("backup-progress-card")).toHaveTextContent(
        /backup\.run\.success|run\.success/,
      );
    });
  });

  it("Browse button calls saveDialog and applies the chosen path", async () => {
    saveDialogMock.mockResolvedValueOnce("/picked/from/dialog.dump");
    const user = userEvent.setup();
    render(<BackupWizard connectionId="c1" />);
    await waitFor(() => screen.getByTestId("bk-browse"));
    await user.click(screen.getByTestId("bk-browse"));
    await waitFor(() => {
      expect((screen.getByTestId("bk-output-path") as HTMLInputElement).value).toBe(
        "/picked/from/dialog.dump",
      );
    });
  });
});
