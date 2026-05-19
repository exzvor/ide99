/**
 * (a11y) — axe-core regression for HealthHeader.
 *
 * The header packs an icon-only refresh button (lucide RefreshCw + label),
 * a labelled `<select>` for the auto-refresh interval, plus a row of
 * tone-coded pills. axe catches missing labels on the button and the
 * select; we render with a mocked store so the dropdown options resolve.
 */

import "@testing-library/jest-dom/vitest";
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import { expectNoAxeViolations } from "../../test/axeHelper";
import { useConnections } from "../connections/store";
import { HealthHeader } from "./HealthHeader";
import { useHealth } from "./store";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts && typeof opts === "object") {
        return Object.entries(opts).reduce<string>(          (acc, [k, v]) => acc.replace(`{{${k}}}`, String(v)),
          key,
);
      }
      return key;
    },
    i18n: { language: "en" },
  }),
}));

beforeEach(() => {
  useConnections.setState({
    connections: [
      {
        id: "c1",
        name: "Local PG",
        environment: "local",
        confirmDestructive: false,
      } as never,
    ],
  });
  useHealth.setState({ byConn: new Map() });
  useHealth.getState().ensureConn?.("c1");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("HealthHeader accessibility", () => {
  it("has 0 axe violations on initial render", async () => {
    const { container } = render(      <HealthHeader
        connId="c1"
        lastRefreshAt={Date.now() - 5000}
        refreshIntervalMs={10000}
        refreshInProgress={false}
      />,
);
    await expectNoAxeViolations(container);
  });

  it("has 0 axe violations during a refresh-in-progress state", async () => {
    const { container } = render(      <HealthHeader
        connId="c1"
        lastRefreshAt={Date.now()}
        refreshIntervalMs={null}
        refreshInProgress={true}
      />,
);
    await expectNoAxeViolations(container);
  });
});
