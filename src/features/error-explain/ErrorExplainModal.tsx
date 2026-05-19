/**
 * — modal showing plain-English (EN/RU) explanation of a PG
 * error, with optional suggested fix and AskAgentBlock fallback.
 *
 * Driven imperatively via [`useErrorExplainModal`] — every error-display
 * surface (ResultPanel, ExplainErrorView, ApplyDialog) calls
 * `open({ sqlstate, message, sql })` from its "Explain in plain English"
 * button. One modal instance is mounted at App-level (see [`ErrorExplainModalHost`]).
 */

import { type JSX, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog } from "../../components/Dialog";
import { AskAgentBlock } from "./AskAgentBlock";
import { type ExplanationResult, explainError, pickLocale } from "./lookup";

export interface ErrorExplainPayload {
  sqlstate?: string | null;
  message: string;
  /** Optional SQL excerpt — used by AskAgentBlock when copying context. */
  sql?: string | null;
}

const EVT = "ide99:error-explain";

/** Imperative API — call from anywhere to open the modal. */
export function openErrorExplain(payload: ErrorExplainPayload): void {
  window.dispatchEvent(new CustomEvent<ErrorExplainPayload>(EVT, { detail: payload }));
}

export function ErrorExplainModalHost(): JSX.Element | null {
  const { t, i18n } = useTranslation();
  const [payload, setPayload] = useState<ErrorExplainPayload | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<ErrorExplainPayload>).detail;
      if (detail) setPayload(detail);
    };
    window.addEventListener(EVT, handler);
    return () => window.removeEventListener(EVT, handler);
  }, []);

  if (!payload) return null;

  const result: ExplanationResult | null = explainError({
    sqlstate: payload.sqlstate,
    message: payload.message,
  });

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) setPayload(null);
      }}
      title={t("errorExplain.title")}
      description={
        result?.matchedCode
          ? t("errorExplain.codeLabel", { code: result.matchedCode })
          : payload.sqlstate
            ? t("errorExplain.codeLabel", { code: payload.sqlstate })
            : undefined
      }
      size="lg"
      footer={
        <button type="button" onClick={() => setPayload(null)} data-testid="error-explain-close">
          {t("errorExplain.close")}
        </button>
      }
    >
      <div className="error-explain-body">
        <section className="error-explain-original">
          <h4>{t("errorExplain.originalMessage")}</h4>
          <pre>{payload.message}</pre>
        </section>

        {result ? (
          <>
            <section className="error-explain-explanation">
              <h4>
                {result.classFallback
                  ? t("errorExplain.classExplanationHeading")
                  : t("errorExplain.explanationHeading")}
              </h4>
              <p>{pickLocale(result.explanation, i18n.language)}</p>
            </section>
            {result.suggestedFix ? (
              <section className="error-explain-fix">
                <h4>{t("errorExplain.suggestedFix")}</h4>
                <p>{pickLocale(result.suggestedFix, i18n.language)}</p>
              </section>
            ) : null}
            {result.classFallback ? (
              <AskAgentBlock
                sqlstate={payload.sqlstate}
                message={payload.message}
                sql={payload.sql}
              />
            ) : null}
          </>
        ) : (
          <AskAgentBlock sqlstate={payload.sqlstate} message={payload.message} sql={payload.sql} />
        )}
      </div>
    </Dialog>
  );
}
