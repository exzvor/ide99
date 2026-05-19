import { afterEach, describe, expect, it, vi } from "vitest";
import { __resetPlatformCache, formatHotkey, isMacPlatform, modKey } from "./platform";

afterEach(() => {
  __resetPlatformCache();
  vi.unstubAllGlobals();
});

describe("isMacPlatform", () => {
  it("returns true for MacIntel", () => {
    vi.stubGlobal("navigator", { platform: "MacIntel", userAgent: "" });
    expect(isMacPlatform()).toBe(true);
  });

  it("returns true for iPhone", () => {
    vi.stubGlobal("navigator", { platform: "iPhone", userAgent: "" });
    expect(isMacPlatform()).toBe(true);
  });

  it("returns false for Linux", () => {
    vi.stubGlobal("navigator", { platform: "Linux x86_64", userAgent: "" });
    expect(isMacPlatform()).toBe(false);
  });

  it("returns false for Win32", () => {
    vi.stubGlobal("navigator", { platform: "Win32", userAgent: "" });
    expect(isMacPlatform()).toBe(false);
  });

  it("falls back to userAgent when platform is empty", () => {
    vi.stubGlobal("navigator", {
      platform: "",
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
    });
    expect(isMacPlatform()).toBe(true);
  });
});

describe("modKey + formatHotkey", () => {
  it("returns ⌘ on macOS", () => {
    vi.stubGlobal("navigator", { platform: "MacIntel", userAgent: "" });
    expect(modKey()).toBe("⌘");
    expect(formatHotkey("T")).toBe("⌘ + T");
    expect(formatHotkey("Shift", "F")).toBe("⌘ + Shift + F");
  });

  it("returns Ctrl on Linux/Windows", () => {
    vi.stubGlobal("navigator", { platform: "Linux x86_64", userAgent: "" });
    expect(modKey()).toBe("Ctrl");
    expect(formatHotkey("T")).toBe("Ctrl + T");
    expect(formatHotkey("Shift", "F")).toBe("Ctrl + Shift + F");
  });
});
