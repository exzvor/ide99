import { XCircle } from "lucide-react";
import { type JSX, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { StatementResult } from "../../lib/tauri";
import { useConnections } from "../connections/store";
import { ErrorExplainButton } from "../error-explain/ErrorExplainButton";
import { RerunBanner } from "./RerunBanner";
import { ResultFooter } from "./ResultFooter";
import { ResultGrid } from "./ResultGrid";
import { UnrepresentableBar } from "./UnrepresentableBar";
import { type BatchRunState, useEditor } from "./store";

// Stable empty references for Zustand selectors.
const EMPTY_FILTERS: ReadonlyArray<{ column: string }> = [];

function filtersEqual(
  a: ReadonlyArray<{ column: string }>,
  b: ReadonlyArray<{ column: string }>,
): boolean {
  if (a.length !== b.length) return false;
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  return sa === sb;
}

/**
 * query result panel.
 *
 * Visual states (driven by `runState.status`):
 * - idle    → status row: "Ready · <connection name | no connection>"
 * - running → status row: spinner + "Running…" + live elapsed counter
 * - success → status row: "{n} rows · {ms} ms" (+ truncated banner if so);
 * body: <table> with sticky header, NULL cells italic-muted,
 * numeric columns right-aligned with tabular-nums.
 * - error   → status row: red banner with title + position;
 * body: <pre>{error}</pre>.
 *
 * Accessibility:
 * - Outer region: `role="region"` + aria-label "Query result".
 * - Running spinner is wrapped in `<output role="status" aria-live="polite">`
 * so screen readers announce status flips without preempting other content.
 */

interface ResultPanelProps {
  tabId: string;
}

function useElapsedMs(startedAt: number | null): number {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (startedAt === null) {
      setElapsed(0);
      return;
    }
    setElapsed(Date.now() - startedAt);
    const id = window.setInterval(() => {
      setElapsed(Date.now() - startedAt);
    }, 200);
    return () => window.clearInterval(id);
  }, [startedAt]);

  return elapsed;
}

