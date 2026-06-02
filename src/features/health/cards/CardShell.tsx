import { AlertCircle, CheckCircle2, Copy, RefreshCw, RotateCw } from "lucide-react";
import type { CSSProperties, JSX, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "../../../components/Toast";
import type { CardId, CardState } from "../store";
import { useHealth } from "../store";

interface StatusInfo {
  tone: "ok" | "warn" | "danger";
  tooltip?: string;
}

interface CardShellProps {
  cardId: CardId;
  connId: string;
  state: CardState;
  /** Body to render in the `ready` state. */
  body?: ReactNode;
  /** Status badge tone + optional tooltip for `ready`. */
  status?: StatusInfo;
}

const TONE_VAR: Record<StatusInfo["tone"], string> = {
  ok: "var(--accent)",
  warn: "var(--warning-500)",
  danger: "var(--danger-q)",
};

const SHELL_BASE: CSSProperties = {
  position: "relative",
  display: "flex",
  flexDirection: "column",
  gap: 8,
  minHeight: 140,
  padding: 12,
  borderRadius: 8,
  border: "1px solid var(--hairline)",
  background: "var(--bg-elev, var(--bg-2))",
};

const TITLE_ROW: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: 0.2,
  textTransform: "uppercase",
  opacity: 0.9,
};

const BADGE_TOP_RIGHT: CSSProperties = {
  position: "absolute",
  top: 10,
  right: 10,
  display: "flex",
  alignItems: "center",
  gap: 4,
};

const CENTER_BLOCK: CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  textAlign: "center",
  fontSize: 12,
};

const SHIMMER_LINE: CSSProperties = {
  height: 10,
  borderRadius: 4,
  background: "var(--bg-elev)",
  opacity: 0.6,
  animation: "health-card-shimmer 1.2s ease-in-out infinite",
};

/**
 * — common envelope for all 10 health cards. Implements the
 * UI matrix per spec §7.5: loading shimmer / ready body+status / empty /
 * unavailable / forbidden / error.
 */
