import * as Dialog from "@radix-ui/react-dialog";
import { type JSX, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "../../../components/Toast";
import { buildPreview } from "./preview";
import { useHealthActions } from "./store";

/**
 * — preview modal for non-explain actions. Renders SQL + impact;
 * gates the Run button behind a type-the-target input on prod (always) or on
 * dev/stage when `conn.confirmDestructive` is true.
 *
 * Lifecycle:
 * - Mounted once at the bottom of HealthPane.
 * - Self-renders only when `useHealthActions.phase.kind === "preview"` and the
 * target is non-explain (explain skips preview and opens an editor tab).
 */
export function ActionPreviewModal(): JSX.Element | null {
  const { t } = useTranslation();
  const toast = useToast();
  const phase = useHealthActions((s) => s.phase);
  const [typed, setTyped] = useState("");

  useEffect(() => {
    if (phase.kind === "preview") setTyped("");
  }, [phase]);

  if (phase.kind !== "preview") return null;
  if (phase.target.kind === "explain") return null;

  const preview = buildPreview(phase.target);
  const env = phase.conn.environment;
  const requiresType =
    env === "prod" || ((env === "dev" || env === "stage") && phase.conn.confirmDestructive);
  const ok = !requiresType || typed === preview.confirmTarget;

  return (
    <Dialog.Root open onOpenChange={(o) => (o ? null : useHealthActions.getState().cancel())}>
      <Dialog.Portal>
        <Dialog.Overlay className="confirm-overlay" />
        <Dialog.Content className="confirm-content" data-testid="action-preview-modal">
          <Dialog.Title>{t(`health.actions.title.${phase.target.kind}`)}</Dialog.Title>
          <code className="action-sql-block">{preview.sql}</code>
          <p className="action-impact">{t(preview.impact, preview.impactArgs)}</p>
          {requiresType && (
            <>
              <Dialog.Description>
                {t("health.actions.confirm.body", {
                  target: preview.confirmTarget,
                  environment: env,
                })}
              </Dialog.Description>
              <input
                className="confirm-input"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={preview.confirmTarget}
                aria-label={t("health.actions.confirm.inputLabel")}
                // biome-ignore lint/a11y/noAutofocus: confirm modal needs focus
                autoFocus
              />
            </>
          )}
          <div className="confirm-actions">
            <button type="button" onClick={() => useHealthActions.getState().cancel()}>
              {t("common.cancel")}
            </button>
            <button
              type="button"
              data-testid="action-preview-run"
              disabled={!ok}
              onClick={() => void useHealthActions.getState().runAction(toast)}
            >
              {t(`health.actions.run.${phase.target.kind}`)}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
