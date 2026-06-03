import { logger } from "./logger";

/**
 * Always-on local diagnostics (issue #14).
 *
 * Distinct from the privacy-gated crash REPORTER (`CrashReporterHost`, which
 * uploads to Sentry only after opt-in): this mirrors every uncaught error and
 * unhandled promise rejection to the local Rust log file via `log_error` — no
 * network, no opt-in. Before this, an error on a fresh / opted-out install
 * vanished with no trace (the Astra user's "Unhandled rejection — стек не
 * захвачен"); now it lands in `<data_dir>/logs/ide99.log`.
 */
let installed = false;

// Recursion guard: if logger.error itself rejects we must not re-enter.
let logging = false;

// Light rate limit so a tight reject-loop can't flood the log file.
const MAX_PER_WINDOW = 20;
const WINDOW_MS = 10_000;
let windowStart = 0;
let countInWindow = 0;

function allow(): boolean {
  const now = Date.now();
  if (now - windowStart > WINDOW_MS) {
    windowStart = now;
    countInWindow = 0;
  }
  countInWindow += 1;
  return countInWindow <= MAX_PER_WINDOW;
}

function report(message: string, detail: string): void {
  if (logging || !allow()) return;
  logging = true;
  void logger.error(message, detail).finally(() => {
    logging = false;
  });
}

export function installGlobalDiagnostics(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  window.addEventListener("error", (e: ErrorEvent) => {
    const stack = e.error instanceof Error ? e.error.stack : undefined;
    report(`uncaught error: ${e.message}`, stack ?? `${e.filename}:${e.lineno}:${e.colno}`);
  });

  window.addEventListener("unhandledrejection", (e: PromiseRejectionEvent) => {
    const reason = e.reason;
    const message = reason instanceof Error ? reason.message : String(reason);
    const detail = reason instanceof Error ? (reason.stack ?? "") : "";
    report(`unhandled promise rejection: ${message}`, detail);
  });
}
