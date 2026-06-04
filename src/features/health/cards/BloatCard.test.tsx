import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import i18n from "../../../i18n";
import { BloatCard } from "./BloatCard";

// jsdom in this runner doesn't expose window.localStorage; ActionButton's
// easy-mode check (isEasyMode) reads it, which otherwise crashes any card test
// that renders rows. Provide a minimal in-memory stub.
if (typeof window !== "undefined" && !window.localStorage) {
  const store = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, String(v)),
      removeItem: (k: string) => store.delete(k),
      clear: () => store.clear(),
    },
  });
}

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

describe("BloatCard", () => {
  it("loading → skeleton", () => {
    render(<BloatCard connId="c1" state={{ status: "loading" }} />);
    expect(screen.getByTestId("health-card-bloat-skeleton")).toBeTruthy();
  });

  it("empty → centered no-issues message", () => {
    render(
      <BloatCard
        connId="c1"
        state={{ status: "ready", card: { id: "bloat", data: { rows: [] } } }}
      />,
    );
    expect(screen.getByTestId("health-card-bloat-empty")).toBeTruthy();
  });

  it("ready: renders top-3 + +N more, danger tone when max >30%", () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({
      schema: "public",
      table: `t${i}`,
      bloatPct: 35 - i,
      bloatBytes: (i + 1) * 1024 * 1024,
    }));
    render(
      <BloatCard connId="c1" state={{ status: "ready", card: { id: "bloat", data: { rows } } }} />,
    );
    expect(screen.getAllByTestId("bloat-row")).toHaveLength(3);
    expect(screen.getByTestId("bloat-more").textContent).toMatch(/2 more/);
    expect(screen.getByTestId("health-card-bloat-status").getAttribute("data-tone")).toBe("danger");
  });

  it("warn tone when 15 < max <= 30", () => {
    render(
      <BloatCard
        connId="c1"
        state={{
          status: "ready",
          card: {
            id: "bloat",
            data: {
              rows: [{ schema: "s", table: "t", bloatPct: 20, bloatBytes: 1024 }],
            },
          },
        }}
      />,
    );
    expect(screen.getByTestId("health-card-bloat-status").getAttribute("data-tone")).toBe("warn");
  });

  // Regression for React #310 ("Rendered more hooks…"): the "+N more" useState
  // must run on every render, so flipping ready → loading → empty → ready (a
  // Health refresh) must not change the hook count and must not throw.
  it("survives ready → loading → empty → ready transitions (#310)", () => {
    const rows = Array.from({ length: 4 }, (_, i) => ({
      schema: "public",
      table: `t${i}`,
      bloatPct: 35 - i,
      bloatBytes: (i + 1) * 1024 * 1024,
    }));
    const ready = { status: "ready", card: { id: "bloat", data: { rows } } } as const;
    const { rerender } = render(<BloatCard connId="c1" state={ready} />);
    expect(() => {
      rerender(<BloatCard connId="c1" state={{ status: "loading" }} />);
      rerender(
        <BloatCard
          connId="c1"
          state={{ status: "ready", card: { id: "bloat", data: { rows: [] } } }}
        />,
      );
      rerender(<BloatCard connId="c1" state={ready} />);
    }).not.toThrow();
  });

  it("clicking +N more expands to all rows, then collapses (#34)", () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({
      schema: "public",
      table: `t${i}`,
      bloatPct: 35 - i,
      bloatBytes: (i + 1) * 1024 * 1024,
    }));
    render(
      <BloatCard connId="c1" state={{ status: "ready", card: { id: "bloat", data: { rows } } }} />,
    );
    expect(screen.getAllByTestId("bloat-row")).toHaveLength(3);

    fireEvent.click(screen.getByTestId("bloat-more"));
    expect(screen.getAllByTestId("bloat-row")).toHaveLength(5);

    fireEvent.click(screen.getByTestId("bloat-more"));
    expect(screen.getAllByTestId("bloat-row")).toHaveLength(3);
  });
});
