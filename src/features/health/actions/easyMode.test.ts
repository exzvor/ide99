import { afterEach, describe, expect, it } from "vitest";
import { isEasyMode, setEasyModeForTesting } from "./easyMode";

describe("easyMode", () => {
  afterEach(() => setEasyModeForTesting(false));

  it("defaults to false", () => {
    expect(isEasyMode()).toBe(false);
  });

  it("returns true when override is set", () => {
    setEasyModeForTesting(true);
    expect(isEasyMode()).toBe(true);
  });

  it("clears the override when set to false", () => {
    setEasyModeForTesting(true);
    setEasyModeForTesting(false);
    expect(isEasyMode()).toBe(false);
    expect(window.localStorage.getItem("ide99:debug.easyMode")).toBe(null);
  });
});
