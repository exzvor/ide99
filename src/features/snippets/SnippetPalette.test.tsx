import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SnippetPalette } from "./SnippetPalette";
import { useSnippets } from "./store";

const insertAtCursor = vi.fn();
vi.mock("../editor/store", () => ({
  useEditor: { getState: () => ({ insertSnippetAtCursor: insertAtCursor }) },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { changeLanguage: () => Promise.resolve(), language: "en" },
  }),
}));

beforeAll(() => {
  // jsdom doesn't lay out flex/overflow regions, so the virtualizer's
  // scroll element reports 0 height and renders zero items. Patch
  // getBoundingClientRect to claim a reasonable viewport size; @tanstack/
  // react-virtual then schedules its first render with non-zero items.
  Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value(this: HTMLElement) {
      return {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 800,
        bottom: 600,
        width: 800,
        height: 600,
        toJSON: () => ({}),
      } as DOMRect;
    },
  });
  if (typeof globalThis.ResizeObserver === "undefined") {
    class ResizeObserverPolyfill {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    (globalThis as unknown as { ResizeObserver: typeof ResizeObserverPolyfill }).ResizeObserver =
      ResizeObserverPolyfill;
  }
});

describe("SnippetPalette", () => {
  beforeEach(() => {
    insertAtCursor.mockReset();
    useSnippets.setState({ paletteOpen: true, userSnippets: [], loading: false, error: null });
  });

  it("renders built-ins when no user snippets", () => {
    render(<SnippetPalette />);
    // 17 built-ins ship; test that at least one is visible
    expect(screen.getByText(/SELECT … FROM … WHERE/i)).toBeInTheDocument();
  });

  it("filters by typed text", async () => {
    const user = userEvent.setup();
    render(<SnippetPalette />);
    const input = screen.getByPlaceholderText(/search/i);
    await user.type(input, "cte");
    // virtualised list — assert that "WITH … AS …" snippet is visible
    expect(screen.getByText(/WITH … AS …/)).toBeInTheDocument();
  });

  it("Enter closes palette then inserts the highlighted snippet", async () => {
    const user = userEvent.setup();
    render(<SnippetPalette />);
    await user.type(screen.getByPlaceholderText(/search/i), "cte");
    await user.keyboard("{Enter}");
    // Palette closes synchronously; insert is deferred via setTimeout(0)
    // so Radix can release its focus-trap before Monaco's insertSnippet
    // action runs ().
    expect(useSnippets.getState().paletteOpen).toBe(false);
    await waitFor(() => {
      expect(insertAtCursor).toHaveBeenCalledWith(expect.stringContaining("WITH"));
    });
  });

  it("Esc closes without inserting", async () => {
    const user = userEvent.setup();
    render(<SnippetPalette />);
    await user.keyboard("{Escape}");
    expect(insertAtCursor).not.toHaveBeenCalled();
    expect(useSnippets.getState().paletteOpen).toBe(false);
  });

  it("does not render when paletteOpen=false", () => {
    useSnippets.setState({ paletteOpen: false });
    render(<SnippetPalette />);
    expect(screen.queryByPlaceholderText(/search/i)).toBeNull();
  });
});
