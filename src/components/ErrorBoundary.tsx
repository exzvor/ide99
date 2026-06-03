import { Component, type ErrorInfo, type ReactNode } from "react";
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
 * - renders a small, recoverable fallback with a "Try again" action instead of
 *   a dead screen.
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
        <ErrorFallback error={error} onReset={this.reset} />
      );
    }
    return this.props.children;
  }
}

function ErrorFallback({
  error,
  onReset,
}: {
  error: Error;
  onReset: () => void;
}): ReactNode {
  const { t } = useTranslation();
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
      <button type="button" className="btn btn-primary" onClick={onReset}>
        {t("errors.boundary.retry", { defaultValue: "Try again" })}
      </button>
    </div>
  );
}
