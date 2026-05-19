/**
 * — integration tests for vibepg slot mount points.
 *
 * EXPLAIN visualizer (InsightsPanel):
 * 1. Mounts the optimize button (visible whether or not insights exist).
 * 2. Click without subscription opens upgrade page.
 * 3. Click with subscription opens the result dialog stub.
 *
 * Migration ApplyDialog:
 * 4. Mounts the migration_review button next to the dry-run checkbox.
 * 5. Click with subscription opens the result dialog stub.
 */

import "@testing-library/jest-dom/vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "../../i18n";
import { usePaidModules } from "./store";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

vi.mock("@monaco-editor/react", () => ({
  Editor: () => <textarea data-testid="apply-monaco-mock" readOnly value="" />,
}));

vi.mock("monaco-editor", () => ({
  editor: { setModelMarkers: vi.fn() },
  Uri: { parse: (s: string) => ({ toString: () => s }) },
}));

import { InsightsPanel } from "../editor/explain/InsightsPanel";
import { ApplyDialog } from "../migrations/ApplyDialog";
import type { Migration } from "../migrations/store";

function setSubscription(vibepgSubscribed: boolean) {
  usePaidModules.setState({
    subscription: {
      spg99Subscribed: false,
      vibepgSubscribed,
      upgradeUrlSpg99: "https://spg99.ru/instant-db",
      upgradeUrlVibepg: "https://vibepg.ai/upgrade",
    },
    loaded: true,
    loading: false,
  });
}

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(undefined);
  usePaidModules.setState({ subscription: null, loaded: false, loading: false });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("vibepg slot — InsightsPanel mount", () => {
  it("mounts the optimize button on the empty insights state", () => {
    setSubscription(false);
    render(<InsightsPanel tabId="t1" plan={[]} onHighlight={() => {}} />);
    expect(screen.getByTestId("vibepg-explain_optimize")).toBeInTheDocument();
  });

  it("clicking the optimize button without subscription opens upgrade", async () => {
    setSubscription(false);
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const user = userEvent.setup();

    render(<InsightsPanel tabId="t1" plan={[]} onHighlight={() => {}} />);
    await user.click(screen.getByTestId("vibepg-explain_optimize"));

    await act(async () => {
      await Promise.resolve();
    });

    expect(openSpy).toHaveBeenCalledWith(      "https://vibepg.ai/upgrade",
      "_blank",
      "noopener,noreferrer",
);
    openSpy.mockRestore();
  });

  it("clicking with subscription opens the result-dialog stub", async () => {
    setSubscription(true);
    const user = userEvent.setup();
    render(<InsightsPanel tabId="t1" plan={[]} onHighlight={() => {}} />);
    await user.click(screen.getByTestId("vibepg-explain_optimize"));
    await waitFor(() => {
      expect(screen.getByTestId("vibepg-result-stub")).toBeInTheDocument();
    });
  });
});

describe("vibepg slot — ApplyDialog mount", () => {
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

  it("mounts the review button in the dialog body", () => {
    setSubscription(false);
    render(      <ApplyDialog
        open
        connectionId="c1"
        connectionName="local"
        environment="local"
        migrations={[migration()]}
        onClose={() => {}}
        onApplied={() => {}}
      />,
);
    expect(screen.getByTestId("apply-dialog-vibepg-slot")).toBeInTheDocument();
    expect(screen.getByTestId("vibepg-migration_review")).toBeInTheDocument();
  });

  it("clicking with subscription opens the result-dialog stub", async () => {
    setSubscription(true);
    const user = userEvent.setup();
    render(      <ApplyDialog
        open
        connectionId="c1"
        connectionName="local"
        environment="local"
        migrations={[migration()]}
        onClose={() => {}}
        onApplied={() => {}}
      />,
);
    await user.click(screen.getByTestId("vibepg-migration_review"));
    await waitFor(() => {
      expect(screen.getByTestId("vibepg-result-stub")).toBeInTheDocument();
    });
  });
});
