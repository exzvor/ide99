import { invoke } from "@tauri-apps/api/core";
import { Component, type ErrorInfo, type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { logger } from "../lib/logger";

/**
 * React error boundary (issue #14).
 *
 * Before this existed, a render-time throw anywhere in the editor tab unmounted
 * the whole React tree, leaving a blank window with no clue what happened — and
 * because the throw was inside React, the global `unhandledrejection` listener
 * never saw it. This boundary:
 * - catches the throw so the rest of the app keeps working;
 * - mirrors the error (with component stack) to the Rust log via `logger.error`
 *   → `<data_dir>/logs/ide99.log`, the only diagnostic channel in a closed/
 *   air-gapped network;
 * - renders a small, recoverable fallback with a "Try again" action plus an
 *   "Open logs folder" button (1.0.8: Windows users couldn't find the log).
 *
 * Place it per-tab (keyed by the active tab id) so a crash in one panel doesn't
 * take down the whole workspace and the user can switch/close tabs to escape.
 */
interface Props {
  children: ReactNode;
  /** Short label naming the wrapped region; included in the log line. */
  label?: string;
  /** Optional custom fallback (defaults to the built-in recoverable panel). */
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const where = this.props.label ? ` in ${this.props.label}` : "";
    void logger.error(
      `React render error${where}: ${error.message}`,
      `${error.stack ?? String(error)}\n\nComponent stack:${info.componentStack ?? ""}`,
    );
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (error) {
      return this.props.fallback ? (
        this.props.fallback(error, this.reset)
      ) : (
        <ErrorFallbackPanel error={error} onReset={this.reset} />
      );
    }
    return this.props.children;
  }
}

/**
 * The recoverable fallback UI. Reused by the default boundary and by per-tab
 * boundaries (which pass `onCloseTab` to also offer "Close this tab").
 */
export function ErrorFallbackPanel({
  error,
  onReset,
  onCloseTab,
}: {
  error: Error;
  onReset: () => void;
  onCloseTab?: () => void;
}): ReactNode {
  const { t } = useTranslation();
  const [logsPath, setLogsPath] = useState<string | null>(null);

  const openLogs = (): void => {
    void invoke<string>("open_logs_folder")
      .then((path) => setLogsPath(path))
      .catch(() => {
        // Command unavailable (non-Tauri / test env) — nothing to reveal.
      });
  };

  return (
    <div
      role="alert"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        padding: 32,
        minHeight: 200,
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 15, fontWeight: 600 }}>
        {t("errors.boundary.title", { defaultValue: "Something went wrong here" })}
      </div>
      <div style={{ fontSize: 13, opacity: 0.7, maxWidth: 480 }}>
        {t("errors.boundary.body", {
          defaultValue:
            "This part of the app hit an error and was paused so the rest keeps working. The details were written to the local log file.",
        })}
      </div>
      <code
        style={{
          fontSize: 12,
          opacity: 0.6,
          maxWidth: 520,
          overflowWrap: "anywhere",
        }}
      >
        {error.message}
      </code>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
        <button type="button" className="btn btn-primary" onClick={onReset}>
          {t("errors.boundary.retry", { defaultValue: "Try again" })}
        </button>
        {onCloseTab ? (
          <button type="button" className="btn btn-ghost" onClick={onCloseTab}>
            {t("errors.boundary.close_tab", { defaultValue: "Close this tab" })}
          </button>
        ) : null}
        <button type="button" className="btn btn-ghost" onClick={openLogs}>
          {t("errors.boundary.open_logs", { defaultValue: "Open logs folder" })}
        </button>
      </div>
      {logsPath ? (
        <code style={{ fontSize: 11, opacity: 0.55, maxWidth: 520, overflowWrap: "anywhere" }}>
          {logsPath}
        </code>
      ) : null}
    </div>
  );
}
