import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/tauri", () => ({
  erdLoadPositions: vi.fn(async () => []),
  erdSavePositions: vi.fn(async () => undefined),
}));

import { act, renderHook, waitFor } from "@testing-library/react";
import { erdLoadPositions, erdSavePositions } from "../../../lib/tauri";
import { useErdPositions } from "./positions";

describe("useErdPositions", () => {
  beforeEach(() => {
    (erdLoadPositions as unknown as ReturnType<typeof vi.fn>).mockClear();
    (erdSavePositions as unknown as ReturnType<typeof vi.fn>).mockClear();
  });

  it("loads positions on mount", async () => {
    (erdLoadPositions as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { nodeId: "a", x: 1, y: 2 },
    ]);
    const { result } = renderHook(() => useErdPositions("c1", "*"));
    await waitFor(() => expect(result.current.positions.size).toBe(1));
    expect(erdLoadPositions).toHaveBeenCalledWith("c1", "*");
  });

  it("setPosition updates map and debounced-saves", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useErdPositions("c1", "*"));
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    act(() => result.current.setPosition("a", 100, 200));
    expect(result.current.positions.get("a")).toEqual({ x: 100, y: 200 });
    expect(erdSavePositions).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    expect(erdSavePositions).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("reset clears + saves empty array", async () => {
    const { result } = renderHook(() => useErdPositions("c1", "*"));
    act(() => result.current.setPosition("a", 1, 2));
    await act(async () => {
      await result.current.reset();
    });
    expect(result.current.positions.size).toBe(0);
    expect(erdSavePositions).toHaveBeenCalledWith("c1", "*", []);
  });
});
