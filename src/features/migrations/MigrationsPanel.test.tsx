/**
 * — 
 *
 * MigrationsPanel is the top-level container glueing the directory
 * selector, the option toggles, the toolbar, and the timeline. It also
 * subscribes to three Tauri events:
 *
 * - migrations:dir-changed         → re-fetch list
 * - migrations:apply-progress      → toast / inline progress
 * - migrations:rollback-progress   → toast / inline progress
 *
 * The three tests below exercise the mount-time fetch, the dir-changed
 * subscription, and the layout composition.
 */

import "@testing-library/jest-dom/vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Connection } from "../../lib/tauri";
import { useMigrationsStore } from "./store";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

type Listener = (event: { payload: unknown }) => void;
const listeners = new Map<string, Set<Listener>>();
const unlistenSpy = vi.fn();

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (eventName: string, cb: Listener) => {
    let bucket = listeners.get(eventName);
    if (!bucket) {
      bucket = new Set();
      listeners.set(eventName, bucket);
    }
    bucket.add(cb);
    return () => {
      bucket?.delete(cb);
      unlistenSpy();
    };
  }),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

vi.mock("@monaco-editor/react", () => ({
  Editor: () => <div data-testid="monaco-stub" />,
}));

const FAKE_DICT: Record<string, string> = {
  "migrations.panel.title": "Migrations",
  "migrations.panel.directory": "Directory",
  "migrations.panel.directoryNotSet": "Not set",
  "migrations.panel.change": "Change…",
  "migrations.panel.clear": "Clear",
  "migrations.panel.trackingTable": "Create tracking table",
  "migrations.panel.snapshots": "Capture schema snapshots",
  "migrations.panel.trackingMissing": "Tracking missing",
  "migrations.toolbar.applyAll": "Apply All Pending",
  "migrations.toolbar.applySingle": "Apply Single",
  "migrations.toolbar.applyRange": "Apply Range",
  "migrations.toolbar.rollback": "Rollback",
  "migrations.toolbar.diff": "Diff…",
  "migrations.timeline.summary": "{{applied}} applied · {{pending}} pending · {{dirty}} dirty",
  "migrations.timeline.empty": "no rows",
  "migrations.timeline.applied": "applied",
  "migrations.timeline.pending": "pending",
  "migrations.timeline.dirty": "dirty",
  "migrations.selector.openDialog": "Pick migrations directory",
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

// Minimal connections store stub.
const baseConnection: Connection = {
  id: "c1",
  name: "local",
  host: "localhost",
  port: 5432,
  database: "postgres",
  username: "postgres",
  sslMode: "prefer",
  hasPassword: true,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  lastTestedAt: null,
  lastTestOk: null,
  excludeFromHistory: false,
  excludeFromRecentPlans: false,
  environment: "local",
  readOnly: false,
  slowQueryWarning: false,
  confirmDestructive: false,
};

vi.mock("../connections/store", () => ({
  useConnections: Object.assign(    (selector: (s: { connections: Connection[] }) => unknown) =>
      selector({ connections: [baseConnection] }),
    {
      getState: () => ({ connections: [baseConnection] }),
    },
),
}));

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

import { MigrationsPanel } from "./MigrationsPanel";

beforeEach(() => {
  invokeMock.mockReset();
  unlistenSpy.mockReset();
  listeners.clear();
  invokeMock.mockImplementation(async (cmd: string) => {
    if (cmd === "migrations_list") {
      return { migrations: [], trackingTableMissing: false };
    }
    if (cmd === "migrations_set_options") return null;
    return null;
  });
  useMigrationsStore.setState({
    migrationsDir: null,
    trackingEnabled: true,
    snapshotsEnabled: false,
    migrations: [],
    selectedVersion: null,
    trackingTableMissing: false,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MigrationsPanel", () => {
  it("on mount: invokes migrations_list for the active connection", async () => {
    render(<MigrationsPanel connectionId="c1" />);
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("migrations_list", { connId: "c1" });
    });
  });

  it("on migrations:dir-changed event: re-runs migrations_list", async () => {
    render(<MigrationsPanel connectionId="c1" />);
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("migrations_list", { connId: "c1" });
    });
    invokeMock.mockClear();
    invokeMock.mockResolvedValue({ migrations: [], trackingTableMissing: false });

    // Wait for listen() to register.
    await waitFor(() => {
      expect(listeners.get("migrations:dir-changed")?.size ?? 0).toBeGreaterThan(0);
    });

    await act(async () => {
      const bucket = listeners.get("migrations:dir-changed");
      if (bucket) {
        for (const cb of bucket) cb({ payload: { connId: "c1" } });
      }
    });

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("migrations_list", { connId: "c1" });
    });
  });

  it("renders DirectorySelector + Timeline + 4 toolbar buttons", async () => {
    render(<MigrationsPanel connectionId="c1" />);
    await waitFor(() => {
      expect(screen.getByTestId("directory-selector")).toBeInTheDocument();
    });
    expect(screen.getByTestId("migrations-toolbar-apply-all")).toBeInTheDocument();
    expect(screen.getByTestId("migrations-toolbar-apply-single")).toBeInTheDocument();
    expect(screen.getByTestId("migrations-toolbar-apply-range")).toBeInTheDocument();
    expect(screen.getByTestId("migrations-toolbar-rollback")).toBeInTheDocument();
    expect(screen.getByTestId("migrations-toolbar-diff")).toBeInTheDocument();
    // Timeline empty-state is fine; the component renders unconditionally.
    expect(screen.getByTestId("migrations-timeline-empty")).toBeInTheDocument();
  });
});
