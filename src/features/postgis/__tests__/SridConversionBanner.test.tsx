// — : SridConversionBanner tests.
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SridConversionBanner } from "../SridConversionBanner";

const openEditorTab = vi.fn();

vi.mock("../../editor/store", () => ({
  useEditor: {
    getState: () => ({ openEditorTab }),
  },
}));

describe("SridConversionBanner", () => {
  beforeEach(() => {
    openEditorTab.mockReset();
  });

  it("renders banner with SRID and prompt text", () => {
    render(      <SridConversionBanner
        connId="conn-1"
        geometryColumn="geom"
        originalSql="SELECT geom FROM places"
        unknownSrid={32636}
      />,
);
    const banner = screen.getByTestId("srid-conversion-banner");
    expect(banner.textContent).toMatch(/SRID/i);
    expect(banner.textContent).toContain("32636");
    expect(banner.textContent).toMatch(/ST_Transform/i);
  });

  it("clicking the button calls openEditorTab with helper SQL", () => {
    render(      <SridConversionBanner
        connId="conn-1"
        geometryColumn="geom"
        originalSql="SELECT geom FROM places"
        unknownSrid={32636}
      />,
);
    const button = screen.getByTestId("srid-banner-generate");
    fireEvent.click(button);
    expect(openEditorTab).toHaveBeenCalledTimes(1);
    const [calledConnId, calledOpts] = openEditorTab.mock.calls[0];
    expect(calledConnId).toBe("conn-1");
    expect(calledOpts).toBeDefined();
    expect(typeof calledOpts.prefillSql).toBe("string");
    const sql: string = calledOpts.prefillSql;
    expect(sql).toContain("ST_Transform");
    expect(sql).toContain("geom");
    expect(sql).toContain("4326");
    expect(sql).toContain("SELECT geom FROM places");
  });

  it("button is disabled when connId is null", () => {
    render(      <SridConversionBanner
        connId={null}
        geometryColumn="geom"
        originalSql="SELECT geom FROM places"
        unknownSrid={32636}
      />,
);
    const button = screen.getByTestId("srid-banner-generate") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(openEditorTab).not.toHaveBeenCalled();
  });
});
