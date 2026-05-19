import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import i18n from "../../../i18n";
import { UnusedIndexesCard } from "./UnusedIndexesCard";

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

describe("UnusedIndexesCard", () => {
  it("loading → skeleton", () => {
    render(<UnusedIndexesCard connId="c1" state={{ status: "loading" }} />);
    expect(screen.getByTestId("health-card-unused_indexes-skeleton")).toBeTruthy();
  });

  it("empty rows → no-issues message", () => {
    render(      <UnusedIndexesCard
        connId="c1"
        state={{
          status: "ready",
          card: { id: "unused_indexes", data: { rows: [] } },
        }}
      />,
);
    expect(screen.getByTestId("health-card-unused_indexes-empty")).toBeTruthy();
  });

  it("ready: warn when total > 100 MB", () => {
    const rows = [
      { schema: "public", index: "idx_a", onTable: "t1", sizeBytes: 200 * 1024 * 1024 },
    ];
    render(      <UnusedIndexesCard
        connId="c1"
        state={{ status: "ready", card: { id: "unused_indexes", data: { rows } } }}
      />,
);
    expect(screen.getByTestId("health-card-unused_indexes-status").getAttribute("data-tone")).toBe(      "warn",
);
  });

  it("ready: ok when total <= 100 MB", () => {
    const rows = [{ schema: "public", index: "idx_a", onTable: "t1", sizeBytes: 1024 * 1024 }];
    render(      <UnusedIndexesCard
        connId="c1"
        state={{ status: "ready", card: { id: "unused_indexes", data: { rows } } }}
      />,
);
    expect(screen.getByTestId("health-card-unused_indexes-status").getAttribute("data-tone")).toBe(      "ok",
);
  });
});
