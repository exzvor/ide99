import { type UnlistenFn, listen } from "@tauri-apps/api/event";
import { type JSX, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { useAppSettings } from "../privacy/store";
import type { ReleaseChannel } from "../privacy/types";
import { useUpdater } from "./store";
import type { ProgressEvent } from "./types";

/**
 * — Settings → Updates section.
 *
 * Phase E (full):
 *
 * * Channel selector — `<select>` for stable / beta / nightly, wired
 * through `settings_set` to persist `app_settings.release_channel`.
 * The Tauri updater plugin reads endpoints from `tauri.conf.json` at
 * boot time, so changing the channel in settings only takes effect on
 * the next `Check for updates` invocation (manifest URL is built
 * server-side per channel).
 *
 * * Approve / Defer flow — when the backend reports `Available`, we
 * show the manifest's release notes (rendered as a plain `<pre>`
 * to avoid an external markdown dep) and two buttons. **No automatic
 * install.** Approve is the only path that calls
 * `updater_install_pending`.
 *
 * * Progress — once Approve is clicked, we subscribe to
 * `updater:progress` events emitted by the Rust side. The progress
 * bar reads `bytesDownloaded` / `bytesTotal` and shows a textual
 * phase label.
 */
export function UpdateChecker(): JSX.Element {
  const { t } = useTranslation();

  // Updater store — acts as the source of truth for "what was the last
  // check result" and "are we currently installing".
  const currentVersion = useUpdater((s) => s.currentVersion);
  const lastResult = useUpdater((s) => s.lastResult);
  const checking = useUpdater((s) => s.checking);
  const installing = useUpdater((s) => s.installing);
  const progress = useUpdater((s) => s.progress);
  const decision = useUpdater((s) => s.decision);
  const loadCurrentVersion = useUpdater((s) => s.loadCurrentVersion);
  const check = useUpdater((s) => s.check);
  const installPending = useUpdater((s) => s.installPending);
  const setProgress = useUpdater((s) => s.setProgress);
  const setDecision = useUpdater((s) => s.setDecision);

  // Privacy store — owns the persistent `releaseChannel` field.
  const settings = useAppSettings((s) => s.settings);
  const setSettings = useAppSettings((s) => s.setSettings);
  const channel = settings?.releaseChannel ?? "stable";

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadCurrentVersion();
  }, [loadCurrentVersion]);

  // Subscribe to backend progress events the moment we kick off an
  // install. Unsubscribe when the component unmounts OR when the
  // installer reports `done` — keeping at most one listener.
  useEffect(() => {
    if (!installing) return;
    let unlisten: UnlistenFn | null = null;
    let cancelled = false;
    void (async () => {
      try {
        unlisten = await listen<ProgressEvent>("updater:progress", (evt) => {
          setProgress(evt.payload);
        });
        if (cancelled) {
          unlisten();
        }
      } catch (e) {
        // Listener wiring is best-effort; failure shouldn't break the install.
        // eslint-disable-next-line no-console -- diagnostic only
        console.warn("updater:progress listen failed", e);
      }
    })();
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, [installing, setProgress]);

  const handleCheck = async () => {
    setError(null);
    try {
      await check();
    } catch (e) {
      setError(String(e));
    }
  };

  const handleApprove = async () => {
    setError(null);
    try {
      await installPending();
    } catch (e) {
      setError(String(e));
    }
  };

  const handleDefer = () => {
    setDecision("deferred");
  };

  const handleChannelChange = async (next: ReleaseChannel) => {
    if (!settings) return;
    await setSettings({ ...settings, releaseChannel: next });
  };

  const progressLabel = useMemo(() => formatProgress(progress, t), [progress, t]);

  return (    <section
      data-testid="update-checker"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: 12,
        border: "1px solid var(--hairline)",
        borderRadius: 4,
        background: "var(--bg-elev)",
      }}
    >
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{t("updater.title")}</h3>
        <button
          type="button"
          onClick={() => void handleCheck()}
          disabled={checking || installing}
          data-testid="updater-check"
        >
          {checking ? t("updater.checking") : t("updater.check_now")}
        </button>
      </header>

      <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
        {currentVersion
          ? t("updater.current_version", { version: currentVersion })
          : t("updater.loading")}
      </div>

      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
        <span style={{ color: "var(--ink-2)" }}>{t("updater.channel.label")}</span>
        <select
          data-testid="updater-channel"
          value={channel}
          disabled={!settings || installing}
          onChange={(e) => void handleChannelChange(e.target.value as ReleaseChannel)}
        >
          <option value="stable">{t("updater.channel.stable")}</option>
          <option value="beta">{t("updater.channel.beta")}</option>
          <option value="nightly">{t("updater.channel.nightly")}</option>
        </select>
      </label>

      {lastResult ? (        <div data-testid={`updater-result-${lastResult.kind}`} style={{ fontSize: 12 }}>
          {lastResult.kind === "upToDate" ? (            <span style={{ color: "var(--ok, #2a7)" }}>
              {t("updater.up_to_date", { version: lastResult.currentVersion })}
            </span>
) : null}

          {lastResult.kind === "available" ? (            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span style={{ color: "var(--accent, #6366f1)", fontWeight: 600 }}>
                {t("updater.available", {
                  from: lastResult.currentVersion,
                  to: lastResult.manifest.version,
                })}
              </span>

              {lastResult.manifest.notes ? (                <details data-testid="updater-release-notes" open>
                  <summary style={{ cursor: "pointer", fontSize: 12 }}>
                    {t("updater.release_notes")}
                  </summary>
                  <pre
                    style={{
                      margin: "8px 0 0",
                      padding: 8,
                      fontSize: 11,
                      lineHeight: 1.5,
                      background: "var(--bg-base)",
                      border: "1px solid var(--hairline)",
                      borderRadius: 4,
                      whiteSpace: "pre-wrap",
                      maxHeight: 240,
                      overflow: "auto",
                    }}
                  >
                    {lastResult.manifest.notes}
                  </pre>
                </details>
) : null}

              {decision === "approved" || installing ? (                <div data-testid="updater-progress" style={{ fontSize: 12 }}>
                  <ProgressBar
                    bytesDownloaded={progress?.bytesDownloaded ?? 0}
                    bytesTotal={progress?.bytesTotal ?? null}
                  />
                  <div style={{ marginTop: 4, color: "var(--ink-2)" }}>{progressLabel}</div>
                </div>
) : decision === "deferred" ? (                <div data-testid="updater-deferred" style={{ color: "var(--ink-3)" }}>
                  {t("updater.deferred")}
                </div>
) : (                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    data-testid="updater-approve"
                    onClick={() => void handleApprove()}
                    disabled={installing}
                  >
                    {installing ? t("updater.installing") : t("updater.approve")}
                  </button>
                  <button type="button" data-testid="updater-defer" onClick={handleDefer}>
                    {t("updater.defer")}
                  </button>
                </div>
)}
            </div>
) : null}

          {lastResult.kind === "error" ? (            <span role="alert" style={{ color: "var(--err, #d33)" }}>
              {t("updater.error", { message: lastResult.message })}
            </span>
) : null}
        </div>
) : null}

      {error ? (        <div
          role="alert"
          data-testid="updater-error"
          style={{ color: "var(--err, #d33)", fontSize: 12 }}
        >
          {error}
        </div>
) : null}
    </section>
);
}

