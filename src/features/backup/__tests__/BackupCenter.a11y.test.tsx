/**
 * (a11y) — axe-core regression for BackupCenter.
 *
 * Covers acceptance criterion #5 (high-contrast WCAG check) by running axe
 * with the default rule set against the live DOM tree the four-section
 * navigator renders. Tests are kept narrow: each block exercises one
 * "render shape" of the wizard so a violation gets attributed to a single
 * subview rather than the whole tab.
 */

import "@testing-library/jest-dom/vitest";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, it, vi } from "vitest";

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
    i18n: { language: "en" },
  }),
}));

import { expectNoAxeViolations } from "../../../test/axeHelper";
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

describe("BackupCenter accessibility", () => {
  it("Backup tab has 0 axe violations on initial render", async () => {
    const { container } = render(<BackupCenter tab={tab} />);
    await expectNoAxeViolations(container);
  });

  it("Restore tab has 0 axe violations after switching", async () => {
    const user = userEvent.setup();
    const { container, getByTestId } = render(<BackupCenter tab={tab} />);
    await user.click(getByTestId("backup-section-restore"));
    await expectNoAxeViolations(container);
  });

  it("Schedule tab has 0 axe violations after switching", async () => {
    const user = userEvent.setup();
    const { container, getByTestId } = render(<BackupCenter tab={tab} />);
    await user.click(getByTestId("backup-section-schedule"));
    await expectNoAxeViolations(container);
  });
});
