import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Pev2Bridge } from "./Pev2Bridge";

afterEach(() => {
  cleanup();
});

/**
 * — Pev2Bridge is now an iframe-based bridge that talks to the
 * island via postMessage (the prior in-React Vue mount could not survive
 * pev2's Bootstrap dependency without polluting the host).
 *
 * Tests verify:
 * 1. Renders an iframe pointing at the island URL.
 * 2. Posts a "render" message into the iframe after the island signals
 * "island-ready".
 * 3. Re-posts whenever plan or theme changes.
 *
 * jsdom doesn't actually load the iframe document, so we simulate the
 * island's "island-ready" lifecycle event manually.
 */
describe("Pev2Bridge", () => {
  it("renders an iframe pointing at the pev2 island", () => {
    render(<Pev2Bridge plan={{ Plan: { "Node Type": "Seq Scan" } }} theme="light" />);
    const frame = screen.getByTestId("pev2-host") as HTMLIFrameElement;
    expect(frame.tagName).toBe("IFRAME");
    expect(frame.getAttribute("src")).toBe("/pev2-island.html");
  });

  it("posts a render message after island-ready", async () => {
    render(<Pev2Bridge plan={{ Plan: { "Node Type": "Seq Scan" } }} theme="light" />);
    const frame = screen.getByTestId("pev2-host") as HTMLIFrameElement;
    // Spy on the iframe's contentWindow.postMessage. jsdom gives the iframe
    // a real `contentWindow`; we hijack postMessage to capture calls.
    const win = frame.contentWindow;
    expect(win).not.toBeNull();
    const post = vi.fn();
    if (win) {
      Object.defineProperty(win, "postMessage", { value: post, writable: true });
    }

    // Simulate the island sending its ready beacon.
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "island-ready" },
        source: win,
      }),
    );

    await waitFor(() => {
      expect(post).toHaveBeenCalledTimes(1);
    });
    const [payload] = post.mock.calls[0];
    expect(payload).toEqual({
      type: "render",
      plan: { Plan: { "Node Type": "Seq Scan" } },
      theme: "light",
      planQuery: "",
    });
  });

  it("re-posts when plan or theme changes", async () => {
    const { rerender } = render(<Pev2Bridge plan={{ a: 1 }} theme="light" />);
    const frame = screen.getByTestId("pev2-host") as HTMLIFrameElement;
    const win = frame.contentWindow;
    const post = vi.fn();
    if (win) {
      Object.defineProperty(win, "postMessage", { value: post, writable: true });
    }
    window.dispatchEvent(
      new MessageEvent("message", { data: { type: "island-ready" }, source: win }),
    );
    await waitFor(() => {
      expect(post).toHaveBeenCalledTimes(1);
    });

    rerender(<Pev2Bridge plan={{ a: 2 }} theme="light" />);
    await waitFor(() => {
      expect(post).toHaveBeenCalledTimes(2);
    });
    expect(post.mock.calls[1][0]).toMatchObject({
      type: "render",
      plan: { a: 2 },
      theme: "light",
    });

    rerender(<Pev2Bridge plan={{ a: 2 }} theme="dark" />);
    await waitFor(() => {
      expect(post).toHaveBeenCalledTimes(3);
    });
    expect(post.mock.calls[2][0]).toMatchObject({ theme: "dark" });
  });

  // — highlightQuery prop forwarded into pev2's planQuery.
  it("forwards highlightQuery into the planQuery field of the render payload", async () => {
    const { rerender } = render(
      <Pev2Bridge plan={{ Plan: { "Node Type": "Seq Scan" } }} theme="light" />,
    );
    const frame = screen.getByTestId("pev2-host") as HTMLIFrameElement;
    const win = frame.contentWindow;
    const post = vi.fn();
    if (win) {
      Object.defineProperty(win, "postMessage", { value: post, writable: true });
    }
    window.dispatchEvent(
      new MessageEvent("message", { data: { type: "island-ready" }, source: win }),
    );
    await waitFor(() => {
      expect(post).toHaveBeenCalledTimes(1);
    });
    expect(post.mock.calls[0][0]).toMatchObject({ planQuery: "" });

    rerender(
      <Pev2Bridge
        plan={{ Plan: { "Node Type": "Seq Scan" } }}
        theme="light"
        highlightQuery="users"
      />,
    );
    await waitFor(() => {
      expect(post).toHaveBeenCalledTimes(2);
    });
    expect(post.mock.calls[1][0]).toMatchObject({
      type: "render",
      planQuery: "users",
    });
  });

  it("ignores messages whose source isn't our iframe", async () => {
    render(<Pev2Bridge plan={{}} theme="light" />);
    const frame = screen.getByTestId("pev2-host") as HTMLIFrameElement;
    const win = frame.contentWindow;
    const post = vi.fn();
    if (win) {
      Object.defineProperty(win, "postMessage", { value: post, writable: true });
    }
    // Source is a different window (parent window stub) — must be ignored.
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "island-ready" },
        source: window,
      }),
    );
    // Give the effect a tick.
    await new Promise((r) => setTimeout(r, 20));
    expect(post).not.toHaveBeenCalled();
  });
});
