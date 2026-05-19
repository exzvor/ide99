import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

describe("logger", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
    vi.spyOn(console, "debug").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  test("debug() forwards to console.debug in dev mode", async () => {
    vi.stubEnv("DEV", true);
    const { logger } = await import("./logger");
    logger.debug("hello", { k: 1 });
    expect(console.debug).toHaveBeenCalledWith("[ide99]", "hello", { k: 1 });
  });

  test("debug() is a no-op in prod mode", async () => {
    vi.stubEnv("DEV", false);
    const { logger } = await import("./logger");
    logger.debug("hello");
    expect(console.debug).not.toHaveBeenCalled();
  });

  test("info() always forwards to console.info", async () => {
    const { logger } = await import("./logger");
    logger.info("ready");
    expect(console.info).toHaveBeenCalledWith("[ide99]", "ready");
  });

  test("warn() always forwards to console.warn", async () => {
    const { logger } = await import("./logger");
    logger.warn("careful");
    expect(console.warn).toHaveBeenCalledWith("[ide99]", "careful");
  });

  test("error() invokes the Tauri command 'log_error' with payload", async () => {
    const { logger } = await import("./logger");
    const cause = new Error("boom");
    await logger.error("crash", cause);
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("log_error", {
      message: "crash",
      detail: String(cause),
    });
  });

  test("error() does not throw when invoke rejects", async () => {
    invokeMock.mockRejectedValueOnce(new Error("ipc down"));
    const { logger } = await import("./logger");
    await expect(logger.error("crash")).resolves.toBeUndefined();
  });

  test("error() formats undefined detail to empty string", async () => {
    const { logger } = await import("./logger");
    await logger.error("crash");
    expect(invokeMock).toHaveBeenCalledWith("log_error", {
      message: "crash",
      detail: "",
    });
  });
});
