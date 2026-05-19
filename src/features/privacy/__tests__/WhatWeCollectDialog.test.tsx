/**
 * — WhatWeCollectDialog tests.
 *
 * - lists every event from `telemetry_known_events`
 * - close button fires onOpenChange(false)
 * - skips IPC when `open === false`
 */

import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WhatWeCollectDialog } from "../WhatWeCollectDialog";

const invokeMock = vi.fn(async (cmd: string) => {
  if (cmd === "telemetry_known_events") {
    return ["app_launched", "feature_used", "query_executed", "privacy_choice_made"];
  }
  return null;
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(args[0] as string),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts && typeof opts === "object" && "defaultValue" in opts) {
        return String(opts.defaultValue ?? key);
      }
      return key;
    },
  }),
}));

describe("WhatWeCollectDialog", () => {
  beforeEach(() => {
    invokeMock.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders the full event list when open", async () => {
    render(<WhatWeCollectDialog open onOpenChange={vi.fn()} />);
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("telemetry_known_events"));
    await screen.findByTestId("event-app_launched");
    expect(screen.getByTestId("event-feature_used")).toBeInTheDocument();
    expect(screen.getByTestId("event-query_executed")).toBeInTheDocument();
    expect(screen.getByTestId("event-privacy_choice_made")).toBeInTheDocument();
  });

  it("close button fires onOpenChange(false)", async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(<WhatWeCollectDialog open onOpenChange={onOpenChange} />);
    await screen.findByTestId("event-app_launched");
    await user.click(screen.getByTestId("what-we-collect-close"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("does not call IPC when open === false", () => {
    render(<WhatWeCollectDialog open={false} onOpenChange={vi.fn()} />);
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
