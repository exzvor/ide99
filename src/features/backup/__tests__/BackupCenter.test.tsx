/**
 * — BackupCenter renders four-section nav and switches subviews.
 */

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
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

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(async () => null),
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

import type { BackupTab } from "../../editor/store";
import { BackupCenter } from "../BackupCenter";
import { __resetBackupListenerForTests, useBackup } from "../store";

const initial = useBackup.getState();
beforeEach(() => {
  invokeMock.mockReset();
  listenerBuckets.clear();
  __resetBackupListenerForTests();
  useBackup.setState({ ...initial, jobs: {}, schedules: [], loaded: true });
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === "list_connections") return Promise.resolve([]);
    if (cmd === "schema_list_schemas") return Promise.resolve([]);
    if (cmd === "schedule_list") return Promise.resolve([]);
    return Promise.resolve(null);
  });
});

afterEach(() => vi.clearAllMocks());

const tab: BackupTab = {
  id: "backup-c1",
  kind: "backup",
  connectionId: "c1",
  createdAt: new Date().toISOString(),
};

describe("BackupCenter", () => {
  it("renders all four navigation sections", () => {
    render(<BackupCenter tab={tab} />);
    expect(screen.getByTestId("backup-section-backup")).toBeInTheDocument();
    expect(screen.getByTestId("backup-section-restore")).toBeInTheDocument();
    expect(screen.getByTestId("backup-section-basebackup")).toBeInTheDocument();
    expect(screen.getByTestId("backup-section-schedule")).toBeInTheDocument();
  });

  it("switching to Restore swaps subview", async () => {
    const user = userEvent.setup();
    render(<BackupCenter tab={tab} />);
    expect(screen.queryByTestId("backup-wizard")).toBeInTheDocument();
    await user.click(screen.getByTestId("backup-section-restore"));
    expect(screen.getByTestId("restore-wizard")).toBeInTheDocument();
    expect(screen.queryByTestId("backup-wizard")).toBeNull();
  });

  it("Base-backup tab renders the BaseBackupWizard", async () => {
    const user = userEvent.setup();
    render(<BackupCenter tab={tab} />);
    await user.click(screen.getByTestId("backup-section-basebackup"));
    expect(screen.getByTestId("basebackup-wizard")).toBeInTheDocument();
  });

  it("Schedule tab renders ScheduleManager", async () => {
    const user = userEvent.setup();
    render(<BackupCenter tab={tab} />);
    await user.click(screen.getByTestId("backup-section-schedule"));
    expect(screen.getByTestId("schedule-manager")).toBeInTheDocument();
  });
});
