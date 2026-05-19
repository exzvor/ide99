/**
 * — BaseBackupWizard. Verifies output-dir + compression + the
 * incremental-from-manifest required gate.
 */

import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
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

const openDialogMock = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...args: unknown[]) => openDialogMock(...args),
  save: vi.fn(async () => null),
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

import { BaseBackupWizard } from "../BaseBackupWizard";
import { __resetBackupListenerForTests, useBackup } from "../store";

const initial = useBackup.getState();
beforeEach(() => {
  invokeMock.mockReset();
  openDialogMock.mockReset();
  listenerBuckets.clear();
  __resetBackupListenerForTests();
  useBackup.setState({ ...initial, jobs: {} });
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === "list_connections") {
      return Promise.resolve([
        { id: "c1", name: "Local", host: "h", port: 5432, database: "postgres" },
      ]);
    }
    if (cmd === "basebackup_preview_command") {
      return Promise.resolve(["-D", "/var/backups/base", "--compress=zstd"]);
    }
    if (cmd === "basebackup_run") return Promise.resolve();
    return Promise.resolve(null);
  });
});

afterEach(() => vi.clearAllMocks());

describe("BaseBackupWizard", () => {
  it("Run is disabled until output dir is provided", async () => {
    render(<BaseBackupWizard connectionId="c1" />);
    await waitFor(() => screen.getByTestId("basebackup-output-dir"));
    expect(screen.getByTestId("basebackup-run")).toBeDisabled();
  });

  it("toggling 'incremental' makes the manifest input required", async () => {
    const user = userEvent.setup();
    render(<BaseBackupWizard connectionId="c1" />);
    await waitFor(() => screen.getByTestId("basebackup-output-dir"));
    await user.type(screen.getByTestId("basebackup-output-dir"), "/var/backups/base");
    await waitFor(() => expect(screen.getByTestId("basebackup-run")).toBeEnabled());
    await user.click(screen.getByTestId("basebackup-incremental-toggle"));
    // manifest input now visible and required
    const manifest = screen.getByTestId("basebackup-manifest");
    expect(manifest).toHaveAttribute("required");
    expect(manifest).toHaveAttribute("aria-required", "true");
    // Run disabled while manifest empty
    expect(screen.getByTestId("basebackup-run")).toBeDisabled();
    // Provide a manifest, Run flips back to enabled
    await user.type(manifest, "/var/backups/base/backup_manifest");
    await waitFor(() => expect(screen.getByTestId("basebackup-run")).toBeEnabled());
  });

  it("compression dropdown updates the preview payload", async () => {
    const user = userEvent.setup();
    render(<BaseBackupWizard connectionId="c1" />);
    await waitFor(() => screen.getByTestId("basebackup-output-dir"));
    await user.type(screen.getByTestId("basebackup-output-dir"), "/var/backups/base");
    await user.selectOptions(screen.getByTestId("basebackup-compression"), "zstd");
    await waitFor(() => {
      const last = invokeMock.mock.calls
        .filter((c) => c[0] === "basebackup_preview_command")
        .at(-1);
      expect(last?.[1]).toMatchObject({ opts: { compression: "zstd" } });
    });
  });

  it("clicking Run dispatches basebackup_run with current opts", async () => {
    const user = userEvent.setup();
    render(<BaseBackupWizard connectionId="c1" />);
    await waitFor(() => screen.getByTestId("basebackup-output-dir"));
    await user.type(screen.getByTestId("basebackup-output-dir"), "/var/backups/base");
    await waitFor(() => expect(screen.getByTestId("basebackup-run")).toBeEnabled());
    await user.click(screen.getByTestId("basebackup-run"));
    await waitFor(() => {
      const calls = invokeMock.mock.calls.filter((c) => c[0] === "basebackup_run");
      expect(calls.length).toBe(1);
      expect(calls[0]?.[1]).toMatchObject({
        opts: { connectionId: "c1", outputDir: "/var/backups/base" },
      });
    });
  });

  it("Browse dir uses an open-directory dialog and applies the picked path", async () => {
    openDialogMock.mockResolvedValueOnce("/picked/dir");
    const user = userEvent.setup();
    render(<BaseBackupWizard connectionId="c1" />);
    await waitFor(() => screen.getByTestId("basebackup-browse-dir"));
    await user.click(screen.getByTestId("basebackup-browse-dir"));
    await waitFor(() => {
      expect((screen.getByTestId("basebackup-output-dir") as HTMLInputElement).value).toBe(
        "/picked/dir",
      );
    });
    // Verify the dialog was called with directory:true
    expect(openDialogMock).toHaveBeenCalledWith(expect.objectContaining({ directory: true }));
  });
});
