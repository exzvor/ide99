/**
 * — useAutosave hook tests.
 *
 * Drives the hook through the React renderer (not renderHook) so the
 * effect-deps-on-notebook contract is exercised the same way the real
 * NotebookPane uses it. Fake timers let us assert on the 500 ms debounce.
 */
import "@testing-library/jest-dom/vitest";
import { act, render, screen } from "@testing-library/react";
import { type JSX, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { useNotebooks } from "../store";
import type { Notebook } from "../types";
import { useAutosave } from "../useAutosave";

function nb(partial: Partial<Notebook> = {}): Notebook {
  return {
    id: "nb",
    name: "Test",
    cells: [],
    connectionId: null,
    filePath: null,
    createdAt: "2026-05-06T00:00:00Z",
    updatedAt: "2026-05-06T00:00:00Z",
    ...partial,
  };
}

interface HostProps {
  initial: Notebook;
}

function Host({ initial }: HostProps): JSX.Element {
  const [n, setN] = useState<Notebook>(initial);
  const a = useAutosave(n, { delayMs: 500 });
  return (    <div>
      <span data-testid="status">{a.status}</span>
      <button
        type="button"
        data-testid="rename"
        onClick={() => setN((prev) => ({ ...prev, name: `${prev.name}!` }))}
      >
        Rename
      </button>
    </div>
);
}

beforeEach(() => {
  invokeMock.mockReset();
  vi.useFakeTimers();
  useNotebooks.setState({
    byId: {},
    loaded: false,
    runStateByCellId: {},
    runningByNotebookId: {},
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useAutosave", () => {
  it("starts in idle state with no immediate save", () => {
    invokeMock.mockResolvedValue(nb());
    render(<Host initial={nb()} />);
    expect(screen.getByTestId("status")).toHaveTextContent("idle");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("transitions to pending → saving → saved after edit + delay", async () => {
    invokeMock.mockResolvedValue(nb({ name: "Test!" }));
    render(<Host initial={nb()} />);
    act(() => {
      screen.getByTestId("rename").click();
    });
    expect(screen.getByTestId("status")).toHaveTextContent("pending");
    await act(async () => {
      vi.advanceTimersByTime(500);
      // Allow microtasks (the await invoke) to flush.
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(invokeMock).toHaveBeenCalledWith(      "notebook_save",
      expect.objectContaining({
        input: expect.objectContaining({ name: "Test!" }),
      }),
);
    expect(screen.getByTestId("status")).toHaveTextContent("saved");
  });

  it("does not save while the notebook is mid-run (race guard)", () => {
    invokeMock.mockResolvedValue(nb());
    useNotebooks.setState({ runningByNotebookId: { nb: true } });
    render(<Host initial={nb()} />);
    act(() => {
      screen.getByTestId("rename").click();
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("debounces: rapid edits collapse into a single save", async () => {
    invokeMock.mockResolvedValue(nb());
    render(<Host initial={nb()} />);
    for (let i = 0; i < 5; i++) {
      act(() => {
        screen.getByTestId("rename").click();
      });
      act(() => {
        vi.advanceTimersByTime(100);
      });
    }
    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });
});
