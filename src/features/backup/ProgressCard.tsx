// — shared progress / result card for the three wizards. Reads
// `JobState` from the backup store and renders phase + percent + cancel
// (running) or success/failure banner (terminal).

import type { JSX } from "react";
import { useTranslation } from "react-i18next";

import type { JobState } from "./store";

interface Props {
  job: JobState | undefined;
  onCancel: () => void;
}

export function ProgressCard({ job, onCancel }: Props): JSX.Element | null {
  const { t } = useTranslation();
  if (!job || job.status === "idle") return null;

  const phaseLabel = job.phase
    ? t(`backup.progress.phase.${job.phase}`, { defaultValue: job.phase })
    : null;

  if (job.status === "running") {
    return (      <section
        data-testid="backup-progress-card"
        // biome-ignore lint/a11y/useSemanticElements: passive status banner
        role="status"
        aria-live="polite"
        style={{
          border: "1px solid var(--hairline)",
          borderRadius: 4,
          padding: 12,
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <strong>{t("backup.run.in_progress")}</strong>
          <span style={{ color: "var(--ink-3)", fontSize: 12 }}>
            {phaseLabel ?? t("backup.progress.phase.starting")}
            {job.detail ? ` — ${job.detail}` : ""}
          </span>
          <button
            type="button"
            onClick={onCancel}
            data-testid="backup-cancel"
            aria-label={t("backup.run.cancel")}
            style={{ marginLeft: "auto" }}
          >
            {t("backup.run.cancel")}
          </button>
        </div>
        {job.percent != null ? (          <div
            role="progressbar"
            tabIndex={-1}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={job.percent}
            aria-label={t("backup.run.in_progress")}
            style={{
              width: "100%",
              background: "var(--bg-elev)",
              border: "1px solid var(--hairline)",
              borderRadius: 4,
              height: 8,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${job.percent}%`,
                height: "100%",
                background: "var(--accent, #3b82f6)",
              }}
              data-testid="backup-progress-bar"
            />
          </div>
) : null}
      </section>
);
  }

  if (job.status === "cancelled") {
    return (      <section
        data-testid="backup-progress-card"
        role="alert"
        style={{
          border: "1px solid var(--hairline)",
          borderRadius: 4,
          padding: 12,
        }}
      >
        {t("backup.run.cancelled")}
      </section>
);
  }

  if (job.status === "done") {
    return (      <section
        data-testid="backup-progress-card"
        // biome-ignore lint/a11y/useSemanticElements: passive status banner
        role="status"
        style={{
          border: "1px solid var(--ok, #34c759)",
          background: "var(--ok-bg, rgba(52,199,89,0.08))",
          borderRadius: 4,
          padding: 12,
          fontSize: 13,
        }}
      >
        <strong>{t("backup.run.success")}</strong>
        {job.outputPath ? (          <div style={{ marginTop: 4, fontSize: 12, color: "var(--ink-3)" }}>
            {t("backup.run.output_path", { path: job.outputPath })}
          </div>
) : null}
      </section>
);
  }

  // failed
  return (    <section
      data-testid="backup-progress-card"
      role="alert"
      style={{
        border: "1px solid var(--err, #d33)",
        background: "var(--err-bg, rgba(211,51,51,0.08))",
        borderRadius: 4,
        padding: 12,
        fontSize: 13,
      }}
    >
      <strong>{t("backup.run.failure")}</strong>
      {job.stderrTail ? (        <pre
          style={{
            marginTop: 6,
            fontFamily: "var(--font-mono-q, monospace)",
            fontSize: 12,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            maxHeight: 160,
            overflow: "auto",
          }}
        >
          {job.stderrTail}
        </pre>
) : null}
    </section>
);
}
