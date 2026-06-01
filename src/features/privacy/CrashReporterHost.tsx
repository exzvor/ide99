import { type JSX, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { useToast } from "../../components/Toast";
import { CrashReportDialog } from "./CrashReportDialog";
import { useAppSettings } from "./store";
import type { CrashReport } from "./types";

/**
 * — global JS error listener + crash preview orchestrator.
 *
 * Mounted once at App root. Listens for `window.error` and
 * `unhandledrejection`, builds a sanitized `CrashReport` via
 * `crash_report_build` IPC, then shows `<CrashReportDialog>` so the
 * user explicitly approves before send.
 *
 * Only fires when both privacy_choice_made AND crash_reports_enabled
 * are true — otherwise the listener silently drops the event.
 */
const APP_VERSION =
  (import.meta as unknown as { env?: { VITE_APP_VERSION?: string } }).env?.VITE_APP_VERSION ??
  "0.1.0";

export function CrashReporterHost(): JSX.Element {
  const { t } = useTranslation();
  const toast = useToast();
  const settings = useAppSettings((s) => s.settings);
  const buildCrashReport = useAppSettings((s) => s.buildCrashReport);
  const sendCrashReport = useAppSettings((s) => s.sendCrashReport);

  const [report, setReport] = useState<CrashReport | null>(null);

  const armed = !!settings && settings.privacyChoiceMade && settings.crashReportsEnabled;

  const capture = useCallback(
    async (message: string, stack: string) => {
      if (!armed) return;
      try {
        const built = await buildCrashReport(message, stack, APP_VERSION);
        setReport(built);
      } catch {
        // Crash reporter must NEVER itself break the user flow.
      }
    },
    [armed, buildCrashReport],
  );

  useEffect(() => {
    if (!armed) return;
    const onError = (e: ErrorEvent) => {
      const msg = e.message || (e.error instanceof Error ? e.error.message : "Unknown error");
      const stack = e.error instanceof Error && e.error.stack ? e.error.stack : "";
      void capture(msg, stack);
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const reason = e.reason as unknown;
      const msg =
        reason instanceof Error
          ? reason.message
          : typeof reason === "string"
            ? reason
            : "Unhandled rejection";
      const stack = reason instanceof Error && reason.stack ? reason.stack : "";
      void capture(msg, stack);
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, [armed, capture]);

  const onApprove = useCallback(async () => {
    if (!report) return;
    try {
      await sendCrashReport(report);
      toast.success(t("privacy.crash.send.success"));
    } catch (e) {
      // The backend returns a distinct `not_configured` code when crash
      // reporting is enabled but no destination (DSN) is set — tell the user
      // that instead of implying the report was delivered. Anything else is a
      // genuine send failure.
      const code = (e as { code?: string } | null)?.code;
      if (code === "not_configured") {
        toast.info(t("privacy.crash.send.not_configured"));
      } else {
        toast.error(t("privacy.crash.send.error"));
      }
    } finally {
      setReport(null);
    }
  }, [report, sendCrashReport, toast, t]);

  const onCancel = useCallback(() => setReport(null), []);

  return (
    <CrashReportDialog
      open={!!report}
      report={report}
      onApprove={() => void onApprove()}
      onCancel={onCancel}
    />
  );
}