export function CardShell({ cardId, connId, state, body, status }: CardShellProps): JSX.Element {
  const { t } = useTranslation();
  const toast = useToast();

  const titleKey = `health.card.${cardId}.title`;
  // explanationKey removed along with the Info-icon (temporarily disabled with Easy mode).
  async function copy(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t("health.unavailable.copy"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  function retry(): void {
    void useHealth.getState().refreshOne(connId, cardId);
  }

  return (
    <div
      data-testid={`health-card-${cardId}`}
      // Severity marker so the header's critical/warning pills can jump to the
      // first card of a given tone (#34). Absent until the card is `ready`.
      data-card-tone={status?.tone}
      style={SHELL_BASE}
    >
      {/* shimmer keyframes — scoped via plain <style>, idempotent enough for SPA */}
      <style>{`
        @keyframes health-card-shimmer {
          0%, 100% { opacity: 0.45; }
          50% { opacity: 0.85; }
        }
      `}</style>

      <div style={TITLE_ROW}>
        <span>{t(titleKey)}</span>
      </div>

      {/* loading: top-right spinner + 3-line shimmer */}
      {state.status === "loading" ? (
        <>
          <div style={BADGE_TOP_RIGHT} aria-hidden="true">
            <RefreshCw
              size={14}
              className="animate-spin"
              data-testid={`health-card-${cardId}-spinner`}
            />
          </div>
          <div
            data-testid={`health-card-${cardId}-skeleton`}
            style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}
          >
            <div style={{ ...SHIMMER_LINE, width: "70%" }} />
            <div style={{ ...SHIMMER_LINE, width: "55%" }} />
            <div style={{ ...SHIMMER_LINE, width: "40%" }} />
          </div>
        </>
      ) : null}

      {/* ready: body + status badge top-right + info tooltip */}
      {state.status === "ready" ? (
        <>
          <div
            style={BADGE_TOP_RIGHT}
            data-testid={`health-card-${cardId}-status`}
            data-tone={status?.tone ?? "ok"}
            title={status?.tooltip}
          >
            {status?.tone === "ok" ? (
              <CheckCircle2 size={16} color={TONE_VAR.ok} aria-hidden="true" />
            ) : (
              <AlertCircle size={16} color={TONE_VAR[status?.tone ?? "warn"]} aria-hidden="true" />
            )}
            {/* Info-icon "what does this mean" — temporarily disabled.
                Tied to the Easy-mode-style help UX which is currently hidden;
                bring back together with Easy mode.
                <span
                  title={t("health.tooltip.what_does_this_mean")}
                  data-testid={`health-card-${cardId}-info`}
                  style={{ display: "inline-flex", cursor: "help", opacity: 0.7 }}
                >
                  <Info size={14} aria-hidden="true" />
                  <span className="sr-only">{t(explanationKey)}</span>
                </span> */}
          </div>
          <div data-testid={`health-card-${cardId}-body`}>{body}</div>
        </>
      ) : null}

      {/* empty: centered text from health.empty.${reason} */}
      {state.status === "empty" ? (
        <div
          style={{ ...CENTER_BLOCK, color: TONE_VAR.ok }}
          data-testid={`health-card-${cardId}-empty`}
        >
          {t(`health.empty.${state.reason}`)}
        </div>
      ) : null}

      {/* unavailable: install SQL + copy */}
      {state.status === "unavailable" ? (
        <div
          style={{ ...CENTER_BLOCK, color: TONE_VAR.warn }}
          data-testid={`health-card-${cardId}-unavailable`}
        >
          <strong>{t("health.unavailable.title", { extension: state.extension })}</strong>
          <code
            style={{
              display: "block",
              padding: "4px 6px",
              background: "var(--bg-2)",
              borderRadius: 4,
              fontSize: 11,
              maxWidth: "100%",
              overflow: "auto",
            }}
          >
            {state.installSql}
          </code>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => void copy(state.installSql)}
            data-testid={`health-card-${cardId}-copy`}
          >
            <Copy size={12} aria-hidden="true" /> {t("health.unavailable.copy")}
          </button>
        </div>
      ) : null}

      {/* forbidden: GRANT pg_monitor snippet + copy */}
      {state.status === "forbidden"
        ? (() => {
            const sql = `GRANT ${state.requiredRole} TO current_user;`;
            return (
              <div
                style={{ ...CENTER_BLOCK, color: TONE_VAR.warn }}
                data-testid={`health-card-${cardId}-forbidden`}
              >
                <strong>{t("health.forbidden.title")}</strong>
                <span>{t("health.forbidden.body", { required_role: state.requiredRole })}</span>
                <code
                  style={{
                    display: "block",
                    padding: "4px 6px",
                    background: "var(--bg-2)",
                    borderRadius: 4,
                    fontSize: 11,
                  }}
                >
                  {sql}
                </code>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => void copy(sql)}
                  data-testid={`health-card-${cardId}-copy`}
                >
                  <Copy size={12} aria-hidden="true" /> {t("health.forbidden.copy")}
                </button>
              </div>
            );
          })()
        : null}

      {/* error: details + retry */}
      {state.status === "error" ? (
        <div
          style={{ ...CENTER_BLOCK, color: TONE_VAR.danger }}
          data-testid={`health-card-${cardId}-error`}
        >
          <strong>{t("health.error.title")}</strong>
          <details style={{ width: "100%" }}>
            <summary style={{ cursor: "pointer", fontSize: 11 }}>
              {t("health.error.details")}
            </summary>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                marginTop: 4,
                whiteSpace: "pre-wrap",
                opacity: 0.8,
              }}
            >
              {state.message}
            </div>
          </details>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={retry}
            data-testid={`health-card-${cardId}-retry`}
          >
            <RotateCw size={12} aria-hidden="true" /> {t("health.error.retry")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
