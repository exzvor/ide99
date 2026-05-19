import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { beforeAll, describe, expect, test, vi } from "vitest";
import i18n from "../../../i18n";
import { HELP_URLS, HelpLink } from "./HelpLink";

// HelpLink now opens external URLs via the `open_external_url` Tauri command
// (see `src-tauri/src/system.rs`) — Tauri 2 doesn't route `window.open` to
// the OS browser by default. The mock resolves immediately so the click
// handler observes the same flow as production.
const openExternalUrlMock = vi.fn().mockResolvedValue(undefined);
vi.mock("../../../lib/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/tauri")>("../../../lib/tauri");
  return { ...actual, openExternalUrl: (url: string) => openExternalUrlMock(url) };
});

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

function H(topic: Parameters<typeof HelpLink>[0]["topic"] = "table") {
  return render(    <I18nextProvider i18n={i18n}>
      <HelpLink topic={topic} />
    </I18nextProvider>,
);
}

describe("HelpLink", () => {
  test("renders external-link icon and 'PostgreSQL docs' text", () => {
    H("table");
    const link = screen.getByTestId("help-link");
    expect(link).toHaveTextContent("PostgreSQL docs");
    // The Lucide icon renders as an <svg> child.
    expect(link.querySelector("svg")).not.toBeNull();
  });

  test("click invokes openExternalUrl with the topic URL", async () => {
    openExternalUrlMock.mockClear();
    H("index");
    fireEvent.click(screen.getByTestId("help-link"));
    await waitFor(() => expect(openExternalUrlMock).toHaveBeenCalledWith(HELP_URLS.index));
  });

  test("falls back to window.open when openExternalUrl rejects (e.g. web build)", async () => {
    openExternalUrlMock.mockRejectedValueOnce(new Error("no Tauri bridge"));
    const spy = vi.spyOn(window, "open").mockImplementation(() => null);
    H("table");
    fireEvent.click(screen.getByTestId("help-link"));
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith(HELP_URLS.table, "_blank", "noopener,noreferrer"),
);
    spy.mockRestore();
  });

  test("renders as a native <button> (Enter/Space activation handled by browser)", () => {
    H("sequence");
    const link = screen.getByTestId("help-link");
    // Native <button> gets Enter/Space activation for free in real browsers
    // — verify the element type so we don't accidentally regress to a span.
    expect(link.tagName).toBe("BUTTON");
    expect(link.getAttribute("type")).toBe("button");
  });
});
