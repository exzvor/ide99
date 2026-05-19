/**
 * — RestoreWizard form, destructive-confirm gate, run dispatch.
 */

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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
const saveDialogMock = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...args: unknown[]) => openDialogMock(...args),
  save: (...args: unknown[]) => saveDialogMock(...args),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => {
      if (!vars) return key;
      return Object.entries(vars).reduce<string>(        (acc, [k, v]) => acc.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), String(v)),
        key,
);
    },
  }),
}));

import { RestoreWizard } from "../RestoreWizard";
import { __resetBackupListenerForTests, useBackup } from "../store";

beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {};
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {};
  }
});

const initial = useBackup.getState();
beforeEach(() => {
  invokeMock.mockReset();
  openDialogMock.mockReset();
  saveDialogMock.mockReset();
  listenerBuckets.clear();
  __resetBackupListenerForTests();
  useBackup.setState({ ...initial, jobs: {} });
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === "list_connections") {
      return Promise.resolve([
        { id: "c1", name: "Local", host: "h", port: 5432, database: "postgres" },
      ]);
    }
    if (cmd === "restore_preview_command") {
      return Promise.resolve(["-d", "postgres", "/tmp/x.dump"]);
    }
    if (cmd === "restore_run") return Promise.resolve();
    return Promise.resolve(null);
  });
});

afterEach(() => vi.clearAllMocks());

describe("RestoreWizard", () => {
  it("Run is disabled until a source path is provided", async () => {
    const user = userEvent.setup();
    render(<RestoreWizard connectionId="c1" />);
    await waitFor(() => screen.getByTestId("restore-source-path"));
    expect(screen.getByTestId("restore-run")).toBeDisabled();
    await user.type(screen.getByTestId("restore-source-path"), "/tmp/x.dump");
    await waitFor(() => expect(screen.getByTestId("restore-run")).toBeEnabled());
  });

  it("non-destructive (clean=false) Run dispatches restore_run immediately", async () => {
    const user = userEvent.setup();
    render(<RestoreWizard connectionId="c1" />);
    await waitFor(() => screen.getByTestId("restore-source-path"));
    await user.type(screen.getByTestId("restore-source-path"), "/tmp/x.dump");
    await user.click(screen.getByTestId("restore-run"));
    await waitFor(() => {
      const calls = invokeMock.mock.calls.filter((c) => c[0] === "restore_run");
      expect(calls.length).toBe(1);
    });
  });

  it("destructive (clean=true) opens type-to-confirm gate before running", async () => {
    const user = userEvent.setup();
    render(<RestoreWizard connectionId="c1" />);
    await waitFor(() => screen.getByTestId("restore-source-path"));
    await user.type(screen.getByTestId("restore-source-path"), "/tmp/x.dump");
    await user.click(screen.getByTestId("restore-clean"));
    await user.click(screen.getByTestId("restore-run"));
    await waitFor(() => screen.getByText(/confirm_title/));
    // restore_run NOT yet called.
    const calls = invokeMock.mock.calls.filter((c) => c[0] === "restore_run");
    expect(calls.length).toBe(0);
  });

  it("destructive Run is gated until correct token typed; mismatch keeps button disabled", async () => {
    const user = userEvent.setup();
    render(<RestoreWizard connectionId="c1" />);
    await waitFor(() => screen.getByTestId("restore-source-path"));
    await user.type(screen.getByTestId("restore-source-path"), "/tmp/x.dump");
    await user.click(screen.getByTestId("restore-clean"));
    await user.click(screen.getByTestId("restore-run"));
    await waitFor(() => screen.getByText(/confirm_title/));
    const input = screen.getByLabelText(/confirm_input_label/);
    fireEvent.change(input, { target: { value: "WRONG" } });
    const apply = screen.getByRole("button", { name: /confirm_apply/ });
    expect(apply).toBeDisabled();
    fireEvent.change(input, { target: { value: "RESTORE" } });
    expect(apply).not.toBeDisabled();
    await user.click(apply);
    await waitFor(() => {
      const calls = invokeMock.mock.calls.filter((c) => c[0] === "restore_run");
      expect(calls.length).toBe(1);
    });
  });

  it("Browse button populates source path from open-file dialog", async () => {
    openDialogMock.mockResolvedValueOnce("/picked/from/dialog.dump");
    const user = userEvent.setup();
    render(<RestoreWizard connectionId="c1" />);
    await waitFor(() => screen.getByTestId("restore-browse"));
    await user.click(screen.getByTestId("restore-browse"));
    await waitFor(() => {
      expect((screen.getByTestId("restore-source-path") as HTMLInputElement).value).toBe(        "/picked/from/dialog.dump",
);
    });
  });
});
