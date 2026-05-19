import { invoke } from "@tauri-apps/api/core";

/**
 * Frontend logger. Dev-mode debug is verbose; prod-mode debug is a no-op.
 * `error()` always mirrors to the Rust side via the `log_error` Tauri command,
 * which writes through `tracing::error!` so the foundation is in place for
 * Sentry / crash reporting to pick up later (S36).
 */
export const logger = {
  debug: (msg: string, ...args: unknown[]): void => {
    if (import.meta.env.DEV) console.debug("[ide99]", msg, ...args);
  },
  info: (msg: string, ...args: unknown[]): void => {
    console.info("[ide99]", msg, ...args);
  },
  warn: (msg: string, ...args: unknown[]): void => {
    console.warn("[ide99]", msg, ...args);
  },
  error: async (msg: string, error?: unknown): Promise<void> => {
    console.error("[ide99]", msg, error);
    try {
      await invoke("log_error", {
        message: msg,
        detail: error === undefined ? "" : String(error),
      });
    } catch {
      // Swallow IPC errors during logging to avoid recursive failure.
    }
  },
};