export function ResultPanel({ tabId }: ResultPanelProps): JSX.Element {
  const { t } = useTranslation();
  const tab = useEditor((s) => s.tabs.find((entry) => entry.id === tabId));
  const runState = useEditor((s) => s.runStates.get(tabId)) ?? { status: "idle" as const };
  const batch = useEditor((s) => s.batchRunStates.get(tabId));
  const connections = useConnections((s) => s.connections);

  const startedAt = runState.status === "opening" ? runState.startedAt : null;
  const elapsedMs = useElapsedMs(startedAt);

  const connectionName =
    tab && tab.kind === "editor" && tab.connectionId
      ? (connections.find((c) => c.id === tab.connectionId)?.name ?? null)
      : null;

  // Tab strip is rendered above every body (idle / opening / streaming / error
  // / cancelled). The body itself reads from `runState` which the store
  // mirrors from the active batch tab — so switching a tab in the strip
  // updates the body without further wiring here.
  const stripJsx = batch?.status === "ready" ? <BatchTabStrip tabId={tabId} batch={batch} /> : null;

  // Intermediate-rowset truncation hint shows under the active rowset only
  // when it's NOT the cursor-bearing last one (i.e. cursorId === null AND
  // truncated === true).
  const truncationHint = (() => {
    if (batch?.status !== "ready") return null;
    const active = batch.statements[batch.activeIdx];
    if (!active || active.kind !== "rowset" || !active.truncated) return null;
    return (
      <div className="q-batch-truncated-hint" data-testid="result-panel-truncated-hint">
        {t("editor.batch.intermediate_truncated")}
      </div>
    );
  })();

  const region = (
    children: JSX.Element, // biome-ignore lint/a11y/useSemanticElements: <section> derives an implicit "region" role only with aria-label, but spec mandates explicit role
  ) => (
    <div
      role="region"
      aria-label={t("editor.result.title", { defaultValue: "Query result" })}
      style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}
      data-testid="result-panel"
    >
      {stripJsx}
      {/* parse error banner is rendered regardless of runState so
          the user sees it even before clicking Run. */}
      <S20ParseErrorBanner tabId={tabId} />
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {children}
      </div>
      {truncationHint}
    </div>
  );

  if (runState.status === "opening") {
    return region(
      <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
        <div
          style={{
            padding: "10px 14px",
            fontSize: 12,
            display: "flex",
            alignItems: "center",
            gap: 10,
            color: "var(--ink-3)",
            borderBottom: "1px solid var(--hairline)",
          }}
        >
          {/* biome-ignore lint/a11y/useSemanticElements: spec mandates explicit role="status" on the running spinner wrapper */}
          <div
            role="status"
            aria-live="polite"
            style={{ display: "flex", alignItems: "center", gap: 8 }}
          >
            <span
              aria-hidden="true"
              style={{
                display: "inline-block",
                width: 11,
                height: 11,
                borderRadius: "50%",
                border: "2px solid var(--ink-5)",
                borderTopColor: "var(--accent)",
                animation: "spin 0.9s linear infinite",
              }}
              data-testid="result-spinner"
            />
            <span>{t("editor.run.spinner")}</span>
            <span
              style={{
                color: "var(--ink-4)",
                fontFamily: "var(--font-mono-q)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {t("editor.result.duration", { ms: elapsedMs })}
            </span>
          </div>
        </div>
        <div style={{ flex: 1 }} />
      </div>,
    );
  }

  if (runState.status === "cancelled") {
    return region(
      <div
        style={{
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          padding: "0 24px",
          textAlign: "center",
        }}
      >
        <strong style={{ color: "var(--ink-2)", fontSize: 13 }}>
          {t("editor.result.cancelled_title")}
        </strong>
        <p style={{ fontSize: 12.5, color: "var(--ink-4)", margin: 0 }}>
          {t("editor.result.cancelled_body")}
        </p>
      </div>,
    );
  }

  if (runState.status === "error") {
    const positionLabel =
      runState.line && runState.col
        ? t("editor.result.error.position", { line: runState.line, col: runState.col })
        : null;
    const localizedHeadline = t(`editor.result.error.code.${runState.code}`);
    const body =
      runState.detail && runState.code === "postgres_error"
        ? runState.detail
        : runState.detail
          ? `${localizedHeadline}\n\n${runState.detail}`
          : localizedHeadline;
    return region(
      <div
        className="q-scroll"
        style={{
          height: "100%",
          overflow: "auto",
          padding: "12px 14px",
        }}
      >
        <div
          style={{
            background: "var(--danger-q-soft)",
            borderLeft: "3px solid var(--danger-q)",
            borderRadius: 8,
            padding: "12px 16px",
            display: "flex",
            gap: 10,
            alignItems: "flex-start",
          }}
        >
          <XCircle
            size={16}
            aria-hidden="true"
            style={{ color: "var(--danger-q)", marginTop: 1, flexShrink: 0 }}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0, flex: 1 }}>
            <pre
              style={{
                margin: 0,
                fontFamily: "var(--font-mono-q)",
                fontSize: 12,
                lineHeight: 1.5,
                color: "var(--ink-2)",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                userSelect: "text",
              }}
            >
              {body}
            </pre>
            {positionLabel ? (
              <div
                style={{
                  fontFamily: "var(--font-mono-q)",
                  fontSize: 11,
                  color: "var(--ink-4)",
                }}
              >
                {positionLabel}
              </div>
            ) : null}
            {runState.code === "postgres_error" && runState.detail ? (
              <div style={{ marginTop: 4 }}>
                <ErrorExplainButton
                  sqlstate={runState.sqlstate}
                  message={runState.detail}
                  sql={tab?.kind === "editor" ? tab.content : null}
                  variant="inline"
                />
              </div>
            ) : null}
          </div>
        </div>
      </div>,
    );
  }

  if (runState.status === "streaming") {
    const hasRows = runState.loadedCount > 0;
    return region(
      <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
        <S20Banners tabId={tabId} />
        {hasRows ? (
          <div style={{ flex: 1, minHeight: 0 }}>
            <ResultGrid tabId={tabId} run={runState} />
          </div>
        ) : (
          <div
            style={{
              flex: 1,
              padding: "12px 14px",
              fontSize: 12.5,
              color: "var(--ink-3)",
            }}
          >
            {runState.affectedRows !== null
              ? t("editor.result.affected", { n: runState.affectedRows })
              : t("editor.result.empty")}
          </div>
        )}
        <ResultFooter run={runState} />
      </div>,
    );
  }

  const idleSubtitle = connectionName ?? t("editor.result.no_connection");
  return region(
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div
        style={{
          padding: "10px 14px",
          fontSize: 12,
          color: "var(--ink-3)",
          display: "flex",
          alignItems: "center",
          gap: 10,
          borderBottom: "1px solid var(--hairline)",
        }}
      >
        <span className="q-pill ok" style={{ fontSize: 10 }}>
          {t("editor.result.ready")}
        </span>
        <span style={{ fontFamily: "var(--font-mono-q)", fontSize: 11.5 }}>{idleSubtitle}</span>
      </div>
      <div style={{ flex: 1 }} />
    </div>,
  );
}

