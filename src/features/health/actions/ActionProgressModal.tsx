import * as Dialog from "@radix-ui/react-dialog";
import { RefreshCw } from "lucide-react";
import { type JSX, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "../../../components/Toast";
import { useHealthActions } from "./store";

/**
 * — running-phase modal. Renders a real progress bar for
 * `vacuum`/`reindexTable` (uses the snapshot's `percent`) and an indeterminate
 * spinner for everything else. The Cancel button only appears when the action
 * is long-running (vacuum/reindex) and a backend pid is known —
 * `abortLongRunning` will then issue a pg_cancel_backend.
 *
 * The non-running `kill_fallback` phase shows a second confirmation prompt
 * (type the pid) before issuing pg_terminate_backend.
 */
export function ActionProgressModal(): JSX.Element | null {
  const { t } = useTranslation();
  const toast = useToast();
  const phase = useHealthActions((s) => s.phase);
  const [typedPid, setTypedPid] = useState("");

  useEffect(() => {
    if (phase.kind === "kill_fallback") setTypedPid("");
  }, [phase]);

  if (phase.kind === "running") {
    const showBar = phase.target.kind === "vacuum" || phase.target.kind === "reindexTable";
    const percent = phase.progress?.percent ?? null;
    const phaseLabel = phase.progress?.phase ?? "starting";
    return (
      <Dialog.Root open onOpenChange={() => undefined}>
        <Dialog.Portal>
          <Dialog.Overlay className="confirm-overlay" />
          <Dialog.Content className="confirm-content" data-testid="action-progress-modal">
            <Dialog.Title>{t(`health.actions.running.${phase.target.kind}`)}</Dialog.Title>
            {showBar ? (
              <div className="progress-block">
                <div className="progress-bar-track">
                  <div
                    className="progress-bar-fill"
                    style={{
                      width: percent !== null ? `${percent.toFixed(0)}%` : "30%",
                    }}
                    data-indeterminate={percent === null ? "true" : "false"}
                    data-testid="action-progress-bar"
                  />
                </div>
                <div className="progress-meta">
                  <span>
                    {t(`health.actions.phase.${phaseLabel.replace(/\s+/g, "_")}`, {
                      defaultValue: phaseLabel,
                    })}
                  </span>
                  {percent !== null && <span>{percent.toFixed(0)}%</span>}
                </div>
              </div>
            ) : (
              <div className="indeterminate-spinner">
                <RefreshCw size={16} className="animate-spin" aria-hidden="true" />
                <span>{t("health.actions.running.indeterminate")}</span>
              </div>
            )}
            {showBar && phase.pid !== null && (
              <div className="confirm-actions">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => void useHealthActions.getState().abortLongRunning(toast)}
                >
                  {t("common.cancel")}
                </button>
              </div>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }

  if (phase.kind === "kill_fallback") {
    const ok = typedPid === String(phase.pid);
    return (
      <Dialog.Root open onOpenChange={(o) => (o ? null : useHealthActions.getState().cancel())}>
        <Dialog.Portal>
          <Dialog.Overlay className="confirm-overlay" />
          <Dialog.Content className="confirm-content" data-testid="action-fallback-modal">
            <Dialog.Title>{t("health.actions.fallback.title")}</Dialog.Title>
            <Dialog.Description>
              {t("health.actions.fallback.body", { pid: phase.pid })}
            </Dialog.Description>
            <input
              className="confirm-input"
              value={typedPid}
              onChange={(e) => setTypedPid(e.target.value)}
              placeholder={String(phase.pid)}
              aria-label={t("health.actions.confirm.inputLabel")}
              // biome-ignore lint/a11y/noAutofocus: confirm modal needs focus
              autoFocus
            />
            <div className="confirm-actions">
              <button type="button" onClick={() => useHealthActions.getState().cancel()}>
                {t("common.cancel")}
              </button>
              <button
                type="button"
                disabled={!ok}
                onClick={() => void useHealthActions.getState().confirmTerminate(toast)}
              >
                {t("health.actions.fallback.confirm")}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }

  return null;
}
