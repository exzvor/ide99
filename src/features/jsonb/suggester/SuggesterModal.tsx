/**
 * — GIN Index Suggester modal.
 *
 * Opens in column-scoped mode: calls `jsonb_suggester_run` with
 * `{ kind: "column", ... }` on first render, shows the top suggestion,
 * rationale, optional size estimate, collapsible HypoPG speedup section,
 * and action buttons.
 *
 * Layout per spec §6.2. Graceful-degradation per spec §7.1.
 */

import { type JSX, useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { HypoPgEstimate, OpClass, SuggesterResult, Suggestion } from "../../../lib/tauri";
import { jsonbSuggesterHypotheticalExplain, jsonbSuggesterRun } from "../../../lib/tauri";
import { useEditor } from "../../editor/store";
import { HypoPgEstimate as HypoPgEstimateComponent } from "./HypoPgEstimate";

export interface SuggesterModalProps {
  open: boolean;
  connId: string;
  fqn: { schema: string; table: string; column: string };
  onClose: () => void;
}

// ─── helpers ────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function opClassLabel(opClass: OpClass): string {
  switch (opClass.kind) {
    case "jsonbOps":
      return "jsonb_ops";
    case "jsonbPathOps":
      return "jsonb_path_ops";
    case "expression":
      return opClass.expr;
  }
}

function opClassBenefitKey(opClass: OpClass): string {
  switch (opClass.kind) {
    case "jsonbOps":
      return "jsonb.suggester.rationale.jsonbOpsBenefit";
    case "jsonbPathOps":
      return "jsonb.suggester.rationale.jsonbPathOpsBenefit";
    case "expression":
      return "jsonb.suggester.rationale.expressionBenefit";
  }
}

// ─── inner components ────────────────────────────────────────────────────────

interface SuggestionBodyProps {
  connId: string;
  suggestion: Suggestion;
  onClose: () => void;
}

