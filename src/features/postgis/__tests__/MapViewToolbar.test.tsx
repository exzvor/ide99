// — .
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MapViewToolbar } from "../MapViewToolbar";

describe("MapViewToolbar", () => {
  it("marks only the active tool with aria-pressed=true", () => {
    const { getByTestId } = render(<MapViewToolbar active="pan" onChange={() => {}} />);
    expect(getByTestId("map-tool-pan").getAttribute("aria-pressed")).toBe("true");
    expect(getByTestId("map-tool-point").getAttribute("aria-pressed")).toBe("false");
    expect(getByTestId("map-tool-line").getAttribute("aria-pressed")).toBe("false");
    expect(getByTestId("map-tool-polygon").getAttribute("aria-pressed")).toBe("false");
  });

  it("invokes onChange with 'point' when the Pick Point button is clicked", () => {
    const onChange = vi.fn();
    const { getByTestId } = render(<MapViewToolbar active="pan" onChange={onChange} />);
    fireEvent.click(getByTestId("map-tool-point"));
    expect(onChange).toHaveBeenCalledWith("point");
  });
});
