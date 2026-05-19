/**
 * — 
 * — (additions).
 *
 * ApplyDialog drives the Apply flow with three modes:
 *
 * ⚪ Single        — pick one pending version
 * ⚪ Range         — from .. to (must be a contiguous slice of pending)
 * ⚪ All pending   — every pending migration in order
 *
 * Below the radios sits a read-only Monaco viewer with the concatenated
 * `.up.sql` content for the selected scope (one round-trip per version
 * via `migrations_preview_up`).
 *
 * Production mode: a soft banner is shown but the user can still hit
 * Apply directly — no typing gate (per spec §7.2 / Q5). Rollback uses
 * the heavier `TypingConfirmModal` gate; apply is treated as forward-
 * only and reversible.
 *
 * S22 additions:
 * - "Dry-run on disposable DB first" checkbox, persisted to
 * localStorage per connection.
 * - When ON: clicking Apply invokes `migrations_dryrun` (not
 * `migrations_apply`), subscribes to `migrations:dryrun-progress`
 * for inline phase strip, and displays a results panel on resolve.
 * Success → "Apply for real" button (which then runs the real
 * `migrations_apply`). Failure → "Close" only.
 * - Squawk Monaco markers: useEffect compares lintStore findings
 * against the migrations in scope and calls
 * `monaco.editor.setModelMarkers(model, "squawk", markers)`.
 */

import { Editor, type Monaco } from "@monaco-editor/react";
import { invoke } from "@tauri-apps/api/core";
import { type UnlistenFn, listen } from "@tauri-apps/api/event";
import type { editor } from "monaco-editor";
import { type JSX, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog } from "../../components/Dialog";
import { errorToMessage } from "../../lib/errors";
import type { Environment } from "../../lib/tauri";
import { ErrorExplainButton } from "../error-explain/ErrorExplainButton";
import {
  type DryRunTarget,
  Spg99DryRunTargetPicker,
} from "../paid-modules/Spg99DryRunTargetPicker";
import { VibepgActionButton } from "../paid-modules/VibepgActionButton";
import { VibepgResultDialog } from "../paid-modules/VibepgResultDialog";
import { findingsToMonacoMarkers } from "./squawk/lintMarkers";
import { useLintStore } from "./squawk/lintStore";
import type { Migration } from "./store";

type ApplyMode =
  | { kind: "single"; version: string }
  | { kind: "range"; from: string; to: string }
  | { kind: "allPending" };

type ApplyResult = {
  applied: { version: string; durationMs: number }[];
  failed: { version: string; error: string } | null;
};

type SqlPreview = { sql: string };

type DryRunStep = {
  version: string;
  status: "ok" | "failed" | "skipped";
  durationMs: number;
  error: string | null;
};

type DryRunReport = {
  success: boolean;
  containerPullMs: number;
  containerStartMs: number;
  steps: DryRunStep[];
  totalMs: number;
  findings: {
    rule: string;
    severity: "warning" | "error";
    file: string;
    line: number;
    column: number;
    message: string;
  }[];
  error: { kind: string; message?: string } | null;
};

type DryRunPhase = "pulling" | "starting" | "seeding" | "running" | "done" | "failed";
type DryRunProgressPayload = {
  connId: string;
  phase: DryRunPhase;
  currentStep?: { version: string; durationMs: number };
};

type ModeKind = "single" | "range" | "allPending";

interface Props {
  open: boolean;
  connectionId: string;
  connectionName: string;
  environment: Environment;
  migrations: Migration[];
  /**
   * �� initial mode for the radio set. Lets the toolbar's three
   * buttons (Apply Single / Range / All pending) open the dialog already
   * pointed at the user's intent instead of always defaulting to All
   * pending. Default `"allPending"` preserves the prior behavior for
   * callers that don't care.
   */
  initialMode?: ModeKind;
  onClose(): void;
  onApplied(result: ApplyResult): void;
}

/**
 * Range guard. Per the slice must be all `pending` AND have no
 * `parse_error` rows — otherwise apply will be refused on the backend with
 * `HasParseError`. Catching it client-side gives the user a clean inline
 * "Range must be contiguous" error instead of a Tauri exception.
 */
