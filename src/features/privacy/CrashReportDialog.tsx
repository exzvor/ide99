import type { JSX } from "react";
import { useTranslation } from "react-i18next";

import { Dialog } from "../../components/Dialog";
import type { CrashReport } from "./types";

/**
 * — Crash preview modal (acceptance criterion #2).
 *
 * Shown when an uncaught exception fires AND the user has previously
 * opted into crash reports. The user previews the captured stack +
 * system info, then explicitly approves or cancels. Nothing is sent
 * automatically — that's the privacy guarantee.
 *
 *md §6.
 */
export interface CrashReportDialogProps {
  open: boolean;
  report: CrashReport | null;
  onApprove: () => void;
  onCancel: () => void;
}

export function CrashReportDialog({
  open,
  report,
  onApprove,
  onCancel,
}: CrashReportDialogProps): JSX.Element | null {
  const { t } = useTranslation();
  if (!report) return null;
  return (    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
      title={t("privacy.crash.dialog.title")}
      description={t("privacy.crash.dialog.preview_header")}
      size="lg"
      closeAriaLabel={t("common.cancel")}
      footer={
        <>
          <button
            type="button"
            onClick={onCancel}
            data-testid="crash-cancel"
            className="btn-secondary"
          >
            {t("privacy.crash.dialog.cancel")}
          </button>
          <button
            type="button"
            onClick={onApprove}
            data-testid="crash-approve"
            className="btn-primary"
            style={{ fontWeight: 600 }}
          >
            {t("privacy.crash.dialog.approve")}
          </button>
        </>
      }
    >
      <div
        data-testid="crash-report-dialog"
        style={{ display: "flex", flexDirection: "column", gap: 12, padding: "0 28px 16px" }}
      >
        <dl
          style={{
            display: "grid",
            gridTemplateColumns: "max-content 1fr",
            gap: "4px 12px",
            margin: 0,
            fontSize: 12,
          }}
        >
          <dt style={{ color: "var(--ink-3)" }}>{t("privacy.crash.dialog.field_message")}</dt>
          <dd style={{ margin: 0, color: "var(--ink-1)", fontWeight: 500 }}>{report.message}</dd>
          <dt style={{ color: "var(--ink-3)" }}>{t("privacy.crash.dialog.field_platform")}</dt>
          <dd style={{ margin: 0, color: "var(--ink-2)" }}>{report.platform}</dd>
          <dt style={{ color: "var(--ink-3)" }}>{t("privacy.crash.dialog.field_app_version")}</dt>
          <dd style={{ margin: 0, color: "var(--ink-2)" }}>{report.appVersion}</dd>
          <dt style={{ color: "var(--ink-3)" }}>{t("privacy.crash.dialog.field_captured_at")}</dt>
          <dd style={{ margin: 0, color: "var(--ink-2)" }}>{report.capturedAt}</dd>
        </dl>

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span
            style={{
              fontSize: 11,
              color: "var(--ink-3)",
              textTransform: "uppercase",
              letterSpacing: 0.4,
            }}
          >
            {t("privacy.crash.dialog.field_stack")}
          </span>
          <pre
            data-testid="crash-stack"
            style={{
              margin: 0,
              padding: 12,
              background: "var(--bg-base, #111)",
              color: "var(--ink-1)",
              fontFamily: "var(--font-mono, monospace)",
              fontSize: 11,
              lineHeight: 1.5,
              borderRadius: 4,
              border: "1px solid var(--hairline)",
              maxHeight: 240,
              overflow: "auto",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {report.stack || t("privacy.crash.dialog.stack_empty")}
          </pre>
        </div>

        <p style={{ margin: 0, fontSize: 11, color: "var(--ink-3)" }}>
          {t("privacy.crash.dialog.footer")}
        </p>
      </div>
    </Dialog>
);
}
