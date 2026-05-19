import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { EasyAdvisory } from "./analyzer";

interface Props {
  open: boolean;
  /** Estimated EXPLAIN cost. Rounded for display. */
  cost: number;
  onCancel: () => void;
  /**
   * Fired when the user opts to run anyway. The boolean indicates whether the
   * "Don't ask again for this connection" checkbox was set, so the caller can
   * persist the suppression to backend state.
   */
  onProceed: (dontAskAgain: boolean) => void;
  /**
   * — when set, renders an Easy-mode advisory body (cross-join /
   * slow-preview) instead of the cost-based slow-query body. The "don't ask
   * again" checkbox is suppressed in this mode because Easy advisories are
   * a teaching tool, not a per-connection threshold.
   */
  advisory?: EasyAdvisory;
}

/**
 * — slow-query warning shown when the EXPLAIN total cost exceeds
 * the user's threshold. Non-blocking-feel: the user can dismiss with
 * a single click, optionally suppressing future warnings on this connection.
 *
 * — additionally surfaces Easy-mode advisories (cross-join /
 * slow-preview) when `advisory` is supplied; same proceed/cancel UX.
 */
export function SlowQueryWarningModal({ open, cost, onCancel, onProceed, advisory }: Props) {
  const { t } = useTranslation();
  const [dontAsk, setDontAsk] = useState(false);

  // Reset checkbox on each open so a previous "don't ask" tick doesn't bleed
  // over into the next time we surface this dialog.
  useEffect(() => {
    if (open) setDontAsk(false);
  }, [open]);

  const titleKey = advisory ? `safety.easy.${advisory.kind}.title` : "safety.slow.title";
  const bodyKey = advisory ? `safety.easy.${advisory.kind}.body` : "safety.slow.body";
  const bodyOpts =
    advisory?.kind === "cross-join"
      ? { tableCount: advisory.tableCount }
      : { cost: Math.round(cost) };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => (o ? null : onCancel())}>
      <Dialog.Portal>
        <Dialog.Overlay className="slow-overlay" />
        <Dialog.Content className="slow-content" aria-describedby="slow-desc">
          <Dialog.Title>{t(titleKey)}</Dialog.Title>
          <Dialog.Description id="slow-desc">{t(bodyKey, bodyOpts)}</Dialog.Description>
          {!advisory ? (
            <label className="slow-dont-ask">
              <input
                type="checkbox"
                checked={dontAsk}
                onChange={(e) => setDontAsk(e.target.checked)}
              />
              {t("safety.slow.dontAsk")}
            </label>
          ) : null}
          <div className="slow-actions">
            <button type="button" onClick={onCancel}>
              {t("common.cancel")}
            </button>
            <button type="button" onClick={() => onProceed(dontAsk)}>
              {t("safety.slow.runAnyway")}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
