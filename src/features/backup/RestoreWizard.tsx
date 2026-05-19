// — Restore wizard (pg_restore).
//
// Source-file picker + standard pg_restore flags, with a destructive
// type-to-confirm gate when "clean before restore" is enabled. Selective
// restore via parsed `pg_restore --list` is deferred (Phase F) — // has not exposed the list-mode IPC, so we surface a comment in the UI.

import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { type JSX, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { TypingConfirmModal } from "../../components/TypingConfirmModal";
import { ProgressCard } from "./ProgressCard";
import { useBackup } from "./store";
import type { RestoreOptions } from "./types";

type ConnectionInfo = {
  id: string;
  name: string;
  host: string;
  port: number;
  database: string;
};

const RESTORE_TOKEN = "RESTORE";

export function RestoreWizard({ connectionId }: { connectionId: string }): JSX.Element {
  const { t } = useTranslation();
  const previewRestore = useBackup((s) => s.previewRestore);
  const runRestore = useBackup((s) => s.runRestore);
  const cancelJob = useBackup((s) => s.cancelJob);
  const subscribeJob = useBackup((s) => s.subscribeJob);
  const clearJob = useBackup((s) => s.clearJob);

  const [connection, setConnection] = useState<ConnectionInfo | null>(null);
  const [sourcePath, setSourcePath] = useState("");
  const [clean, setClean] = useState(false);
  const [createDb, setCreateDb] = useState(false);
  const [noOwner, setNoOwner] = useState(false);
  const [parallelJobs, setParallelJobs] = useState<number | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [previewArgs, setPreviewArgs] = useState<string[] | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const jobIdRef = useRef<string>(`restore-${connectionId}-${Date.now()}`);
  const job = useBackup((s) => s.jobs[jobIdRef.current]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await invoke<ConnectionInfo[]>("list_connections");
        if (cancelled) return;
        setConnection(list.find((c) => c.id === connectionId) ?? null);
      } catch {
        // non-fatal
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connectionId]);

  useEffect(() => {
    const off = subscribeJob(jobIdRef.current);
    const id = jobIdRef.current;
    return () => {
      off();
      clearJob(id);
    };
  }, [subscribeJob, clearJob]);

  const opts = useMemo<RestoreOptions>(    () => ({
      connectionId,
      sourcePath,
      cleanBeforeRestore: clean,
      createDatabase: createDb,
      noOwner,
      parallelJobs,
      selectedObjects: [],
    }),
    [connectionId, sourcePath, clean, createDb, noOwner, parallelJobs],
);

  useEffect(() => {
    if (!sourcePath.trim()) {
      setPreviewArgs(null);
      setPreviewError(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const args = await previewRestore(opts);
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
  }, [previewRestore, opts, sourcePath]);

  const onBrowse = async () => {
    try {
      const picked = await openDialog({
        directory: false,
        multiple: false,
        filters: [{ name: "Backup", extensions: ["dump", "sql", "tar", "bin"] }],
      });
      if (typeof picked === "string" && picked) setSourcePath(picked);
      else if (Array.isArray(picked) && picked[0]) setSourcePath(picked[0]);
    } catch {
      // cancelled
    }
  };

  const performRun = async () => {
    try {
      await runRestore(jobIdRef.current, opts);
    } catch {
      // failure recorded in store
    }
  };

  const onRunClick = () => {
    if (clean) {
      setConfirmOpen(true);
      return;
    }
    void performRun();
  };

  const isRunning = job?.status === "running";
  const canRun = !isRunning && sourcePath.trim().length > 0;

  return (    <form
      data-testid="restore-wizard"
      onSubmit={(e) => e.preventDefault()}
      style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 720 }}
    >
      {connection ? (        <header
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

      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span>{t("backup.field.source_path")}</span>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="text"
            value={sourcePath}
            onChange={(e) => setSourcePath(e.target.value)}
            placeholder="/tmp/dump.bin"
            data-testid="restore-source-path"
            style={{ flex: 1 }}
          />
          <button
            type="button"
            onClick={() => void onBrowse()}
            data-testid="restore-browse"
            aria-label={t("backup.field.browse")}
          >
            {t("backup.field.browse")}
          </button>
        </div>
      </label>

      <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 13 }}>
        <input
          type="checkbox"
          checked={clean}
          onChange={(e) => setClean(e.target.checked)}
          data-testid="restore-clean"
        />
        <span>{t("backup.field.clean_before_restore")}</span>
        <span style={{ color: "var(--err, #d33)", fontSize: 11 }}>
          {t("backup.field.clean_warning")}
        </span>
      </label>

      <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 13 }}>
        <input
          type="checkbox"
          checked={createDb}
          onChange={(e) => setCreateDb(e.target.checked)}
          data-testid="restore-create-db"
        />
        <span>{t("backup.field.create_database")}</span>
      </label>

      <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 13 }}>
        <input
          type="checkbox"
          checked={noOwner}
          onChange={(e) => setNoOwner(e.target.checked)}
          data-testid="restore-no-owner"
        />
        <span>{t("backup.field.no_owner")}</span>
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span>{t("backup.field.parallel_jobs")}</span>
        <input
          type="number"
          min={1}
          max={32}
          value={parallelJobs ?? ""}
          onChange={(e) => {
            const n = Number(e.target.value);
            setParallelJobs(Number.isFinite(n) && n > 0 ? n : null);
          }}
          data-testid="restore-parallel"
          aria-label={t("backup.field.parallel_jobs")}
        />
      </label>

      {/* Selective-restore note ('t expose --list IPC). */}
      <div style={{ fontSize: 11, color: "var(--ink-3)" }}>
        {t("backup.restore.selective_deferred")}
      </div>

      <section
        data-testid="restore-preview"
        style={{
          background: "var(--bg-elev)",
          border: "1px solid var(--hairline)",
          padding: 12,
          borderRadius: 4,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 12, fontWeight: 600 }}>{t("backup.preview.title")}</h3>
        {previewError ? (          <div role="alert" style={{ color: "var(--err, #d33)", fontSize: 12, marginTop: 6 }}>
            {previewError}
          </div>
) : null}
        {previewArgs ? (          <code
            style={{
              display: "block",
              marginTop: 6,
              fontSize: 12,
              fontFamily: "var(--font-mono-q, monospace)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
            }}
            data-testid="restore-preview-cmd"
          >
            pg_restore {previewArgs.join(" ")}
          </code>
) : (          <div style={{ marginTop: 6, fontSize: 12, color: "var(--ink-3)" }}>
            {t("backup.preview.hint")}
          </div>
)}
      </section>

      <ProgressCard job={job} onCancel={() => void cancelJob(jobIdRef.current)} />

      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          onClick={onRunClick}
          disabled={!canRun}
          data-testid="restore-run"
          aria-label={t("backup.run.start")}
        >
          {isRunning ? t("backup.run.in_progress") : t("backup.run.start")}
        </button>
      </div>

      {confirmOpen ? (        <TypingConfirmModal
          title={t("backup.restore.confirm_title")}
          description={t("backup.restore.confirm_body", {
            target: connection?.database ?? connectionId,
          })}
          expectedToken={RESTORE_TOKEN}
          inputLabel={t("backup.restore.confirm_input_label", { token: RESTORE_TOKEN })}
          confirmLabel={t("backup.restore.confirm_apply")}
          cancelLabel={t("backup.restore.confirm_cancel")}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => {
            setConfirmOpen(false);
            void performRun();
          }}
        />
) : null}
    </form>
);
}