function SuggestionBody({ connId, suggestion, onClose }: SuggestionBodyProps): JSX.Element {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [hypoPgState, setHypoPgState] = useState<{ kind: "loading" } | HypoPgEstimate | null>(null);
  // Track whether we've already fired the IPC for this modal-open lifetime.
  const hypoPgFiredRef = useRef(false);

  const opLabel = opClassLabel(suggestion.opClass);
  const benefitKey = opClassBenefitKey(suggestion.opClass);

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(suggestion.recommendedSql).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [suggestion.recommendedSql]);

  const handleOpenInEditor = useCallback(() => {
    useEditor.getState().openEditorTab(connId, { prefillSql: suggestion.recommendedSql });
    onClose();
  }, [connId, suggestion.recommendedSql, onClose]);

  // Fires HypoPG IPC at most once per modal-open lifetime (on details expand).
  const handleSpeedupToggle = useCallback(    (e: React.SyntheticEvent<HTMLDetailsElement>) => {
      const details = e.currentTarget;
      if (details.open && !hypoPgFiredRef.current) {
        hypoPgFiredRef.current = true;
        setHypoPgState({ kind: "loading" });
        jsonbSuggesterHypotheticalExplain({
          connId,
          recommendedSql: suggestion.recommendedSql,
          representativeQuery: suggestion.representativeQuery ?? "",
        })
          .then((result) => setHypoPgState(result))
          .catch((err) => {
            setHypoPgState({
              kind: "unavailable",
              reason: {
                kind: "plannerError",
                message: err instanceof Error ? err.message : String(err),
              },
            });
          });
      }
    },
    [connId, suggestion.recommendedSql, suggestion.representativeQuery],
);

  const opsText =
    suggestion.rationale.kind === "mined" ? suggestion.rationale.opsSeen.join(" / ") : "";

  return (    <div data-testid="suggester-modal-body">
      {/* Recommended index */}
      <section style={{ marginBottom: 16 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            textTransform: "uppercase",
            opacity: 0.7,
            letterSpacing: 0.3,
            marginBottom: 6,
          }}
        >
          {t("jsonb.suggester.recommendedHeader")}
        </div>
        <pre
          data-testid="suggester-recommended-sql"
          style={{
            margin: 0,
            padding: "10px 14px",
            background: "var(--bg-sunken, var(--bg-2))",
            border: "1px solid var(--hairline)",
            borderRadius: 6,
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
          }}
        >
          {suggestion.recommendedSql}
        </pre>
      </section>

      {/* Why <opClass> */}
      <section style={{ marginBottom: 16 }}>
        <div
          style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}
          data-testid="suggester-rationale-header"
        >
          {t("jsonb.suggester.rationale.header", { opClass: opLabel })}
        </div>
        <ul
          style={{
            margin: 0,
            padding: "0 0 0 18px",
            fontSize: 13,
            lineHeight: "1.6",
          }}
        >
          {suggestion.rationale.kind === "mined" ? (            <li data-testid="suggester-rationale-mined">
              {t("jsonb.suggester.rationale.minedSummary", {
                calls: suggestion.rationale.calls.toLocaleString(),
                time: formatMs(suggestion.rationale.totalExecTimeMs),
                ops: opsText,
              })}
            </li>
) : (            <li data-testid="suggester-rationale-generic">
              {t("jsonb.suggester.rationaleGeneric")}
            </li>
)}
          <li data-testid="suggester-rationale-benefit">
            {t(benefitKey, {
              ops:
                suggestion.opClass.kind === "jsonbOps"
                  ? opsText || "containment operators"
                  : suggestion.opClass.kind === "expression"
                    ? suggestion.opClass.expr
                    : "",
            })}
          </li>
        </ul>
      </section>

      {/* Estimated index size (conditional) */}
      {suggestion.estimatedSizeBytes != null ? (        <div style={{ marginBottom: 12, fontSize: 13 }} data-testid="suggester-size-estimate">
          <span style={{ fontWeight: 600 }}>{t("jsonb.suggester.sizeEstimateLabel")}</span>{" "}
          {t("jsonb.suggester.sizeEstimateValue", {
            size: formatBytes(suggestion.estimatedSizeBytes),
          })}
        </div>
) : null}

      {/* Estimated speedup (collapsible) */}
      <details
        style={{ marginBottom: 12 }}
        data-testid="suggester-speedup-details"
        onToggle={handleSpeedupToggle}
      >
        <summary
          style={{
            cursor: "pointer",
            fontWeight: 600,
            fontSize: 13,
            userSelect: "none",
          }}
          data-testid="suggester-speedup-summary"
        >
          {t("jsonb.suggester.speedupLabel")}
        </summary>
        <div
          style={{ marginTop: 8, fontSize: 13, paddingLeft: 4 }}
          data-testid="suggester-speedup-content"
        >
          {hypoPgState !== null ? <HypoPgEstimateComponent state={hypoPgState} /> : null}
        </div>
      </details>

      {/* Representative query (conditional) */}
      {suggestion.representativeQuery != null ? (        <section style={{ marginBottom: 16 }} data-testid="suggester-representative-query">
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
            {t("jsonb.suggester.representativeQueryLabel")}
          </div>
          <pre
            style={{
              margin: 0,
              padding: "6px 10px",
              background: "var(--bg-sunken, var(--bg-2))",
              border: "1px solid var(--hairline)",
              borderRadius: 4,
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
              opacity: 0.85,
            }}
          >
            {suggestion.representativeQuery}
          </pre>
        </section>
) : null}

      {/* Action buttons */}
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 8,
          paddingTop: 4,
        }}
      >
        <button
          type="button"
          className="btn btn-ghost"
          data-testid="suggester-copy-btn"
          onClick={handleCopy}
        >
          {copied ? (            <span data-testid="suggester-copied-badge" style={{ color: "var(--accent)" }}>
              {t("jsonb.suggester.actions.copied")}
            </span>
) : (            t("jsonb.suggester.actions.copy")
)}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          data-testid="suggester-open-in-editor-btn"
          onClick={handleOpenInEditor}
        >
          {t("jsonb.suggester.actions.openInEditor")}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          data-testid="suggester-close-btn"
          onClick={onClose}
        >
          {t("jsonb.suggester.actions.close")}
        </button>
      </div>
    </div>
);
}

