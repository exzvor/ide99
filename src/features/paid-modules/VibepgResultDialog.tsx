// — preview dialog for the "vibepg result" output.
//
// v1.0 stub: ide99 doesn't run the real measure-based optimization yet —
// that's deferred to v1.1 along with cloud connectivity. When `preview` is
// omitted we show a "Connecting to vibepg cloud…" spinner + a v1.1 note +
// a Cancel button. When `preview` is supplied (tests / future v1.1) we
// render the agent's iteration log + tested SQL / before+after plans /
// speedup / index size / recommendation, with an Apply button that
// (no-op for v1.0) routes the recommendation to the clipboard.

import { Loader2 } from "lucide-react";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";

import { Dialog } from "../../components/Dialog";

export type VibepgResultPreview = {
  tested: string;
  planBefore: string;
  planAfter: string;
  speedup: string;
  indexSize?: string;
  recommendation: "create" | "skip";
};

interface Props {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** When omitted, dialog renders a "Connecting…" stub (v1.0 default). */
  preview?: VibepgResultPreview;
  /**
   * Callback invoked when the user clicks "Apply to current connection".
   * Default behavior copies the tested SQL to clipboard if recommendation
   * is "create"; the prop lets host surfaces override (e.g. EXPLAIN may
   * want to inject the suggestion directly into the editor).
   */
  onApply?(preview: VibepgResultPreview): void | Promise<void>;
}

const STEPS = [
  "step_generate",
  "step_apply",
  "step_error",
  "step_refine",
  "step_retry",
  "step_success",
] as const;

export function VibepgResultDialog({ open, onOpenChange, preview, onApply }: Props): JSX.Element {
  const { t } = useTranslation();
  const isStub = preview === undefined;

  const handleApply = async (): Promise<void> => {
    if (!preview) return;
    if (onApply) {
      await onApply(preview);
      onOpenChange(false);
      return;
    }
    if (preview.recommendation === "create" && typeof navigator !== "undefined") {
      try {
        await navigator.clipboard.writeText(preview.tested);
      } catch {
        // ignore — clipboard may be denied; user can still copy manually.
      }
    }
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("paid_modules.vibepg.result_dialog.title")}
      size="lg"
      closeAriaLabel={t("paid_modules.vibepg.result_dialog.close")}
      footer={
        isStub ? (
          <button
            type="button"
            className="btn btn-ghost"
            data-testid="vibepg-result-cancel"
            onClick={() => onOpenChange(false)}
          >
            {t("paid_modules.vibepg.result_dialog.cancel")}
          </button>
        ) : (
          <>
            <button
              type="button"
              className="btn btn-ghost"
              data-testid="vibepg-result-cancel"
              onClick={() => onOpenChange(false)}
            >
              {t("paid_modules.vibepg.result_dialog.cancel")}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              data-testid="vibepg-result-apply"
              onClick={() => {
                void handleApply();
              }}
            >
              {t("paid_modules.vibepg.result_dialog.apply")}
            </button>
          </>
        )
      }
    >
      {isStub ? (
        <div
          data-testid="vibepg-result-stub"
          // biome-ignore lint/a11y/useSemanticElements: passive status banner
          role="status"
          aria-live="polite"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            alignItems: "center",
            padding: "24px 8px",
            textAlign: "center",
          }}
        >
          <Loader2
            size={20}
            aria-hidden="true"
            style={{ animation: "spin 1s linear infinite", color: "var(--accent, #6366f1)" }}
          />
          <div style={{ fontSize: 13, color: "var(--ink-2)" }}>
            {t("paid_modules.vibepg.result_dialog.connecting")}
          </div>
          <div style={{ fontSize: 12, color: "var(--ink-3)", maxWidth: 420 }}>
            {t("paid_modules.vibepg.result_dialog.v1_1_note")}
          </div>
        </div>
      ) : (
        <div
          data-testid="vibepg-result-content"
          style={{ display: "flex", flexDirection: "column", gap: 14 }}
        >
          <ol
            data-testid="vibepg-result-log"
            aria-label={t("paid_modules.vibepg.result_dialog.iteration_log")}
            style={{
              margin: 0,
              padding: "8px 12px",
              border: "1px solid var(--hairline)",
              borderRadius: 4,
              background: "var(--bg-elev)",
              listStylePosition: "inside",
              fontSize: 12,
              lineHeight: 1.7,
            }}
          >
            {STEPS.map((s, i) => (
              <li key={s} data-testid={`vibepg-step-${s}`}>
                {i < STEPS.length - 1
                  ? t(`paid_modules.vibepg.result_dialog.${s}`)
                  : t(`paid_modules.vibepg.result_dialog.${s}`)}
                {i < STEPS.length - 1 ? " →" : null}
              </li>
            ))}
          </ol>

          <dl
            style={{
              display: "grid",
              gridTemplateColumns: "auto 1fr",
              gap: "6px 12px",
              margin: 0,
              fontSize: 12,
            }}
          >
            <dt style={{ color: "var(--ink-3)" }}>
              {t("paid_modules.vibepg.result_dialog.field_tested")}
            </dt>
            <dd
              data-testid="vibepg-field-tested"
              style={{ margin: 0, fontFamily: "var(--font-mono-q, monospace)" }}
            >
              {preview.tested}
            </dd>

            <dt style={{ color: "var(--ink-3)" }}>
              {t("paid_modules.vibepg.result_dialog.field_plan_before")}
            </dt>
            <dd data-testid="vibepg-field-plan-before" style={{ margin: 0 }}>
              {preview.planBefore}
            </dd>

            <dt style={{ color: "var(--ink-3)" }}>
              {t("paid_modules.vibepg.result_dialog.field_plan_after")}
            </dt>
            <dd data-testid="vibepg-field-plan-after" style={{ margin: 0 }}>
              {preview.planAfter}
            </dd>

            <dt style={{ color: "var(--ink-3)" }}>
              {t("paid_modules.vibepg.result_dialog.field_speedup")}
            </dt>
            <dd
              data-testid="vibepg-field-speedup"
              style={{ margin: 0, fontWeight: 600, color: "var(--accent, #6366f1)" }}
            >
              {preview.speedup}
            </dd>

            {preview.indexSize ? (
              <>
                <dt style={{ color: "var(--ink-3)" }}>
                  {t("paid_modules.vibepg.result_dialog.field_index_size")}
                </dt>
                <dd data-testid="vibepg-field-index-size" style={{ margin: 0 }}>
                  {preview.indexSize}
                </dd>
              </>
            ) : null}

            <dt style={{ color: "var(--ink-3)" }}>
              {t("paid_modules.vibepg.result_dialog.field_recommendation")}
            </dt>
            <dd data-testid="vibepg-field-recommendation" style={{ margin: 0 }}>
              {preview.recommendation === "create"
                ? t("paid_modules.vibepg.result_dialog.recommendation_create")
                : t("paid_modules.vibepg.result_dialog.recommendation_skip")}
            </dd>
          </dl>
        </div>
      )}
    </Dialog>
  );
}
