/**
 * — small "Explain in plain English" button used next to PG
 * error messages in ResultPanel, ExplainErrorView and ApplyDialog.
 *
 * Decoupled from the modal via the `openErrorExplain` event dispatcher,
 * so each call-site doesn't need to wire props through.
 */

import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { type ErrorExplainPayload, openErrorExplain } from "./ErrorExplainModal";

export interface ErrorExplainButtonProps extends ErrorExplainPayload {
  /** Optional override of the visible label. Default: i18n key. */
  label?: string;
  /** Style variant. `inline` for compact (toolbar-ish), `block` for prominent. */
  variant?: "inline" | "block";
  className?: string;
  testId?: string;
}

export function ErrorExplainButton({
  sqlstate,
  message,
  sql,
  label,
  variant = "inline",
  className,
  testId,
}: ErrorExplainButtonProps): JSX.Element {
  const { t } = useTranslation();
  const cls = ["error-explain-button", variant, className].filter(Boolean).join(" ");
  return (
    <button
      type="button"
      className={cls}
      data-testid={testId ?? "error-explain-button"}
      onClick={() => openErrorExplain({ sqlstate, message, sql })}
    >
      {label ?? t("errorExplain.button")}
    </button>
  );
}
