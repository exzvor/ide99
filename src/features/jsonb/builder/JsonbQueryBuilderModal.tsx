/**
 * — JSONB Query Builder modal.
 *
 * Two-pane layout:
 * Left  — InferredSchemaPanel (picker mode)
 * Right — OperatorForm + Generated SQL (read-only textarea) + actions
 */

import { type JSX, useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useEditor } from "../../editor/store";
import { InferredSchemaPanel } from "../panels/InferredSchemaPanel";
import { OperatorForm } from "./OperatorForm";
import { generateLocalPreview } from "./sqlGenerator";
import { builderReducer, deriveOp, initialState } from "./state";

import type { BuilderPreview, BuilderRequest, Fqn, PathSegment } from "../../../lib/tauri";
import { jsonbBuilderPreview } from "../../../lib/tauri";

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

export interface JsonbQueryBuilderModalProps {
  open: boolean;
  connId: string;
  fqn: Fqn;
  onClose: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

export function JsonbQueryBuilderModal(props: JsonbQueryBuilderModalProps): JSX.Element | null {
  const { open, connId, fqn, onClose } = props;
  const { t } = useTranslation();

  // ── Local reducer state ───────────────────────────────────────────────────
  const [state, dispatch] = useReducer(builderReducer, undefined, initialState);

  // ── Preview state ─────────────────────────────────────────────────────────
  const [preview, setPreview] = useState<BuilderPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Latest-call cancellation pattern
  const latestCallId = useRef(0);

  // ── Reset when modal opens ────────────────────────────────────────────────
  const prevOpen = useRef(false);
  useEffect(() => {
    if (open && !prevOpen.current) {
      // Fresh open — reset form
      dispatch({ type: "SET_OP", opKind: "existence" });
      dispatch({ type: "SET_PATH", path: [] });
      setPreview(null);
      setPreviewError(null);
      setPreviewLoading(false);
      latestCallId.current = 0;
    }
    prevOpen.current = open;
  }, [open]);

  // ── Debounced IPC preview ─────────────────────────────────────────────────
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const schedulePreview = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    // Don't run preview at all when path is empty
    if (state.selectedPath.length === 0) {
      setPreview(null);
      setPreviewError(null);
      setPreviewLoading(false);
      return;
    }

    const op = deriveOp(state);
    const req = {
      connId,
      fqn,
      op,
      path: state.selectedPath,
      value: state.value,
    };

    // Instant best-effort preview from TS mirror
    const localPrev = generateLocalPreview(req as unknown as BuilderRequest);
    if (localPrev !== null) {
      setPreview(localPrev);
      setPreviewError(null);
    }

    debounceRef.current = setTimeout(() => {
      const callId = ++latestCallId.current;
      setPreviewLoading(true);

      jsonbBuilderPreview(req as unknown as BuilderRequest).then(
        (result) => {
          if (callId !== latestCallId.current) return;
          setPreview(result);
          setPreviewError(null);
          setPreviewLoading(false);
        },
        (err: unknown) => {
          if (callId !== latestCallId.current) return;
          const message = err instanceof Error ? err.message : String(err);
          setPreviewError(message);
          setPreviewLoading(false);
        },
      );
    }, 150);
  }, [connId, fqn, state]);

  // Re-run whenever form state changes (only when modal is open)
  useEffect(() => {
    if (!open) return;
    schedulePreview();
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [open, schedulePreview]);

  // ── Esc key handler ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  // ── Focus management ──────────────────────────────────────────────────────
  const firstFocusRef = useRef<HTMLSelectElement | null>(null);
  useEffect(() => {
    if (open) {
      // Defer to let the DOM paint
      const timer = setTimeout(() => {
        firstFocusRef.current?.focus();
      }, 30);
      return () => clearTimeout(timer);
    }
  }, [open]);

  // ── Generate handler ──────────────────────────────────────────────────────
  const handleGenerate = useCallback(() => {
    if (!preview || previewError) return;
    useEditor.getState().openEditorTab(connId, { prefillSql: preview.sql });
    onClose();
  }, [preview, previewError, connId, onClose]);

  // ─────────────────────────────────────────────────────────────────────────
  if (!open) return null;

  const titleId = "jsonb-builder-title";
  // Generate requires a non-empty path + valid preview
  const canGenerate =
    state.selectedPath.length > 0 && preview !== null && previewError === null && !previewLoading;

  const sqlPreviewText =
    state.selectedPath.length === 0
      ? t("jsonb.builder.pathPlaceholder")
      : previewLoading
        ? `${t("jsonb.builder.previewLabel")}…`
        : previewError
          ? t("jsonb.builder.error.invalidJson", { message: previewError })
          : preview
            ? preview.sql
            : "";

  const handlePathSelect = (path: PathSegment[]) => {
    dispatch({ type: "SET_PATH", path });
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: real focus-trap modal
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-testid="jsonb-builder-modal"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(15,17,21,0.55)",
      }}
      onMouseDown={(e) => {
        // Close on backdrop click
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: "var(--bg-elev, #1a1d23)",
          border: "1px solid var(--hairline, rgba(255,255,255,0.08))",
          borderRadius: 12,
          boxShadow: "0 8px 48px rgba(0,0,0,0.6)",
          width: "min(960px, 96vw)",
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 20px",
            borderBottom: "1px solid var(--hairline)",
            flexShrink: 0,
          }}
        >
          <h2
            id={titleId}
            style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "var(--ink-1)" }}
          >
            {t("jsonb.builder.title", { table: fqn.table, column: fqn.column })}
          </h2>
          <button
            type="button"
            aria-label={t("jsonb.builder.actions.cancel")}
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--ink-3)",
              fontSize: 16,
              lineHeight: 1,
              padding: "2px 6px",
            }}
          >
            ×
          </button>
        </div>

        {/* Body: two-pane layout */}
        <div
          style={{
            flex: 1,
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            minHeight: 0,
            overflow: "hidden",
          }}
        >
          {/* Left pane — InferredSchemaPanel picker */}
          <div
            style={{
              borderRight: "1px solid var(--hairline)",
              overflowY: "auto",
              padding: "12px 12px",
              maxHeight: "calc(90vh - 160px)",
            }}
          >
            <InferredSchemaPanel
              connId={connId}
              fqn={fqn}
              variant="modal"
              onPathSelect={handlePathSelect}
              selectedPath={state.selectedPath}
            />
          </div>

          {/* Right pane — form + preview */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              padding: "16px 20px",
              overflowY: "auto",
              maxHeight: "calc(90vh - 160px)",
              gap: 12,
            }}
          >
            <OperatorForm connId={connId} fqn={fqn} state={state} dispatch={dispatch} />

            {/* Warnings from backend */}
            {preview && preview.warnings.length > 0 && (
              <div>
                {preview.warnings.map((w, i) => (
                  <div
                    // biome-ignore lint/suspicious/noArrayIndexKey: stable warning list
                    key={i}
                    role="note"
                    style={{ color: "var(--accent-strong-warning, #b88a00)", fontSize: 11 }}
                  >
                    {w.kind === "pathTooDeep"
                      ? t("jsonb.builder.warning.pathTooDeep", { limit: w.limit })
                      : t("jsonb.builder.warning.existenceTopLevel")}
                  </div>
                ))}
              </div>
            )}

            {/* SQL preview */}
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-3)" }}>
                {t("jsonb.builder.previewLabel")}
              </div>
              <textarea
                readOnly
                aria-label={t("jsonb.builder.previewLabel")}
                aria-live="polite"
                data-testid="builder-sql-preview"
                value={sqlPreviewText}
                rows={6}
                style={{
                  fontFamily: "var(--font-mono-q, monospace)",
                  fontSize: 12,
                  background: "var(--bg-sunken)",
                  border: "1px solid var(--hairline)",
                  borderRadius: 4,
                  padding: "6px 8px",
                  color: previewError ? "var(--accent-strong-danger)" : "var(--ink-2)",
                  resize: "vertical",
                  width: "100%",
                  boxSizing: "border-box",
                }}
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            padding: "12px 20px",
            borderTop: "1px solid var(--hairline)",
            flexShrink: 0,
          }}
        >
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {t("jsonb.builder.actions.cancel")}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canGenerate}
            onClick={handleGenerate}
            data-testid="builder-generate-btn"
          >
            {t("jsonb.builder.actions.generate")}
          </button>
        </div>
      </div>
    </div>
  );
}