function isContiguousPendingRange(migrations: Migration[], from: string, to: string): boolean {
  const fromIdx = migrations.findIndex((m) => m.version === from);
  const toIdx = migrations.findIndex((m) => m.version === to);
  if (fromIdx === -1 || toIdx === -1 || toIdx < fromIdx) return false;
  return migrations
    .slice(fromIdx, toIdx + 1)
    .every((m) => m.status === "pending" && m.parseError === null);
}

function selectedScope(  mode: ModeKind,
  migrations: Migration[],
  single: string,
  rangeFrom: string,
  rangeTo: string,
): string[] {
  if (mode === "single") {
    if (!single) return [];
    // �� never let a parse-error row land in scope.
    const m = migrations.find((x) => x.version === single);
    if (!m || m.parseError !== null) return [];
    return [single];
  }
  if (mode === "range") {
    if (!rangeFrom || !rangeTo) return [];
    if (!isContiguousPendingRange(migrations, rangeFrom, rangeTo)) return [];
    const fromIdx = migrations.findIndex((m) => m.version === rangeFrom);
    const toIdx = migrations.findIndex((m) => m.version === rangeTo);
    return migrations.slice(fromIdx, toIdx + 1).map((m) => m.version);
  }
  return migrations
    .filter((m) => m.status === "pending" && m.parseError === null)
    .map((m) => m.version);
}

const SEPARATOR = "\n\n-- ─── ";
const SEPARATOR_END = " ───\n\n";

const dryRunStorageKey = (connId: string): string => `migrations.dryRun.enabled.${connId}`;

