// — Backup wizard (one-shot pg_dump).
//
// Pulls the connection display from `list_connections`, renders the shared
// BackupOptionsForm, shows a live "Command preview" under the form, and on
// Run subscribes to `backup:progress` events for the spawned job.

import { invoke } from "@tauri-apps/api/core";
import { type JSX, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { BackupOptionsForm } from "./BackupOptionsForm";
import { ProgressCard } from "./ProgressCard";
import { useBackup } from "./store";
import type { BackupOptions } from "./types";

type ConnectionInfo = {
  id: string;
  name: string;
  host: string;
  port: number;
  database: string;
};

function freshOpts(connectionId: string): BackupOptions {
  return {
    connectionId,
    format: "custom",
    scope: "both",
    outputPath: "",
    compressLevel: 5,
    includeSchemas: [],
    includeTables: [],
    excludeTableData: [],
    parallelJobs: null,
    includeCreateDb: false,
    noOwner: false,
  };
}

export function BackupWizard({ connectionId }: { connectionId: string }): JSX.Element {
  const { t } = useTranslation();
  const previewBackup = useBackup((s) => s.previewBackup);
  const runBackup = useBackup((s) => s.runBackup);
  const cancelJob = useBackup((s) => s.cancelJob);
  const subscribeJob = useBackup((s) => s.subscribeJob);
  const clearJob = useBackup((s) => s.clearJob);

  const [connection, setConnection] = useState<ConnectionInfo | null>(null);
  const [opts, setOpts] = useState<BackupOptions>(() => freshOpts(connectionId));
  const [previewArgs, setPreviewArgs] = useState<string[] | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Stable jobId for this wizard instance.
  const jobIdRef = useRef<string>(`backup-${connectionId}-${Date.now()}`);
  const job = useBackup((s) => s.jobs[jobIdRef.current]);

  // Resolve connection meta (name / host / db).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await invoke<ConnectionInfo[]>("list_connections");
        if (cancelled) return;
        setConnection(list.find((c) => c.id === connectionId) ?? null);
      } catch {
        // non-fatal — fall back to id only
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connectionId]);

  // Re-bind opts.connectionId when prop changes.
  useEffect(() => {
    setOpts((o) => ({ ...o, connectionId }));
  }, [connectionId]);

  // Live preview — debounce-ish via state diff. We deliberately depend only
  // on `opts` (and `previewBackup` for store identity); the inner closure
  // captures the latest opts via closure semantics.
  useEffect(() => {
    if (!opts.outputPath.trim()) {
      setPreviewArgs(null);
      setPreviewError(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const args = await previewBackup(opts);
        if (!cancelled) {
          setPreviewArgs(args);
          setPreviewError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setPreviewError((e as { message?: string }).message ?? String(e));
          setPreviewArgs(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [opts, previewBackup]);

  // Subscribe to progress events; release on unmount.
  useEffect(() => {
    const off = subscribeJob(jobIdRef.current);
    const id = jobIdRef.current;
    return () => {
      off();
      clearJob(id);
    };
  }, [subscribeJob, clearJob]);

  const onRun = async () => {
    try {
      await runBackup(jobIdRef.current, opts);
    } catch {
      // store already records failure
    }
  };

  const onCancel = () => {
    void cancelJob(jobIdRef.current);
  };

  const isRunning = job?.status === "running";
  const canRun = !isRunning && opts.outputPath.trim().length > 0;

  return (
    <form
      data-testid="backup-wizard"
      onSubmit={(e) => e.preventDefault()}
      style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 720 }}
    >
      {connection ? (
        <header
          style={{
            padding: 8,
            border: "1px solid var(--hairline)",
            borderRadius: 4,
            background: "var(--bg-elev)",
            fontSize: 12,
          }}
        >
          <div style={{ fontWeight: 600 }}>{connection.name}</div>
          <div style={{ color: "var(--ink-3)" }}>
            {connection.host}:{connection.port} / {connection.database}
          </div>
        </header>
      ) : null}

      <BackupOptionsForm value={opts} onChange={setOpts} hideConnection idPrefix="bk" />

      <section
        data-testid="backup-preview"
        style={{
          background: "var(--bg-elev)",
          border: "1px solid var(--hairline)",
          padding: 12,
          borderRadius: 4,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 12, fontWeight: 600 }}>{t("backup.preview.title")}</h3>
        {previewError ? (
          <div role="alert" style={{ color: "var(--err, #d33)", fontSize: 12, marginTop: 6 }}>
            {previewError}
          </div>
        ) : null}
        {previewArgs ? (
          <code
            style={{
              display: "block",
              marginTop: 6,
              fontSize: 12,
              fontFamily: "var(--font-mono-q, monospace)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
              color: "var(--ink-2)",
            }}
            data-testid="backup-preview-cmd"
          >
            pg_dump {previewArgs.join(" ")}
          </code>
        ) : (
          <div style={{ marginTop: 6, fontSize: 12, color: "var(--ink-3)" }}>
            {t("backup.preview.hint")}
          </div>
        )}
      </section>

      <ProgressCard job={job} onCancel={onCancel} />

      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          onClick={() => void onRun()}
          disabled={!canRun}
          data-testid="backup-run"
          aria-label={t("backup.run.start")}
        >
          {isRunning ? t("backup.run.in_progress") : t("backup.run.start")}
        </button>
      </div>
    </form>
  );
}
