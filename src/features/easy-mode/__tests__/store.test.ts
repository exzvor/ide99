import { beforeEach, describe, expect, it } from "vitest";
import { isEasyMode, useUiMode } from "../store";

describe("useUiMode", () => {
  beforeEach(() => {
    useUiMode.setState({ mode: "standard", tourCompleted: false });
  });

  it("defaults to standard", () => {
    expect(useUiMode.getState().mode).toBe("standard");
    expect(isEasyMode()).toBe(false);
  });

  it("toggleMode flips between easy and standard", () => {
    useUiMode.getState().toggleMode();
    expect(useUiMode.getState().mode).toBe("easy");
    expect(isEasyMode()).toBe(true);
    useUiMode.getState().toggleMode();
    expect(useUiMode.getState().mode).toBe("standard");
  });

  it("setMode is idempotent", () => {
    useUiMode.getState().setMode("easy");
    useUiMode.getState().setMode("easy");
    expect(useUiMode.getState().mode).toBe("easy");
  });

  it("setTourCompleted persists the flag", () => {
    expect(useUiMode.getState().tourCompleted).toBe(false);
    useUiMode.getState().setTourCompleted(true);
    expect(useUiMode.getState().tourCompleted).toBe(true);
  });
});
