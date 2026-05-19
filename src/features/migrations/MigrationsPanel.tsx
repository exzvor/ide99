/**
 * — 
 *
 * Top-level container for the Migrations tab. Composition:
 *
 * ┌─────────────────────────────────────────────────────────────┐
 * │ Directory: …             [Change…]  [Clear]                 │
 * │ ☑ Tracking table   ☐ Snapshots                              │
 * │ ─────────────────────────────────────────────────────────── │
 * │ [Apply All] [Apply Single] [Apply Range] [Rollback] [Diff]  │
 * │ ─────────────────────────────────────────────────────────── │
 * │ Timeline                                                    │
 * └─────────────────────────────────────────────────────────────┘
 *
 * Side effects:
 * - On mount + connectionId change: invoke `migrations_list`.
 * - Subscribe to `migrations:dir-changed` (re-fetch on match).
 * - Subscribe to `migrations:apply-progress` and
 * `migrations:rollback-progress` (status banner).
 *
 * The dialog children (Apply / Rollback / Diff) are gated by simple
 * local boolean state — modal stack stays flat.
 */

import { invoke } from "@tauri-apps/api/core";
import { type UnlistenFn, listen } from "@tauri-apps/api/event";
import { type JSX, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog } from "../../components/Dialog";
import { localizeMigrationError } from "../../lib/errors";
import { useConnections } from "../connections/store";
import { ApplyDialog } from "./ApplyDialog";
import { DiffViewer } from "./DiffViewer";
import { DirectorySelector } from "./DirectorySelector";
import { RollbackDialog } from "./RollbackDialog";
import { Timeline } from "./Timeline";
import { EmptyStateInstall } from "./squawk/EmptyStateInstall";
import { type SquawkFinding, useLintStore } from "./squawk/lintStore";
import { type Migration, useMigrationsStore } from "./store";

interface Props {
  connectionId: string;
}

type ListResult = {
  migrations: Migration[];
  trackingTableMissing: boolean;
  // �� backend now returns the persisted dir + toggles so the
  // panel can hydrate its zustand store on mount (which previously just
  // showed "Not set" after restart even though SQLite had the dir).
  migrationsDir: string | null;
  trackingEnabled: boolean;
  snapshotsEnabled: boolean;
};

type ProgressPayload = {
  connId: string;
  version: string;
  phase: "running" | "done" | "failed";
  durationMs?: number;
};

type DirChangedPayload = { connId: string };

