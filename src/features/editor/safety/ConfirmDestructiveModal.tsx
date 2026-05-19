import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConceptTooltip } from "../../concept-tooltips";

interface Props {
  open: boolean;
  /** Display label for the dangerous verb — "DROP" | "TRUNCATE" | "DELETE" | "UPDATE". */
  action: string;
  /** Object name to type for confirmation, or a literal token like "delete-all". */
  target: string;
  /** Connection environment label — "local" | "dev" | "stage" | "prod". */
  environment: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * — type-the-target confirmation dialog for destructive statements.
 *
 * The Confirm button stays disabled until the user types `target` exactly
 * (case-sensitive). For WHERE-less DELETE / UPDATE the caller passes a
 * literal token ("delete-all" / "update-all") so the user has to consciously
 * acknowledge the no-WHERE shape.
 */
export function ConfirmDestructiveModal({
  open,
  action,
  target,
  environment,
  onConfirm,
  onCancel,
}: Props) {
  const { t } = useTranslation();
  const [typed, setTyped] = useState("");
  const ok = typed === target;

  // Reset typed text whenever the modal re-opens or the target changes so the
  // input doesn't survive across two consecutive prompts (different DROPs).
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-running when target changes is intentional even within a single open cycle.
  useEffect(() => {
    if (open) setTyped("");
  }, [open, target]);

  return (    <Dialog.Root open={open} onOpenChange={(o) => (o ? null : onCancel())}>
      <Dialog.Portal>
        <Dialog.Overlay className="confirm-overlay" />
        <Dialog.Content className="confirm-content" aria-describedby="confirm-desc">
          <Dialog.Title>{t("safety.confirm.title", { action, target })}</Dialog.Title>
          <Dialog.Description id="confirm-desc">
            {t("safety.confirm.body", { action, target, environment })}
          </Dialog.Description>
          {/*
            — surface a Concept tooltip on the word "transaction"
            so Easy mode users learn what running a destructive statement
            implies. In Standard mode `<ConceptTooltip>` is a no-op wrapper
            so the diff is invisible to existing users.
          */}
          <div
            style={{ marginTop: 4, fontSize: 11, color: "var(--ink-4)" }}
            data-testid="confirm-transaction-hint"
          >
            {t("conceptTooltip.transactionHint")}{" "}
            <ConceptTooltip id="transaction">
              <span>transaction</span>
            </ConceptTooltip>
            .
          </div>
          <input
            className="confirm-input"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={target}
            // biome-ignore lint/a11y/noAutofocus: confirm modal needs focus
            autoFocus
            aria-label={t("safety.confirm.inputLabel")}
          />
          <div className="confirm-actions">
            <button type="button" onClick={onCancel}>
              {t("common.cancel")}
            </button>
            <button type="button" onClick={onConfirm} disabled={!ok}>
              {t("safety.confirm.confirmButton")}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
);
}
