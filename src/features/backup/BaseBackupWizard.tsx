// — pg_basebackup wizard.
//
// Cluster-level physical backup. Output is a directory; optional incremental
// chain via parent backup_manifest. Compression dropdown maps to the
// pg_basebackup `--compress` flag.

import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { type JSX, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { ProgressCard } from "./ProgressCard";
import { useBackup } from "./store";
import type { BaseBackupCompression, BaseBackupOptions } from "./types";

type ConnectionInfo = {
  id: string;
  name: string;
  host: string;
  port: number;
  database: string;
};

export function BaseBackupWizard({ connectionId }: { connectionId: string }): JSX.Element {
  const { t } = useTranslation();
  const previewBaseBackup = useBackup((s) => s.previewBaseBackup);
  const runBaseBackup = useBackup((s) => s.runBaseBackup);
  const cancelJob = useBackup((s) => s.cancelJob);
  const subscribeJob = useBackup((s) => s.subscribeJob);
  const clearJob = useBackup((s) => s.clearJob);

  const [connection, setConnection] = useState<ConnectionInfo | null>(null);
  const [outputDir, setOutputDir] = useState("");
  const [compression, setCompression] = useState<BaseBackupCompression>("none");
  const [incrementalEnabled, setIncrementalEnabled] = useState(false);
  const [incrementalManifest, setIncrementalManifest] = useState("");
  const [previewArgs, setPreviewArgs] = useState<string[] | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const jobIdRef = useRef<string>(`basebackup-${connectionId}-${Date.now()}`);
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

  const opts = useMemo<BaseBackupOptions>(
    () => ({
      connectionId,
      outputDir,
      compression,
      incrementalFromManifest:
        incrementalEnabled && incrementalManifest.trim() ? incrementalManifest : null,
    }),
    [connectionId, outputDir, compression, incrementalEnabled, incrementalManifest],
  );

  useEffect(() => {
    if (!outputDir.trim()) {
      setPreviewArgs(null);
      setPreviewError(null);
      return;
    }
    if (incrementalEnabled && !incrementalManifest.trim()) {
      // Required when incremental is on — surface inline error, skip preview.
      setPreviewArgs(null);
      setPreviewError(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const args = await previewBaseBackup(opts);
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
  }, [previewBaseBackup, opts, outputDir, incrementalEnabled, incrementalManifest]);

  const onBrowseDir = async () => {
    try {
      const picked = await openDialog({ directory: true, multiple: false });
      if (typeof picked === "string" && picked) setOutputDir(picked);
      else if (Array.isArray(picked) && picked[0]) setOutputDir(picked[0]);
    } catch {
      // cancelled
    }
  };

  const onBrowseManifest = async () => {
    try {
      const picked = await openDialog({
        directory: false,
        multiple: false,
        filters: [{ name: "Manifest", extensions: ["json"] }],
      });
      if (typeof picked === "string" && picked) setIncrementalManifest(picked);
      else if (Array.isArray(picked) && picked[0]) setIncrementalManifest(picked[0]);
    } catch {
      // cancelled
    }
  };

  const onRun = async () => {
    try {
      await runBaseBackup(jobIdRef.current, opts);
    } catch {
      // failure recorded
    }
  };

  const incrementalMissing = incrementalEnabled && !incrementalManifest.trim();
  const isRunning = job?.status === "running";
  const canRun = !isRunning && outputDir.trim().length > 0 && !incrementalMissing;

  return (
    <form
      data-testid="basebackup-wizard"
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
            {connection.host}:{connection.port}
          </div>
        </header>
      ) : null}

      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span>{t("backup.basebackup.output_dir")}</span>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="text"
            value={outputDir}
            onChange={(e) => setOutputDir(e.target.value)}
            placeholder="/var/backups/base"
            data-testid="basebackup-output-dir"
            style={{ flex: 1 }}
          />
          <button
            type="button"
            onClick={() => void onBrowseDir()}
            data-testid="basebackup-browse-dir"
            aria-label={t("backup.field.browse")}
          >
            {t("backup.field.browse")}
          </button>
        </div>
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span>{t("backup.basebackup.compression")}</span>
        <select
          value={compression}
          onChange={(e) => setCompression(e.target.value as BaseBackupCompression)}
          data-testid="basebackup-compression"
        >
          <option value="none">{t("backup.basebackup.compression_none")}</option>
          <option value="gzip">gzip</option>
          <option value="lz4">lz4</option>
          <option value="zstd">zstd</option>
        </select>
      </label>

      <fieldset
        style={{
          border: "1px solid var(--hairline)",
          borderRadius: 4,
          padding: 8,
          margin: 0,
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        <legend style={{ fontSize: 12, fontWeight: 600, padding: "0 4px" }}>
          {t("backup.basebackup.incremental")}
        </legend>
        <span style={{ fontSize: 11, color: "var(--ink-3)" }}>
          {t("backup.basebackup.incremental_hint")}
        </span>
        <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 12 }}>
          <input
            type="checkbox"
            checked={incrementalEnabled}
            onChange={(e) => setIncrementalEnabled(e.target.checked)}
            data-testid="basebackup-incremental-toggle"
          />
          <span>{t("backup.basebackup.incremental_enable")}</span>
        </label>
        {incrementalEnabled ? (
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="text"
              value={incrementalManifest}
              onChange={(e) => setIncrementalManifest(e.target.value)}
              placeholder="/var/backups/base/backup_manifest"
              required
              aria-required="true"
              aria-invalid={incrementalMissing}
              data-testid="basebackup-manifest"
              style={{ flex: 1 }}
            />
            <button
              type="button"
              onClick={() => void onBrowseManifest()}
              data-testid="basebackup-manifest-browse"
              aria-label={t("backup.field.browse")}
            >
              {t("backup.field.browse")}
            </button>
          </div>
        ) : null}
        {incrementalMissing ? (
          <div role="alert" style={{ color: "var(--err, #d33)", fontSize: 12 }}>
            {t("backup.basebackup.manifest_required")}
          </div>
        ) : null}
      </fieldset>

      <section
        data-testid="basebackup-preview"
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
            }}
            data-testid="basebackup-preview-cmd"
          >
            pg_basebackup {previewArgs.join(" ")}
          </code>
        ) : (
          <div style={{ marginTop: 6, fontSize: 12, color: "var(--ink-3)" }}>
            {t("backup.preview.hint")}
          </div>
        )}
      </section>

      <ProgressCard job={job} onCancel={() => void cancelJob(jobIdRef.current)} />

      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          onClick={() => void onRun()}
          disabled={!canRun}
          data-testid="basebackup-run"
          aria-label={t("backup.run.start")}
        >
          {isRunning ? t("backup.run.in_progress") : t("backup.run.start")}
        </button>
      </div>
    </form>
  );
}
