import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { ErrorExplainButton } from "../../error-explain/ErrorExplainButton";
import { type ExplainRunState, useEditor } from "../store";

interface ExplainErrorViewProps {
  state: Extract<ExplainRunState, { status: "error" }>;
  /** Null when the ExplainTab is cached (S10) — no source to jump to. */
  sourceTabId: string | null;
}

/**
 * — renders an EXPLAIN failure as a localized message plus, for
 * Postgres syntax errors carrying a line, an "Open in editor" button that
 * routes the user back to the source SQL tab. Cursor placement is
 * best-effort — Monaco may not be mounted at the moment of switch.
 */
export function ExplainErrorView({ state, sourceTabId }: ExplainErrorViewProps): JSX.Element {
  const { t } = useTranslation();
  const code = state.code;
  const messageKey =
    code === "postgres_error"
      ? "editor.explain.error.postgres"
      : code === "no_connection"
        ? "editor.explain.error.no_connection"
        : code === "not_connected"
          ? "editor.explain.error.not_connected"
          : code === "read_only_blocked"
            ? "editor.explain.error.read_only_blocked"
            : code === "parse_error"
              ? "editor.explain.error.parse"
              : code === "source_closed"
                ? "editor.explain.error.source_closed"
                : "editor.explain.error.unknown";

  // Cached ExplainTabs (sourceTabId === null) can't jump back to a source —
  // the user opened the plan from Recent Plans, not from a live editor tab.
  const canJump = code === "postgres_error" && state.line !== undefined && sourceTabId !== null;

  return (
    <div data-testid="explain-error" style={{ padding: 16 }}>
      <p style={{ color: "var(--danger, var(--accent-danger, #f43f5e))", margin: 0 }}>
        {t(messageKey, { detail: state.detail ?? "" })}
      </p>
      {canJump && sourceTabId !== null ? (
        <button
          type="button"
          className="btn btn-sm"
          style={{ marginTop: 12 }}
          onClick={() => {
            useEditor.getState().switchTab(sourceTabId);
          }}
          data-testid="explain-error-open-in-editor"
        >
          {t("editor.explain.error.open_in_editor")}
        </button>
      ) : null}
      {code === "postgres_error" && state.detail ? (
        <div style={{ marginTop: 12 }}>
          <ErrorExplainButton
            sqlstate={state.sqlstate}
            message={state.detail}
            sql={null}
            variant="inline"
          />
        </div>
      ) : null}
    </div>
  );
}