interface BatchTabStripProps {
  tabId: string;
  batch: Extract<BatchRunState, { status: "ready" }>;
}

function BatchTabStrip({ tabId, batch }: BatchTabStripProps): JSX.Element {
  const { t } = useTranslation();
  const failed = batch.failedAt !== null;
  const okCount = failed ? (batch.failedAt as number) : batch.statements.length;
  const summary = failed
    ? t("editor.batch.summary_failed", {
        idx: (batch.failedAt as number) + 1,
        total: batch.statements.length,
        code: getErrorCode(batch.statements[batch.failedAt as number]),
      })
    : t("editor.batch.summary_ok", {
        ok: okCount,
        total: batch.statements.length,
        ms: batch.totalDurationMs,
      });

  return (
    <div className="q-batch-tabstrip" data-testid="result-panel-tabstrip">
      <div className={`q-batch-status${failed ? " has-failure" : ""}`}>{summary}</div>
      <div className="q-batch-tabs" role="tablist">
        {batch.statements.map((s, i) => {
          const isActive = i === batch.activeIdx;
          const isError = s.kind === "error";
          let label: string;
          if (s.kind === "rowset") {
            label = t("editor.batch.tab_label_rowset", {
              idx: i + 1,
              verb: "SELECT",
              rows: `${s.rows.length}${s.truncated ? "+" : ""}`,
            });
          } else if (s.kind === "dml") {
            label = t("editor.batch.tab_label_dml", {
              idx: i + 1,
              verb: s.statusMessage.split(" ")[0] ?? "OK",
              rows: String(s.affectedRows ?? 0),
            });
          } else {
            label = t("editor.batch.tab_label_error", { idx: i + 1 });
          }
          return (
            <button
              // biome-ignore lint/suspicious/noArrayIndexKey: index IS the statement's identity within a single batch result
              key={i}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={`q-batch-tab${isError ? " tone-error" : ""}`}
              onClick={() => useEditor.getState().setActiveBatchTab(tabId, i)}
              data-testid={`batch-tab-${i}`}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function getErrorCode(s: StatementResult | undefined): string {
  if (!s || s.kind !== "error") return "";
  return s.error.kind;
}

/**
 * S20 banner stack: yellow `UnrepresentableBar` when the SELECT shape's tail
 * carries a non-flat clause (JOIN/GROUP BY/etc.); blue `RerunBanner` when
 * filters changed since the last run.
 *
 * Hooks live behind a discrete component so the parent's massive switch on
 * runState doesn't have to know about queryShape selectors.
 */
function S20Banners({ tabId }: { tabId: string }): JSX.Element | null {
  const queryShape = useEditor((s) => s.queryShapes.get(tabId) ?? null);
  const lastExecuted = useEditor((s) => s.lastExecutedShape.get(tabId) ?? null);
  const filterChangeVersion = useEditor((s) => s.filterChangeVersion.get(tabId) ?? 0);
  const runQuery = useEditor((s) => s.runQuery);
  const [dismissed, setDismissed] = useState(false);

  const filtersDiffer = !filtersEqual(
    queryShape?.filters ?? EMPTY_FILTERS,
    lastExecuted?.filters ?? EMPTY_FILTERS,
  );

  // fix: reset dismissal on EACH filter mutation (tracked via
  // `filterChangeVersion`), not only when the diff transitions to false.
  // Without this, dismissing once would suppress every subsequent filter
  // change as long as filters keep diverging from the executed shape.
  // biome-ignore lint/correctness/useExhaustiveDependencies: filtersDiffer is intentionally a separate trigger from filterChangeVersion
  useEffect(() => {
    setDismissed(false);
  }, [filterChangeVersion, filtersDiffer]);

  return (
    <>
      {queryShape?.unrepresentableTail && (
        <UnrepresentableBar slug={queryShape.unrepresentableTail} />
      )}
      {filtersDiffer && !dismissed && queryShape !== null && (
        <RerunBanner
          onRerun={() => {
            void runQuery(tabId);
          }}
          onDismiss={() => setDismissed(true)}
        />
      )}
    </>
  );
}

/**
 * SELECT parse-error status banner. Rendered regardless of run
 * state so the user notices even before pressing Run / when the Monaco
 * squiggle is off-screen. Reads `selectParseErrors[tabId]` written by
 * MonacoEditor on each failing parse.
 *
 * (recovery) — when a tab is hydrated from SQLite and its persisted
 * SQL is corrupted (`ASCLIMIT` was the field-reported example), we don't
 * shout at the user as if they typed it. The banner renders a softer
 * recovery affordance: "this restored query is broken — clear it?" with
 * a single click that resets the editor to empty. As soon as the user
 * actually edits (`dirty === true`), we revert to the live parse-error
 * presentation so the tooling stays useful while typing.
 */
function S20ParseErrorBanner({ tabId }: { tabId: string }): JSX.Element | null {
  const { t } = useTranslation();
  const err = useEditor((s) => s.selectParseErrors.get(tabId) ?? null);
  const tab = useEditor((s) => s.tabs.find((entry) => entry.id === tabId));
  const setContent = useEditor((s) => s.setContent);
  if (!err) return null;

  const isRestoredCorruption =
    tab && tab.kind === "editor" && tab.dirty === false && tab.content.trim().length > 0;

  if (isRestoredCorruption) {
    return (
      <output
        data-testid="select-parse-error-banner"
        style={{
          padding: "6px 10px",
          background: "var(--warn-q-soft, #4a3520)",
          color: "var(--warn-q, #f59e0b)",
          fontSize: 12,
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <span style={{ flex: 1 }}>
          {t("parser.select.restored_invalid", {
            defaultValue:
              "Restored query has a parse error (line {{line}}:{{column}} — {{message}}). It may have been corrupted on autosave.",
            line: err.line,
            column: err.column,
            message: err.message,
          })}
        </span>
        <button
          type="button"
          onClick={() => setContent(tabId, "")}
          data-testid="select-parse-error-reset"
          style={{
            background: "transparent",
            border: "1px solid var(--warn-q, #f59e0b)",
            borderRadius: 4,
            color: "inherit",
            padding: "2px 8px",
            fontSize: 11,
            cursor: "pointer",
          }}
        >
          {t("parser.select.reset", { defaultValue: "Clear and start fresh" })}
        </button>
      </output>
    );
  }

  return (
    <div
      data-testid="select-parse-error-banner"
      role="alert"
      style={{
        padding: "6px 10px",
        background: "var(--err-bg, #5a1f1f)",
        color: "var(--err-fg, #ffdcdc)",
        fontSize: 12,
      }}
    >
      {t("parser.select.error", { defaultValue: "Parse error in query" })}: line {err.line}:
      {err.column} — {err.message}
    </div>
  );
}
