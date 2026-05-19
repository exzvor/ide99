// — Schedule manager.
//
// List + add/edit drawer + install/uninstall + run-now per row. The add/edit
// drawer embeds the shared BackupOptionsForm so a schedule carries the same
// fidelity as a one-shot backup. Cron preview lives next to the cron field
// and updates on demand.

import { type JSX, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { BackupOptionsForm } from "./BackupOptionsForm";
import { useBackup } from "./store";
import type { BackupOptions, ScheduleEntry } from "./types";

function defaultOpts(connectionId: string): BackupOptions {
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

export function ScheduleManager({ connectionId }: { connectionId: string }): JSX.Element {
  const { t } = useTranslation();
  const schedules = useBackup((s) => s.schedules);
  const upsertSchedule = useBackup((s) => s.upsertSchedule);
  const removeSchedule = useBackup((s) => s.removeSchedule);
  const installSchedule = useBackup((s) => s.installSchedule);
  const uninstallSchedule = useBackup((s) => s.uninstallSchedule);
  const runScheduleNow = useBackup((s) => s.runScheduleNow);
  const previewCronLine = useBackup((s) => s.previewCronLine);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string>("");
  const [label, setLabel] = useState("");
  const [cron, setCron] = useState("0 3 * * *");
  const [opts, setOpts] = useState<BackupOptions>(() => defaultOpts(connectionId));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [runResult, setRunResult] = useState<string | null>(null);
  const [cronPreview, setCronPreview] = useState<string | null>(null);
  const [cronPreviewError, setCronPreviewError] = useState<string | null>(null);

  const editingExisting = useMemo(    () => schedules.find((s) => s.id === editingId) ?? null,
    [schedules, editingId],
);

  useEffect(() => {
    setOpts((o) => ({ ...o, connectionId }));
  }, [connectionId]);

  const openCreate = () => {
    setEditingId(`schedule-${Date.now()}`);
    setLabel("");
    setCron("0 3 * * *");
    setOpts(defaultOpts(connectionId));
    setError(null);
    setCronPreview(null);
    setDrawerOpen(true);
  };

  const openEdit = (entry: ScheduleEntry) => {
    setEditingId(entry.id);
    setLabel(entry.label);
    setCron(entry.cron);
    setOpts(entry.backup);
    setError(null);
    setCronPreview(null);
    setDrawerOpen(true);
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
    setEditingId("");
  };

  const onPreviewCron = async () => {
    setCronPreviewError(null);
    try {
      const line = await previewCronLine(editingId, cron, opts);
      setCronPreview(line);
    } catch (e) {
      setCronPreviewError((e as { message?: string }).message ?? String(e));
      setCronPreview(null);
    }
  };

  const onSave = async () => {
    setError(null);
    try {
      await upsertSchedule(editingId, label, cron, opts);
      closeDrawer();
    } catch (e) {
      setError((e as { message?: string }).message ?? String(e));
    }
  };

  const withBusy = (id: string, op: () => Promise<unknown>) => async () => {
    setBusy((b) => ({ ...b, [id]: true }));
    try {
      await op();
    } catch (e) {
      setError((e as { message?: string }).message ?? String(e));
    } finally {
      setBusy((b) => ({ ...b, [id]: false }));
    }
  };

  const onRunNow = (id: string) =>
    withBusy(id, async () => {
      const jobId = await runScheduleNow(id);
      setRunResult(jobId);
    });

  return (    <div
      style={{ display: "flex", flexDirection: "column", gap: 16 }}
      data-testid="schedule-manager"
    >
      <section>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            justifyContent: "space-between",
          }}
        >
          <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{t("backup.schedule.list")}</h3>
          <button type="button" onClick={openCreate} data-testid="schedule-add-open">
            {t("backup.schedule.add")}
          </button>
        </div>
        {error ? (          <div role="alert" style={{ color: "var(--err, #d33)", marginTop: 8, fontSize: 12 }}>
            {error}
          </div>
) : null}
        {runResult ? (          // biome-ignore lint/a11y/useSemanticElements: passive status banner
          <div
            role="status"
            data-testid="schedule-run-result"
            style={{ color: "var(--ink-3)", marginTop: 8, fontSize: 12 }}
          >
            {t("backup.schedule.run_started", { jobId: runResult })}
          </div>
) : null}

        {schedules.length === 0 ? (          <div style={{ color: "var(--ink-3)", padding: 12 }}>{t("backup.schedule.empty")}</div>
) : (          <ul
            style={{
              listStyle: "none",
              padding: 0,
              margin: 0,
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            {schedules.map((s) => (              <li
                key={s.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: 8,
                  border: "1px solid var(--hairline)",
                  borderRadius: 4,
                }}
                data-testid={`schedule-row-${s.id}`}
              >
                <span style={{ fontWeight: 600 }}>{s.label}</span>
                <code style={{ fontFamily: "var(--font-mono-q, monospace)" }}>{s.cron}</code>
                <span style={{ color: "var(--ink-3)", fontSize: 12 }}>{s.backup.outputPath}</span>
                {s.installed ? (                  <span
                    style={{
                      fontSize: 11,
                      padding: "1px 6px",
                      border: "1px solid var(--ok, #34c759)",
                      borderRadius: 3,
                      color: "var(--ok, #34c759)",
                    }}
                    data-testid={`schedule-installed-${s.id}`}
                  >
                    {t("backup.schedule.installed_badge")}
                  </span>
) : null}
                <div style={{ display: "flex", gap: 4, marginLeft: "auto" }}>
                  <button
                    type="button"
                    onClick={() => openEdit(s)}
                    data-testid={`schedule-edit-${s.id}`}
                    aria-label={t("backup.schedule.edit")}
                  >
                    {t("backup.schedule.edit")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void onRunNow(s.id)()}
                    disabled={busy[s.id]}
                    data-testid={`schedule-run-now-${s.id}`}
                    aria-label={t("backup.schedule.run_now")}
                  >
                    {t("backup.schedule.run_now")}
                  </button>
                  {s.installed ? (                    <button
                      type="button"
                      onClick={() => void withBusy(s.id, () => uninstallSchedule(s.id))()}
                      disabled={busy[s.id]}
                      data-testid={`schedule-uninstall-${s.id}`}
                      aria-label={t("backup.schedule.uninstall")}
                    >
                      {t("backup.schedule.uninstall")}
                    </button>
) : (                    <button
                      type="button"
                      onClick={() => void withBusy(s.id, () => installSchedule(s.id))()}
                      disabled={busy[s.id]}
                      data-testid={`schedule-install-${s.id}`}
                      aria-label={t("backup.schedule.install")}
                    >
                      {t("backup.schedule.install")}
                    </button>
)}
                  <button
                    type="button"
                    onClick={() => void removeSchedule(s.id)}
                    data-testid={`schedule-remove-${s.id}`}
                    aria-label={t("backup.schedule.remove")}
                  >
                    {t("backup.schedule.remove")}
                  </button>
                </div>
              </li>
))}
          </ul>
)}
      </section>

      {drawerOpen ? (        <section
          aria-label={
            editingExisting ? t("backup.schedule.edit_title") : t("backup.schedule.add_title")
          }
          style={{
            border: "1px solid var(--hairline)",
            borderRadius: 4,
            padding: 12,
            display: "flex",
            flexDirection: "column",
            gap: 12,
            background: "var(--bg-elev)",
          }}
          data-testid="schedule-drawer"
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <h4 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>
              {editingExisting ? t("backup.schedule.edit_title") : t("backup.schedule.add_title")}
            </h4>
            <button
              type="button"
              onClick={closeDrawer}
              style={{ marginLeft: "auto" }}
              aria-label={t("backup.schedule.close")}
              data-testid="schedule-drawer-close"
            >
              {t("backup.schedule.close")}
            </button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span>{t("backup.schedule.label")}</span>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                data-testid="schedule-label"
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span>{t("backup.schedule.cron")}</span>
              <input
                value={cron}
                onChange={(e) => setCron(e.target.value)}
                data-testid="schedule-cron"
                style={{ fontFamily: "var(--font-mono-q, monospace)" }}
              />
            </label>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              type="button"
              onClick={() => void onPreviewCron()}
              data-testid="schedule-preview-cron"
            >
              {t("backup.schedule.preview_cron")}
            </button>
            {cronPreview ? (              <code
                data-testid="schedule-cron-preview"
                style={{
                  fontFamily: "var(--font-mono-q, monospace)",
                  fontSize: 12,
                  color: "var(--ink-3)",
                }}
              >
                {cronPreview}
              </code>
) : null}
            {cronPreviewError ? (              <span role="alert" style={{ color: "var(--err, #d33)", fontSize: 12 }}>
                {cronPreviewError}
              </span>
) : null}
          </div>

          <BackupOptionsForm value={opts} onChange={setOpts} idPrefix="sched" hideConnection />

          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={() => void onSave()}
              disabled={!label || !cron || !opts.outputPath}
              data-testid="schedule-save"
            >
              {t("backup.schedule.save")}
            </button>
            <button type="button" onClick={closeDrawer} data-testid="schedule-cancel">
              {t("backup.schedule.cancel")}
            </button>
          </div>
        </section>
) : null}
    </div>
);
}