/** Format milliseconds as a human-friendly time string */
function formatMs(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

// ─── SuggesterModal ──────────────────────────────────────────────────────────

export function SuggesterModal({
  open,
  connId,
  fqn,
  onClose,
}: SuggesterModalProps): JSX.Element | null {
  const { t } = useTranslation();
  const titleId = useId();

  type LoadState =
    | { status: "loading" }
    | { status: "ready"; result: SuggesterResult }
    | { status: "error"; message: string };

  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });

  // Fetch on open; re-fetch if fqn or connId changes while open.
  const doFetch = useCallback(() => {
    setLoadState({ status: "loading" });
    jsonbSuggesterRun(connId, {
      kind: "column",
      schema: fqn.schema,
      table: fqn.table,
      column: fqn.column,
    })
      .then((result) => setLoadState({ status: "ready", result }))
      .catch((err) => {
        setLoadState({
          status: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      });
  }, [connId, fqn.schema, fqn.table, fqn.column]);

  useEffect(() => {
    if (!open) return;
    doFetch();
  }, [open, doFetch]);

  // Esc closes.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const title = t("jsonb.suggester.title", {
    table: fqn.table,
    column: fqn.column,
  });

  // The first suggestion is shown in column-scoped mode.
  const suggestion =
    loadState.status === "ready" && loadState.result.suggestions.length > 0
      ? loadState.result.suggestions[0]
      : null;

  return (    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-testid="suggester-modal"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* Backdrop */}
      <div
        aria-hidden="true"
        data-testid="suggester-backdrop"
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(15,17,21,0.45)",
          backdropFilter: "blur(6px)",
        }}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        data-testid="suggester-panel"
        style={{
          position: "relative",
          zIndex: 1,
          background: "var(--bg-elev, var(--bg-2))",
          border: "1px solid var(--hairline)",
          borderRadius: 10,
          boxShadow: "0 8px 40px rgba(0,0,0,0.35)",
          width: "min(640px, 92vw)",
          maxHeight: "88vh",
          overflow: "auto",
          padding: "20px 24px",
        }}
      >
        {/* Header row */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            marginBottom: 16,
          }}
        >
          <h2
            id={titleId}
            style={{
              margin: 0,
              fontSize: 15,
              fontWeight: 600,
              lineHeight: 1.4,
            }}
            data-testid="suggester-title"
          >
            {title}
          </h2>
          <button
            type="button"
            aria-label={t("jsonb.suggester.actions.close")}
            className="btn-icon"
            data-testid="suggester-close-x-btn"
            style={{ flexShrink: 0, marginLeft: 12 }}
            onClick={onClose}
          >
            ×
          </button>
        </div>

        {/* Loading */}
        {loadState.status === "loading" ? (          <div
            data-testid="suggester-loading"
            style={{ padding: "32px 0", textAlign: "center", opacity: 0.7 }}
            aria-live="polite"
          >
            {t("jsonb.suggester.speedupComputing")}
          </div>
) : null}

        {/* Error — /006: localized error block, no raw error JSON */}
        {loadState.status === "error" ? (          <div data-testid="suggester-error" role="alert">
            <p
              style={{
                color: "var(--accent-strong-danger, red)",
                marginTop: 0,
              }}
            >
              {loadState.message}
            </p>
            <button
              type="button"
              className="btn btn-ghost"
              data-testid="suggester-retry-btn"
              onClick={doFetch}
            >
              {t("jsonb.suggester.actions.retry")}
            </button>
          </div>
) : null}

        {/* Ready */}
        {loadState.status === "ready" && suggestion !== null ? (          <SuggestionBody connId={connId} suggestion={suggestion} onClose={onClose} />
) : null}

        {/* Ready but empty suggestions — generic fallback banner */}
        {loadState.status === "ready" && suggestion === null ? (          <div data-testid="suggester-no-suggestion" style={{ fontSize: 13, opacity: 0.8 }}>
            {t("jsonb.suggester.extensions.pgStatStatementsRequiredColumn")}
          </div>
) : null}
      </div>
    </div>
);
}
