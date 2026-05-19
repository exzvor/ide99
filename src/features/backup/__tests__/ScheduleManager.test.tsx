/**
 * — ScheduleManager: list rendering, add/edit drawer, install
 * toggles, run-now dispatch, and cron-line preview.
 */

import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
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
      return Object.entries(vars).reduce<string>(        (acc, [k, v]) => acc.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), String(v)),
        key,
);
    },
  }),
}));

import { ScheduleManager } from "../ScheduleManager";
import { __resetBackupListenerForTests, useBackup } from "../store";

const initial = useBackup.getState();
beforeEach(() => {
  invokeMock.mockReset();
  listenerBuckets.clear();
  __resetBackupListenerForTests();
  useBackup.setState({ ...initial, jobs: {}, schedules: [], loaded: true });
  invokeMock.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
    if (cmd === "schema_list_schemas") return Promise.resolve([]);
    if (cmd === "schema_list_tables") return Promise.resolve([]);
    if (cmd === "schedule_upsert") {
      return Promise.resolve({
        id: (args as { id: string }).id,
        label: (args as { label: string }).label,
        cron: (args as { cron: string }).cron,
        backup: (args as { backup: unknown }).backup,
        createdAt: new Date().toISOString(),
        installed: false,
      });
    }
    if (cmd === "schedule_remove") return Promise.resolve();
    if (cmd === "schedule_install") return Promise.resolve();
    if (cmd === "schedule_uninstall") return Promise.resolve();
    if (cmd === "schedule_run_now") return Promise.resolve("job-abc");
    if (cmd === "schedule_preview_cron_line") return Promise.resolve("0 3 * * * /usr/bin/pg_dump");
    return Promise.resolve(null);
  });
});

afterEach(() => vi.clearAllMocks());

describe("ScheduleManager", () => {
  it("renders empty state when there are no schedules", () => {
    render(<ScheduleManager connectionId="c1" />);
    expect(screen.getByText("backup.schedule.empty")).toBeInTheDocument();
  });

  it("lists existing schedules with installed badge when applicable", () => {
    useBackup.setState({
      schedules: [
        {
          id: "s1",
          label: "Nightly",
          cron: "0 3 * * *",
          backup: {
            connectionId: "c1",
            format: "custom",
            scope: "both",
            outputPath: "/tmp/n.dump",
            compressLevel: 5,
          },
          createdAt: new Date().toISOString(),
          installed: true,
        },
      ],
    });
    render(<ScheduleManager connectionId="c1" />);
    const row = screen.getByTestId("schedule-row-s1");
    expect(within(row).getByText("Nightly")).toBeInTheDocument();
    expect(screen.getByTestId("schedule-installed-s1")).toBeInTheDocument();
    expect(screen.getByTestId("schedule-uninstall-s1")).toBeInTheDocument();
  });

  it("opens drawer and saves a new schedule via schedule_upsert", async () => {
    const user = userEvent.setup();
    render(<ScheduleManager connectionId="c1" />);
    await user.click(screen.getByTestId("schedule-add-open"));
    await waitFor(() => screen.getByTestId("schedule-drawer"));
    await user.type(screen.getByTestId("schedule-label"), "Nightly");
    await user.type(screen.getByTestId("sched-output-path"), "/tmp/n.dump");
    await user.click(screen.getByTestId("schedule-save"));
    await waitFor(() => {
      const calls = invokeMock.mock.calls.filter((c) => c[0] === "schedule_upsert");
      expect(calls.length).toBe(1);
      expect(calls[0]?.[1]).toMatchObject({ label: "Nightly", cron: "0 3 * * *" });
    });
  });

  it("removes a schedule via schedule_remove", async () => {
    useBackup.setState({
      schedules: [
        {
          id: "s1",
          label: "Nightly",
          cron: "0 3 * * *",
          backup: {
            connectionId: "c1",
            format: "custom",
            scope: "both",
            outputPath: "/tmp/n.dump",
            compressLevel: 5,
          },
          createdAt: new Date().toISOString(),
        },
      ],
    });
    const user = userEvent.setup();
    render(<ScheduleManager connectionId="c1" />);
    await user.click(screen.getByTestId("schedule-remove-s1"));
    await waitFor(() => {
      const calls = invokeMock.mock.calls.filter((c) => c[0] === "schedule_remove");
      expect(calls.length).toBe(1);
    });
  });

  it("install button calls schedule_install and uninstall flips when state updates", async () => {
    useBackup.setState({
      schedules: [
        {
          id: "s1",
          label: "Nightly",
          cron: "0 3 * * *",
          backup: {
            connectionId: "c1",
            format: "custom",
            scope: "both",
            outputPath: "/tmp/n.dump",
            compressLevel: 5,
          },
          createdAt: new Date().toISOString(),
          installed: false,
        },
      ],
    });
    const user = userEvent.setup();
    render(<ScheduleManager connectionId="c1" />);
    expect(screen.getByTestId("schedule-install-s1")).toBeInTheDocument();
    await user.click(screen.getByTestId("schedule-install-s1"));
    await waitFor(() => {
      expect(invokeMock.mock.calls.filter((c) => c[0] === "schedule_install").length).toBe(1);
    });
    // After successful install, the state flips to installed=true → uninstall btn appears.
    await waitFor(() => {
      expect(screen.getByTestId("schedule-uninstall-s1")).toBeInTheDocument();
    });
  });

  it("Run-now dispatches schedule_run_now and surfaces job result banner", async () => {
    useBackup.setState({
      schedules: [
        {
          id: "s1",
          label: "Nightly",
          cron: "0 3 * * *",
          backup: {
            connectionId: "c1",
            format: "custom",
            scope: "both",
            outputPath: "/tmp/n.dump",
            compressLevel: 5,
          },
          createdAt: new Date().toISOString(),
        },
      ],
    });
    const user = userEvent.setup();
    render(<ScheduleManager connectionId="c1" />);
    await user.click(screen.getByTestId("schedule-run-now-s1"));
    await waitFor(() => {
      const calls = invokeMock.mock.calls.filter((c) => c[0] === "schedule_run_now");
      expect(calls.length).toBe(1);
    });
    await waitFor(() => {
      expect(screen.getByTestId("schedule-run-result")).toBeInTheDocument();
    });
  });

  it("Preview-cron button renders the resolved cron line", async () => {
    const user = userEvent.setup();
    render(<ScheduleManager connectionId="c1" />);
    await user.click(screen.getByTestId("schedule-add-open"));
    await waitFor(() => screen.getByTestId("schedule-drawer"));
    await user.click(screen.getByTestId("schedule-preview-cron"));
    await waitFor(() => {
      expect(screen.getByTestId("schedule-cron-preview")).toHaveTextContent(/pg_dump/);
    });
  });
});