function ProgressBar({
  bytesDownloaded,
  bytesTotal,
}: {
  bytesDownloaded: number;
  bytesTotal: number | null;
}): JSX.Element {
  const pct =
    bytesTotal && bytesTotal > 0
      ? Math.min(100, Math.round((bytesDownloaded / bytesTotal) * 100))
      : null;
  return (    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct ?? undefined}
      data-testid="updater-progress-bar"
      style={{
        width: "100%",
        height: 6,
        background: "var(--bg-base)",
        borderRadius: 3,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          height: "100%",
          width: pct === null ? "30%" : `${pct}%`,
          background: "var(--accent, #6366f1)",
          transition: "width 120ms linear",
        }}
      />
    </div>
);
}

function formatProgress(  progress: ProgressEvent | null,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  if (!progress) return t("updater.progress.started");
  switch (progress.phase) {
    case "started":
      return t("updater.progress.started");
    case "downloading":
      if (progress.bytesTotal && progress.bytesTotal > 0) {
        const percent = Math.min(          100,
          Math.round((progress.bytesDownloaded / progress.bytesTotal) * 100),
);
        return t("updater.progress.downloading", { percent });
      }
      return t("updater.progress.downloading_unknown", {
        kb: Math.round(progress.bytesDownloaded / 1024),
      });
    case "installing":
      return t("updater.progress.installing");
    case "done":
      return t("updater.progress.done");
    default:
      return "";
  }
}