export function ApplyDialog(props: Props): JSX.Element {
  const { t } = useTranslation();
  const {
    open,
    connectionId,
    connectionName,
    environment,
    migrations,
    initialMode = "allPending",
    onClose,
    onApplied,
  } = props;

  // �� exclude rows that discovery flagged with a parse_error
  // ("duplicate version" / "orphan rollback file" / "file missing"); those
  // are surfaced in the timeline as warnings but must NOT be selectable for
  // apply, because backend `select_targets` now rejects them with
  // `HasParseError` and the dropdown would offer broken options otherwise.
  const pending = useMemo(    () => migrations.filter((m) => m.status === "pending" && m.parseError === null),
    [migrations],
);

  const [mode, setMode] = useState<ModeKind>(initialMode);
  const [single, setSingle] = useState<string>("");
  const [rangeFrom, setRangeFrom] = useState<string>("");
  const [rangeTo, setRangeTo] = useState<string>("");
  const [preview, setPreview] = useState<string>("");
  const [previewLoading, setPreviewLoading] = useState<boolean>(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [applying, setApplying] = useState<boolean>(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  // S37 — vibepg review slot. Opens VibepgResultDialog when subscribed.
  const [vibepgReviewOpen, setVibepgReviewOpen] = useState(false);

  // S22 dry-run state.
  const [dryRunEnabled, setDryRunEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem(dryRunStorageKey(connectionId)) === "true";
    } catch {
      return false;
    }
  });
  // S37 — dry-run target. Default `docker` preserves S22 behavior. The
  // SPG99 radio is gated by subscription inside Spg99DryRunTargetPicker.
  // For v1.0 both targets route to the same testcontainers code path; the
  // value is forwarded as `selectedTarget` on `migrations_dryrun` so
  // backend/telemetry can split adoption.
  const [dryRunTarget, setDryRunTarget] = useState<DryRunTarget>("docker");
  const [dryRunInProgress, setDryRunInProgress] = useState<boolean>(false);
  const [dryRunPhase, setDryRunPhase] = useState<DryRunPhase | null>(null);
  const [dryRunReport, setDryRunReport] = useState<DryRunReport | null>(null);
  // �� snapshot of the scope (sorted version list) at the time
  // dry-run resolved. If the user changes mode/single/rangeFrom/rangeTo
  // after a successful dry-run, the report is invalidated so they can't
  // press "Apply for real" against a different set of migrations.
  const [dryRunScope, setDryRunScope] = useState<string[] | null>(null);

  // S22 lint markers — read directly from the store.
  const findingsByVersion = useLintStore((s) => s.findingsByVersion);
  const ruleDescriptions = useLintStore((s) => s.ruleDescriptions);
  const monacoRef = useRef<Monaco | null>(null);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);

  const scope = useMemo(    () => selectedScope(mode, migrations, single, rangeFrom, rangeTo),
    [mode, migrations, single, rangeFrom, rangeTo],
);

  const rangeIncomplete = mode === "range" && (!rangeFrom || !rangeTo);
  const rangeInvalid =
    mode === "range" &&
    !rangeIncomplete &&
    !isContiguousPendingRange(migrations, rangeFrom, rangeTo);

  // Fetch + concatenate preview whenever scope changes.
  useEffect(() => {
    if (scope.length === 0) {
      setPreview("");
      setPreviewError(null);
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    setPreviewError(null);
    (async () => {
      try {
        const parts: string[] = [];
        for (const version of scope) {
          const res = (await invoke("migrations_preview_up", {
            connId: connectionId,
            version,
          })) as SqlPreview;
          parts.push(`${SEPARATOR}${version}${SEPARATOR_END}${res.sql}`);
        }
        if (!cancelled) {
          setPreview(parts.join("").replace(/^\n\n/, ""));
        }
      } catch (err) {
        if (!cancelled) {
          setPreviewError(errorToMessage(err));
        }
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [scope, connectionId]);

  // S22: subscribe to dry-run progress events for the active connection.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let off: UnlistenFn | null = null;
    void (async () => {
      const u = await listen<DryRunProgressPayload>("migrations:dryrun-progress", (event) => {
        if (event.payload?.connId !== connectionId) return;
        setDryRunPhase(event.payload.phase);
      });
      if (cancelled) {
        u();
        return;
      }
      off = u;
    })();
    return () => {
      cancelled = true;
      if (off) off();
    };
  }, [open, connectionId]);

  // S22: apply Squawk markers to Monaco when scope or findings change.
  useEffect(() => {
    const monaco = monacoRef.current;
    const ed = editorRef.current;
    if (!monaco || !ed) return;
    const model = ed.getModel();
    if (!model) return;
    const merged = scope.flatMap((v) => findingsByVersion.get(v) ?? []);
    const markers = findingsToMonacoMarkers(merged, ruleDescriptions);
    monaco.editor.setModelMarkers(model, "squawk", markers);
  }, [scope, findingsByVersion, ruleDescriptions]);

  const handleDryRunCheckbox = useCallback(    (next: boolean) => {
      setDryRunEnabled(next);
      try {
        localStorage.setItem(dryRunStorageKey(connectionId), String(next));
      } catch {
        // localStorage may be unavailable (private mode); state still works.
      }
    },
    [connectionId],
);

  const buildPayloadMode = useCallback((): ApplyMode => {
    if (mode === "single") return { kind: "single", version: single };
    if (mode === "range") return { kind: "range", from: rangeFrom, to: rangeTo };
    return { kind: "allPending" };
  }, [mode, single, rangeFrom, rangeTo]);

  const runDryRun = useCallback(async () => {
    setDryRunInProgress(true);
    setDryRunPhase("pulling");
    setApplyError(null);
    setDryRunReport(null);
    setDryRunScope(null);
    // Snapshot the scope at run-time so a subsequent scope edit invalidates
    // the report ().
    const scopeSnapshot = [...scope].sort();
    try {
      const report = (await invoke("migrations_dryrun", {
        connId: connectionId,
        mode: buildPayloadMode(),
        // — annotate selected dry-run target. Backend ignores
        // unknown keys in v1.0; v1.1 routes "spg99" to cloud-provisioned
        // Instant DB.
        selectedTarget: dryRunTarget,
      })) as DryRunReport;
      setDryRunReport(report);
      setDryRunScope(scopeSnapshot);
    } catch (err) {
      setApplyError(errorToMessage(err));
    } finally {
      setDryRunInProgress(false);
      setDryRunPhase(null);
    }
  }, [connectionId, buildPayloadMode, scope, dryRunTarget]);

  // �� invalidate the report when the user changes scope after
  // a dry-run has resolved. Without this, "Apply for real" would run
  // against a different set than the one we just verified.
  useEffect(() => {
    if (dryRunReport === null || dryRunScope === null) return;
    const currentSorted = [...scope].sort();
    const same =
      currentSorted.length === dryRunScope.length &&
      currentSorted.every((v, i) => v === dryRunScope[i]);
    if (!same) {
      setDryRunReport(null);
      setDryRunScope(null);
    }
  }, [scope, dryRunReport, dryRunScope]);

  // �� when the user closes the dialog while dry-run is mid-flight,
  // signal the backend so testcontainers can drop the ephemeral container
  // immediately instead of waiting for a 30s+ image pull or full apply.
  const handleClose = useCallback(() => {
    if (dryRunInProgress) {
      void invoke("migrations_dryrun_cancel", { connId: connectionId }).catch(() => {
        // Best-effort cancel; if the backend is already done, this no-ops.
      });
    }
    onClose();
  }, [dryRunInProgress, connectionId, onClose]);

  const runRealApply = useCallback(async () => {
    if (scope.length === 0) return;
    setApplying(true);
    setApplyError(null);
    try {
      const result = (await invoke("migrations_apply", {
        connId: connectionId,
        mode: buildPayloadMode(),
      })) as ApplyResult;
      onApplied(result);
      onClose();
    } catch (err) {
      setApplyError(errorToMessage(err));
    } finally {
      setApplying(false);
    }
  }, [scope.length, connectionId, buildPayloadMode, onApplied, onClose]);

  const handleApply = useCallback(() => {
    if (scope.length === 0) return;
    if (dryRunEnabled) {
      void runDryRun();
    } else {
      void runRealApply();
    }
  }, [scope.length, dryRunEnabled, runDryRun, runRealApply]);

  const canApply =
    !applying &&
    !dryRunInProgress &&
    scope.length > 0 &&
    !previewLoading &&
    !rangeInvalid &&
    !rangeIncomplete;

  const isProd = environment === "prod";
  const count = scope.length;

  const showResultsPanel = dryRunReport !== null;

  return (    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) handleClose();
      }}
      title={t("migrations.apply.title")}
      size="lg"
      footer={
        showResultsPanel ? (          <>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={handleClose}
              disabled={applying}
              data-testid="apply-dialog-dryrun-close"
            >
              {t("migrations.dryrun.close")}
            </button>
            {dryRunReport?.success ? (              <button
                type="button"
                data-testid="apply-dialog-dryrun-apply-for-real"
                className={isProd ? "btn btn-danger" : "btn btn-primary"}
                disabled={applying}
                onClick={() => {
                  void runRealApply();
                }}
              >
                {applying ? t("migrations.apply.applying") : t("migrations.dryrun.applyForReal")}
              </button>
) : null}
          </>
) : (          <>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={handleClose}
              // �� Cancel stays enabled during dry-run so user
              // can abort the backend job (handleClose invokes
              // migrations_dryrun_cancel).
              disabled={applying}
            >
              {t("migrations.apply.cancel")}
            </button>
            <button
              type="button"
              data-testid="apply-dialog-confirm"
              className={isProd ? "btn btn-danger" : "btn btn-primary"}
              disabled={!canApply}
              onClick={handleApply}
            >
              {dryRunInProgress
                ? t("migrations.dryrun.running")
                : applying
                  ? t("migrations.apply.applying")
                  : t("migrations.apply.apply", { count })}
            </button>
          </>
)
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <fieldset
          data-testid="apply-dialog-modes"
          style={{ display: "flex", gap: 16, border: 0, padding: 0, margin: 0 }}
        >
          <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
            <input
              type="radio"
              name="apply-mode"
              value="single"
              checked={mode === "single"}
              onChange={() => setMode("single")}
            />
            <span>{t("migrations.apply.modeSingle")}</span>
          </label>
          <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
            <input
              type="radio"
              name="apply-mode"
              value="range"
              checked={mode === "range"}
              onChange={() => setMode("range")}
            />
            <span>{t("migrations.apply.modeRange")}</span>
          </label>
          <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
            <input
              type="radio"
              name="apply-mode"
              value="allPending"
              checked={mode === "allPending"}
              onChange={() => setMode("allPending")}
            />
            <span>{t("migrations.apply.modeAllPending")}</span>
          </label>
        </fieldset>

        <div
          style={{
            display: "flex",
            gap: 12,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 13 }}>
            <input
              type="checkbox"
              data-testid="apply-dialog-dryrun-checkbox"
              checked={dryRunEnabled}
              onChange={(e) => handleDryRunCheckbox(e.target.checked)}
            />
            <span>{t("migrations.dryrun.checkbox")}</span>
          </label>
          {/* — vibepg review slot. Sits next to the dry-run/Squawk
              controls. */}
          <span data-testid="apply-dialog-vibepg-slot">
            <VibepgActionButton
              slot="migration_review"
              onAction={() => setVibepgReviewOpen(true)}
            />
          </span>
        </div>

        <VibepgResultDialog open={vibepgReviewOpen} onOpenChange={setVibepgReviewOpen} />

        {/* — SPG99 paid-module slot: dry-run target radio group.
            Visible whenever dry-run is enabled; SPG99 radio is gated by
            subscription inside the picker. */}
        {dryRunEnabled ? (          <Spg99DryRunTargetPicker value={dryRunTarget} onChange={setDryRunTarget} />
) : null}

        {mode === "single" ? (          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
              {t("migrations.apply.version")}
            </span>
            <select
              data-testid="apply-dialog-single-version"
              className="q-input"
              value={single}
              onChange={(e) => setSingle(e.target.value)}
            >
              <option value="">{t("migrations.apply.selectVersion")}</option>
              {pending.map((m) => (                <option key={m.version} value={m.version}>
                  {m.version} — {m.name}
                </option>
))}
            </select>
          </label>
) : null}

        {mode === "range" ? (          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
                {t("migrations.apply.from")}
              </span>
              <select
                data-testid="apply-dialog-range-from"
                className="q-input"
                value={rangeFrom}
                onChange={(e) => setRangeFrom(e.target.value)}
              >
                <option value="">{t("migrations.apply.selectVersion")}</option>
                {migrations
                  .filter((m) => m.parseError === null)
                  .map((m) => (                    <option key={m.version} value={m.version}>
                      {m.version} — {m.name}
                    </option>
))}
              </select>
            </label>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
                {t("migrations.apply.to")}
              </span>
              <select
                data-testid="apply-dialog-range-to"
                className="q-input"
                value={rangeTo}
                onChange={(e) => setRangeTo(e.target.value)}
              >
                <option value="">{t("migrations.apply.selectVersion")}</option>
                {migrations
                  .filter((m) => m.parseError === null)
                  .map((m) => (                    <option key={m.version} value={m.version}>
                      {m.version} — {m.name}
                    </option>
))}
              </select>
            </label>
            {rangeInvalid ? (              <div
                data-testid="apply-dialog-range-error"
                role="alert"
                style={{ color: "var(--err, #d33)", fontSize: 12, alignSelf: "center" }}
              >
                {t("migrations.apply.rangeError")}
              </div>
) : null}
          </div>
) : null}

        {mode === "allPending" ? (          <div
            data-testid="apply-dialog-pending-count"
            style={{ fontSize: 12, color: "var(--ink-3)" }}
          >
            {pending.length === 0
              ? t("migrations.apply.noPending")
              : t("migrations.apply.pendingCount", { count: pending.length })}
          </div>
) : null}

        {isProd && count > 0 ? (          <div
            data-testid="apply-dialog-prod-banner"
            role="alert"
            style={{
              padding: 8,
              border: "1px solid var(--warn, #d49b1c)",
              borderRadius: 4,
              background: "var(--warn-bg, rgba(212,155,28,0.08))",
              fontSize: 12,
              color: "var(--ink-2)",
            }}
          >
            ⚠ {t("migrations.apply.prodBanner", { count, name: connectionName })}
          </div>
) : null}

        {previewError ? (          <div role="alert" style={{ color: "var(--err, #d33)", fontSize: 12 }}>
            {t("migrations.apply.previewError", { error: previewError })}
            <div style={{ marginTop: 6 }}>
              <ErrorExplainButton message={previewError} variant="inline" />
            </div>
          </div>
) : null}

        {applyError ? (          <div role="alert" style={{ color: "var(--err, #d33)", fontSize: 12 }}>
            {applyError}
            <div style={{ marginTop: 6 }}>
              <ErrorExplainButton message={applyError} variant="inline" />
            </div>
          </div>
) : null}

        {dryRunInProgress ? (          <div
            data-testid="apply-dialog-dryrun-progress"
            // biome-ignore lint/a11y/useSemanticElements: passive status banner
            role="status"
            style={{
              padding: 8,
              border: "1px solid var(--hairline)",
              borderRadius: 4,
              fontSize: 12,
              color: "var(--ink-3)",
            }}
          >
            {t("migrations.dryrun.running")}
            {dryRunPhase ? ` — ${t(`migrations.dryrun.phase.${dryRunPhase}`)}` : ""}
          </div>
) : null}

        {showResultsPanel && dryRunReport ? (          <div
            data-testid="apply-dialog-dryrun-results"
            style={{
              border: "1px solid var(--hairline)",
              borderRadius: 4,
              padding: 8,
              fontSize: 12,
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            <div style={{ fontWeight: 600 }}>
              {dryRunReport.success
                ? t("migrations.dryrun.succeeded", { ms: dryRunReport.totalMs })
                : dryRunReport.error
                  ? // �� When the failure is NOT a per-migration
                    // SQL error (DockerUnavailable, ImagePullFailed,
                    // ContainerStartFailed, LedgerSeedFailed, Cancelled,
                    // Internal), there is no migration to "fix" — surface
                    // the actual error.kind so the message is actionable.
                    t(`migrations.dryrun.error.${dryRunReport.error.kind}`, {
                      defaultValue: dryRunReport.error.kind,
                    })
                  : t("migrations.dryrun.failed", {
                      version:
                        dryRunReport.steps.find((s) => s.status === "failed")?.version ?? "—",
                    })}
            </div>
            {dryRunReport.error && !dryRunReport.success ? (              <div
                data-testid="apply-dialog-dryrun-error-detail"
                role="alert"
                style={{
                  color: "var(--err, #d33)",
                  fontFamily: "var(--font-mono-q, monospace)",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {dryRunReport.error.message ?? ""}
              </div>
) : null}
            <div style={{ color: "var(--ink-3)" }}>
              {t("migrations.dryrun.containerStats", {
                pull: dryRunReport.containerPullMs,
                start: dryRunReport.containerStartMs,
                run: Math.max(                  0,
                  dryRunReport.totalMs -
                    dryRunReport.containerPullMs -
                    dryRunReport.containerStartMs,
),
              })}
            </div>
            <ul style={{ margin: 0, paddingLeft: 16 }}>
              {dryRunReport.steps.map((s) => (                <li
                  key={s.version}
                  data-testid={`apply-dialog-dryrun-step-${s.version}`}
                  style={{
                    color:
                      s.status === "ok"
                        ? "var(--ok, #34c759)"
                        : s.status === "failed"
                          ? "var(--err, #d33)"
                          : "var(--ink-4)",
                  }}
                >
                  {s.status === "ok" ? "✔" : s.status === "failed" ? "✗" : "·"} {s.version} —{" "}
                  {s.durationMs}ms
                  {s.error ? ` ${t("migrations.dryrun.errorPrefix")} ${s.error}` : ""}
                </li>
))}
            </ul>
            {dryRunReport.findings.length > 0 ? (              <div style={{ color: "var(--warn, #d49b1c)" }}>
                {t("migrations.dryrun.findings", { count: dryRunReport.findings.length })}
              </div>
) : null}
            {!dryRunReport.success ? (              <div style={{ color: "var(--ink-3)", fontStyle: "italic" }}>
                {t("migrations.dryrun.hintFix")}
              </div>
) : null}
          </div>
) : null}

        <div style={{ height: 280, border: "1px solid var(--hairline)", borderRadius: 4 }}>
          <Editor
            height="280px"
            defaultLanguage="sql"
            value={previewLoading ? `-- ${t("migrations.apply.previewLoading")}` : preview}
            onMount={(ed, monaco) => {
              editorRef.current = ed;
              monacoRef.current = monaco;
              const model = ed.getModel();
              if (model) {
                const merged = scope.flatMap((v) => findingsByVersion.get(v) ?? []);
                const markers = findingsToMonacoMarkers(merged, ruleDescriptions);
                monaco.editor.setModelMarkers(model, "squawk", markers);
              }
            }}
            options={{
              readOnly: true,
              minimap: { enabled: false },
              fontSize: 12,
              scrollBeyondLastLine: false,
              automaticLayout: true,
            }}
          />
        </div>
      </div>
    </Dialog>
);
}