export function MigrationsPanel(props: Props): JSX.Element {
  const { t } = useTranslation();
  const { connectionId } = props;

  const connection = useConnections((s) => s.connections.find((c) => c.id === connectionId));

  const migrations = useMigrationsStore((s) => s.migrations);
  const selectedVersion = useMigrationsStore((s) => s.selectedVersion);
  const migrationsDir = useMigrationsStore((s) => s.migrationsDir);
  const trackingEnabled = useMigrationsStore((s) => s.trackingEnabled);
  const snapshotsEnabled = useMigrationsStore((s) => s.snapshotsEnabled);
  const trackingTableMissing = useMigrationsStore((s) => s.trackingTableMissing);
  const setMigrations = useMigrationsStore((s) => s.setMigrations);
  const setStoreDir = useMigrationsStore((s) => s.setDir);
  const clearStoreDir = useMigrationsStore((s) => s.clearDir);
  const setOptions = useMigrationsStore((s) => s.setOptions);
  const select = useMigrationsStore((s) => s.select);

  const [listError, setListError] = useState<string | null>(null);
  const [applyOpen, setApplyOpen] = useState<boolean>(false);
  // �� track which toolbar button opened the dialog so the
  // initial radio matches the user's intent ("Apply Single" should not
  // open in "All pending" mode and re-execute every pending migration).
  const [applyInitialMode, setApplyInitialMode] = useState<"single" | "range" | "allPending">(    "allPending",
);
  const [rollbackOpen, setRollbackOpen] = useState<boolean>(false);
  const [diffOpen, setDiffOpen] = useState<boolean>(false);
  const [progress, setProgress] = useState<ProgressPayload | null>(null);

  // S22 — Squawk lint engine state.
  const lintInstalled = useLintStore((s) => s.installed);
  const setLintInstalled = useLintStore((s) => s.setInstalled);
  const setRuleDescriptions = useLintStore((s) => s.setRuleDescriptions);
  const setLintFindings = useLintStore((s) => s.setFindings);
  const [installBannerHidden, setInstallBannerHidden] = useState<boolean>(false);

  const fetchList = useCallback(async () => {
    setListError(null);
    try {
      const res = (await invoke("migrations_list", {
        connId: connectionId,
      })) as ListResult;
      setMigrations(res.migrations, res.trackingTableMissing);
      // �� hydrate persisted dir + toggles from backend so the
      // header reflects SQLite state instead of the zustand defaults.
      if (res.migrationsDir !== null) {
        setStoreDir(res.migrationsDir);
      } else {
        clearStoreDir();
      }
      setOptions(res.trackingEnabled, res.snapshotsEnabled);
    } catch (err) {
      setListError(localizeMigrationError(err, t));
    }
  }, [connectionId, setMigrations, setStoreDir, clearStoreDir, setOptions, t]);

  // Mount-time fetch + connection change.
  useEffect(() => {
    void fetchList();
  }, [fetchList]);

  // S22 — Squawk install probe + rule description cache. Runs once per
  // mount (the backend caches via OnceCell so re-invocations are cheap;
  // we still avoid re-running unnecessarily).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = (await invoke("lint_check_install")) as {
          installed: boolean;
          version: string | null;
        };
        if (cancelled) return;
        setLintInstalled(res.installed, res.version ?? null);
        if (res.installed) {
          const rules = (await invoke("lint_list_rules")) as {
            rules: Record<string, string>;
          };
          if (cancelled) return;
          setRuleDescriptions(rules.rules);
        }
      } catch {
        // Lint init is best-effort; on error, leave installed=null and
        // the panel renders without any Squawk affordances.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setLintInstalled, setRuleDescriptions]);

  // S22 — When migrations list changes, dispatch a parallel lint_file
  // per `.up.sql`. Each resolve writes findings into the store keyed by
  // version so Timeline + ApplyDialog re-render with badges/markers.
  useEffect(() => {
    if (lintInstalled !== true) return;
    if (migrations.length === 0) return;
    let cancelled = false;
    const targets = migrations.slice();
    void Promise.all(      targets.map(async (m) => {
        try {
          const res = (await invoke("lint_file", { path: m.upPath })) as {
            findings: SquawkFinding[];
          };
          if (cancelled) return;
          setLintFindings(m.version, res.findings);
        } catch {
          // Ignore per-file lint errors; the badge will simply not
          // appear for that migration.
        }
      }),
);
    return () => {
      cancelled = true;
    };
  }, [migrations, lintInstalled, setLintFindings]);

  // Event subscriptions.
  useEffect(() => {
    const unlisteners: UnlistenFn[] = [];
    let cancelled = false;

    void (async () => {
      const offDir = await listen<DirChangedPayload>("migrations:dir-changed", (event) => {
        if (event.payload?.connId === connectionId) {
          void fetchList();
        }
      });
      if (cancelled) {
        offDir();
        return;
      }
      unlisteners.push(offDir);

      const offApply = await listen<ProgressPayload>("migrations:apply-progress", (event) => {
        if (event.payload?.connId !== connectionId) return;
        setProgress(event.payload);
        if (event.payload.phase !== "running") {
          // Refresh list when a migration completes / fails.
          void fetchList();
        }
      });
      if (cancelled) {
        offApply();
        return;
      }
      unlisteners.push(offApply);

      const offRollback = await listen<ProgressPayload>("migrations:rollback-progress", (event) => {
        if (event.payload?.connId !== connectionId) return;
        setProgress(event.payload);
        if (event.payload.phase !== "running") {
          void fetchList();
        }
      });
      if (cancelled) {
        offRollback();
        return;
      }
      unlisteners.push(offRollback);
    })();

    return () => {
      cancelled = true;
      for (const off of unlisteners) off();
    };
  }, [connectionId, fetchList]);

  const selectedMigration = useMemo(    () => migrations.find((m) => m.version === selectedVersion) ?? null,
    [migrations, selectedVersion],
);

  const handleDirChanged = useCallback(    (dir: string | null) => {
      if (dir === null) {
        clearStoreDir();
      } else {
        setStoreDir(dir);
      }
      void fetchList();
    },
    [clearStoreDir, setStoreDir, fetchList],
);

  const handleToggleTracking = useCallback(    async (next: boolean) => {
      setOptions(next, snapshotsEnabled);
      try {
        await invoke("migrations_set_options", {
          connId: connectionId,
          trackingEnabled: next,
          snapshotsEnabled,
        });
      } catch (err) {
        // On failure, revert. The user-visible feedback is the alert below.
        setOptions(!next, snapshotsEnabled);
        setListError(localizeMigrationError(err, t));
      }
    },
    [connectionId, snapshotsEnabled, setOptions, t],
);

  const handleToggleSnapshots = useCallback(    async (next: boolean) => {
      setOptions(trackingEnabled, next);
      try {
        await invoke("migrations_set_options", {
          connId: connectionId,
          trackingEnabled,
          snapshotsEnabled: next,
        });
      } catch (err) {
        setOptions(trackingEnabled, !next);
        setListError(localizeMigrationError(err, t));
      }
    },
    [connectionId, trackingEnabled, setOptions, t],
);

  const hasPending = migrations.some((m) => m.status === "pending");
  const canRollback =
    selectedMigration !== null &&
    selectedMigration.status === "applied" &&
    selectedMigration.downPath !== null;
  const hasSnapshots = migrations.some((m) => m.hasSnapshot);

  const env = connection?.environment ?? "local";
  const connName = connection?.name ?? connectionId;

  const progressText = progress
    ? `${progress.phase} ${progress.version}${
        progress.durationMs !== undefined ? ` (${progress.durationMs}ms)` : ""
      }`
    : null;

  return (    <div
      data-testid="migrations-panel"
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
        background: "var(--bg)",
        color: "var(--ink-2)",
      }}
    >
      {lintInstalled === false && !installBannerHidden ? (        <div style={{ padding: "8px 12px 0 12px" }}>
          <EmptyStateInstall onDismiss={() => setInstallBannerHidden(true)} />
        </div>
) : null}

      <div
        style={{
          padding: 12,
          display: "flex",
          flexDirection: "column",
          gap: 10,
          borderBottom: "1px solid var(--hairline)",
        }}
      >
        <DirectorySelector
          connectionId={connectionId}
          currentDir={migrationsDir}
          onChanged={handleDirChanged}
        />
        <div style={{ display: "flex", gap: 16, fontSize: 13 }}>
          <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
            <input
              type="checkbox"
              data-testid="migrations-tracking-toggle"
              checked={trackingEnabled}
              onChange={(e) => {
                void handleToggleTracking(e.target.checked);
              }}
            />
            <span>{t("migrations.panel.trackingTable")}</span>
          </label>
          <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
            <input
              type="checkbox"
              data-testid="migrations-snapshots-toggle"
              checked={snapshotsEnabled}
              onChange={(e) => {
                void handleToggleSnapshots(e.target.checked);
              }}
            />
            <span>{t("migrations.panel.snapshots")}</span>
          </label>
        </div>
        {trackingTableMissing ? (          <div
            data-testid="migrations-tracking-missing"
            // biome-ignore lint/a11y/useSemanticElements: passive status banner, not a form <output>
            role="status"
            style={{ fontSize: 12, color: "var(--warn, #d49b1c)" }}
          >
            {t("migrations.panel.trackingMissing")}
          </div>
) : null}
      </div>

      <div
        style={{
          padding: "8px 12px",
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          alignItems: "center",
          borderBottom: "1px solid var(--hairline)",
        }}
      >
        <button
          type="button"
          data-testid="migrations-toolbar-apply-all"
          className="btn"
          disabled={!hasPending}
          onClick={() => {
            setApplyInitialMode("allPending");
            setApplyOpen(true);
          }}
        >
          {t("migrations.toolbar.applyAll")}
        </button>
        <button
          type="button"
          data-testid="migrations-toolbar-apply-single"
          className="btn btn-ghost"
          disabled={!hasPending}
          onClick={() => {
            setApplyInitialMode("single");
            setApplyOpen(true);
          }}
        >
          {t("migrations.toolbar.applySingle")}
        </button>
        <button
          type="button"
          data-testid="migrations-toolbar-apply-range"
          className="btn btn-ghost"
          disabled={!hasPending}
          onClick={() => {
            setApplyInitialMode("range");
            setApplyOpen(true);
          }}
        >
          {t("migrations.toolbar.applyRange")}
        </button>
        <button
          type="button"
          data-testid="migrations-toolbar-rollback"
          className="btn btn-ghost"
          disabled={!canRollback}
          onClick={() => setRollbackOpen(true)}
        >
          {t("migrations.toolbar.rollback")}
        </button>
        <button
          type="button"
          data-testid="migrations-toolbar-diff"
          className="btn btn-ghost"
          disabled={!hasSnapshots}
          onClick={() => setDiffOpen(true)}
        >
          {t("migrations.toolbar.diff")}
        </button>
        {progressText ? (          <span
            data-testid="migrations-progress"
            style={{ fontSize: 12, color: "var(--ink-3)", marginLeft: "auto" }}
          >
            {progressText}
          </span>
) : null}
      </div>

      {listError ? (        <div role="alert" style={{ padding: "6px 12px", fontSize: 12, color: "var(--err, #d33)" }}>
          {listError}
        </div>
) : null}

      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <Timeline
          migrations={migrations}
          selectedVersion={selectedVersion}
          onSelect={(v) => select(v)}
        />
      </div>

      {applyOpen ? (        <ApplyDialog
          open={applyOpen}
          connectionId={connectionId}
          connectionName={connName}
          environment={env}
          migrations={migrations}
          initialMode={applyInitialMode}
          onClose={() => setApplyOpen(false)}
          onApplied={() => {
            void fetchList();
          }}
        />
) : null}

      {rollbackOpen && selectedMigration ? (        <RollbackDialog
          open={rollbackOpen}
          connectionId={connectionId}
          connectionName={connName}
          environment={env}
          migration={selectedMigration}
          onClose={() => setRollbackOpen(false)}
          onRolledBack={() => {
            void fetchList();
          }}
        />
) : null}

      {diffOpen ? (        <Dialog
          open={diffOpen}
          onOpenChange={(o) => {
            if (!o) setDiffOpen(false);
          }}
          title={t("migrations.diff.title", { defaultValue: "Schema diff" })}
          size="xl"
        >
          <div style={{ height: 480, display: "flex", flexDirection: "column" }}>
            <DiffViewer connectionId={connectionId} migrations={migrations} />
          </div>
        </Dialog>
) : null}
    </div>
);
}
