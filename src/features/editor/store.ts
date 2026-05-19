/**
 * editor store — multi-tab state machine + SQLite persistence.
 *
 * State model (§5.2/§5.5):
 * - Tabs are a discriminated union of `editor` and `object` kinds. Editor
 * tabs carry mutable SQL content + dirty state; object tabs are pinned
 * read-only views of a schema node.
 * - `runStates` is keyed per tabId; queries are independent per tab so the
 * user can fire multiple in parallel.
 * - `untitledCounter` is monotonic across the session so closed tabs do
 * not free their N — avoids name collisions when the user reopens.
 *
 * Persistence (§7.2):
 * - `tabs_save` is debounced 500ms per-tab on `setContent` and 200ms on
 * `setCursor`; immediate on connection change / open / close.
 * - `activeTabId` lives in localStorage (UI-only).
 *
 * Tests cover hydrate / open / close / dirty debounce / runQuery success +
 * postgres error position mapping + notConnected.
 */

import type { editor as MonacoEditorNs } from "monaco-editor";
import { create } from "zustand";
import type { ParseError as SelectParseError } from "../../lib/parser";
import {
  type ColumnMeta,
  type Connection,
  ConnectionError,
  type EditorTabRow,
  type ExplainMode,
  type ExplainOptions,
  QueryError,
  connectionSetSlowQueryWarning,
  queryCancel,
  queryCloseCursor,
  queryExplain,
  queryExplainCancel,
  queryExplainCost,
  queryFetchPage,
  recentPlansGet,
  recentPlansSave,
  tabsDelete,
  tabsList,
  tabsSave,
} from "../../lib/tauri";
import { type StatementResult, queryRunBatch } from "../../lib/tauri";
import { useConnections } from "../connections/store";
import { useUiMode } from "../easy-mode/store";
import type { NodeKey } from "../schema/store";
import { useAutocompleteCache } from "./autocomplete/cache";
import { parseSearchPathFromSql } from "./autocomplete/searchPath";
import { preflightBatch } from "./preflightBatch";
import { decideShapeApply } from "./queryShape/applyFromAst";
import type { Filter, QueryShape } from "./queryShape/types";
import { analyzeForEasyAdvisory, analyzeStatement } from "./safety/analyzer";
import { type Statement, splitStatements } from "./sql/splitStatements";

/**
 * Module-private mutable ref to the active Monaco editor instance. Set by
 * `MonacoEditor.tsx` on mount via `setActiveMonacoEditor`, cleared on
 * unmount. Used by `insertSnippetAtCursor` so the snippet palette + future
 * command-palette integrations can drive Monaco's snippet engine without
 * coupling the editor store to the React tree.
 */
const activeMonacoEditor: { current: MonacoEditorNs.ICodeEditor | null } = { current: null };

export function setActiveMonacoEditor(editor: MonacoEditorNs.ICodeEditor | null): void {
  activeMonacoEditor.current = editor;
}

export type EditorTab = {
  id: string;
  kind: "editor";
  name: string;
  content: string;
  connectionId: string | null;
  cursorPos: { line: number; col: number };
  dirty: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ObjectTab = {
  id: string;
  kind: "object";
  nodeKey: NodeKey;
  connectionId: string;
  createdAt: string;
};

export type HistoryTab = {
  id: string;
  kind: "history";
  createdAt: string;
};

/**
 * /10 — EXPLAIN tab spouse.
 *
 * Two flavors share this kind:
 * - **Sourced** (S9): id `explain-${sourceTabId}`, sourceTabId set,
 * cachedRecentPlanId undefined. Spouse of an editor tab; closeTab
 * cascades.
 * - **Cached** (S10): id `explain-cached-${recentPlanId}`,
 * sourceTabId=null, cachedRecentPlanId set. Opened from a Recent
 * Plans row. Toolbar Re-run + WAL/TIMING toggles are greyed; an
 * "Open SQL in editor" button spawns a fresh editor tab from the
 * stored sql + connection.
 *
 * Lives in-memory only (not persisted to SQLite, unlike editor/object).
 */
export type ExplainTab = {
  id: string;
  kind: "explain";
  /** Null when opened from Recent Plans (S10 cached). */
  sourceTabId: string | null;
  /** Set iff sourceTabId === null. Lookup key into recent_plans. */
  cachedRecentPlanId?: string;
  options: ExplainOptions;
  createdAt: string;
};

/**
 * — singleton Recent Plans browser tab. Mirror of HistoryTab
 * (S6) — id is the literal "recent-plans" sentinel; lives in-memory.
 */
export type RecentPlansTab = {
  id: string;
  kind: "recent-plans";
  createdAt: string;
};

/**
 * — one half of a PlanDiffTab. `recent` references a saved row
 * by id (resolves through `recentPlansGet` on render); `runtime` carries
 * an in-memory plan that was generated this session and is NOT in
 * SQLite. Tabs that contain a runtime side are session-only (see
 * `isPersistableTab` + `tabToRow` filter below).
 */
export type PlanDiffSide =
  | { kind: "recent"; recentPlanId: string }
  | {
      kind: "runtime";
      planJson: unknown;
      sql: string;
      connectionId: string | null;
      executedAt: string;
      durationMs: number;
      mode: "explain" | "analyze";
      optionsJson: string;
    };

/**
 * — side-by-side comparison of two EXPLAIN plans. Singleton id is
 * formed from sorted side-keys (`planDiffTabId`) so (A,B) and (B,A) reuse
 * the same tab.
 */
export type PlanDiffTab = {
  id: string;
  kind: "plan-diff";
  left: PlanDiffSide;
  right: PlanDiffSide;
  createdAt: string;
};

/**
 * — Health Screen tab. Singleton per connection: id =
 * `health-${connectionId}`; opening it again switches focus to the
 * existing tab. Session-only — not persisted via tabs_save (the
 * snapshot history lives in SQLite separately).
 */
export type HealthTab = {
  id: string;
  kind: "health";
  connectionId: string;
  createdAt: string;
};

/**
 * — Live Ops Dashboard tab. Singleton per connection: id =
 * `live-ops-${connectionId}`. Session-only (not persisted via tabs_save) —
 * matches Health/History pattern.
 */
export type LiveOpsTab = {
  id: string;
  kind: "live-ops";
  connectionId: string;
  createdAt: string;
};

/**
 * — ERD diagram tab. Singleton per connection: id =
 * `erd-${connectionId}`. Optional `schemas` filter is stored on the tab
 * so the toolbar's filter dropdown is reactive across re-mounts.
 * Session-only — not persisted via tabs_save (matches health / live-ops).
 */
export type ErdTab = {
  id: string;
  kind: "erd";
  connectionId: string;
  /** `undefined` = "all schemas". */
  schemas?: string[];
  createdAt: string;
};

/**
 * — PostGIS Map View tab. Carries a snapshot of result rows + a
 * chosen geometry column. Not persisted (matches ErdTab / HistoryTab pattern).
 */
export type MapViewTab = {
  id: string;
  kind: "map-view";
  connectionId: string | null;
  rowsSnapshot: string[][];
  columns: ColumnMeta[];
  geometryColumn: string;
  createdAt: string;
};

/**
 * — singleton-per-connection pg_stat_statements tab. Holds no
 * data of its own; the body fetches via queryExecute on mount/refresh.
 * Not persisted (matches Health/LiveOps/MapView pattern).
 */
export type PgStatStatementsTab = {
  id: string;
  kind: "pg-stat-statements";
  connectionId: string;
  createdAt: string;
};

/**
 * — Migration engine tab. Singleton per connection: id =
 * `migrations-${connectionId}`. Session-only — not persisted via tabs_save
 * (matches health / live-ops / erd).
 */
export type MigrationsTab = {
  id: string;
  kind: "migrations";
  connectionId: string;
  createdAt: string;
};

/**
 * — Object-editor tab. Per-target singleton:
 * id = `object-editor-${connectionId}-${objectKind}-${schema}-${name | "_new"}-${mode}`
 * Session-only — not persisted via tabs_save (matches erd / migrations).
 */
export type ObjectEditorTab = {
  id: string;
  kind: "object-editor";
  connectionId: string;
  target: {
    objectKind:
      | "table"
      | "view"
      | "matview"
      | "index"
      | "sequence"
      | "function"
      | "procedure"
      | "trigger"
      | "fdw_server"
      | "publication"
      | "subscription"
      | "role"
      | "enum_type"
      | "composite_type"
      | "domain_type"
      | "range_type";
    mode: "create" | "edit";
    schema: string;
    /** undefined when mode === "create". For mode === "create" + objectKind === "index", this carries the parent table name. */
    name?: string;
    /** For new index opened from a table context. */
    parentTable?: string;
  };
  createdAt: string;
};

/**
 * — Notebook tab (Jupyter-style для SQL). Per-notebook id matches
 * the SQLite row's `id` column (`nb-<uuid>`) so reload restores by lookup.
 * Body lives in `features/notebook/store.ts`; tab itself just carries
 * persistence pointer.
 */
export type NotebookTab = {
  id: string;
  kind: "notebook";
  /** Notebook id (matches `notebooks.id` in SQLite). */
  notebookId: string;
  /** Loose binding — last connection used for run-cell. Cells run против
   * this connection by default; UI допускает override per-run. */
  connectionId: string | null;
  createdAt: string;
};

/**
 * — Backup/Restore center tab. Singleton per connection:
 * id = `backup-${connectionId}`. Hosts the Backup wizard, Restore wizard,
 * Schedule manager. Session-only.
 */
export type BackupTab = {
  id: string;
  kind: "backup";
  connectionId: string;
  createdAt: string;
};

export type Tab =
  | EditorTab
  | ObjectTab
  | HistoryTab
  | ExplainTab
  | RecentPlansTab
  | PlanDiffTab
  | HealthTab
  | LiveOpsTab
  | ErdTab
  | MapViewTab
  | PgStatStatementsTab
  | MigrationsTab
  | ObjectEditorTab
  | NotebookTab
  | BackupTab;

/**
 * Discriminated error shape: `code` is an i18n key (or "raw" for already-
 * localized text from a backend / Postgres). ResultPanel translates by code
 * so we never display raw keys to the user (audit C5).
 */
export type RunErrorCode =
  | "no_connection"
  | "not_connected"
  | "pool_error"
  | "storage_error"
  | "postgres_error"
  | "cursor_lost"
  | "read_only_blocked"
  | "unknown";

/** — discriminator parallel to `RunErrorCode` for EXPLAIN-specific
 * surfaces (parse errors, source-closed cascades). */
export type ExplainErrorCode =
  | "no_connection"
  | "not_connected"
  | "pool_error"
  | "postgres_error"
  | "read_only_blocked"
  | "parse_error"
  | "source_closed"
  | "cancelled"
  | "unknown";

export type ExplainRunState =
  | { status: "idle" }
  | { status: "running"; startedAt: number; cancelable: true }
  | {
      status: "ready";
      plan: unknown;
      durationMs: number;
      statusMessage: string;
      ranAt: number;
      /** — the SQL that produced this plan, captured at run time
       * so `[Diff with…]` can build a runtime PlanDiffSide without re-reading
       * the (potentially mutated) source EditorTab content. */
      executedSql: string;
    }
  | {
      status: "error";
      code: Exclude<ExplainErrorCode, "cancelled">;
      detail?: string;
      line?: number;
      col?: number;
      /** — SQLSTATE forwarded for the Explain-button on this surface. */
      sqlstate?: string;
    }
  | { status: "cancelled" };

export interface SortState {
  /** Source-column index (NOT post-reorder display index). */
  columnIdx: number;
  dir: "asc" | "desc";
}

export type RunState =
  | { status: "idle" }
  | { status: "opening"; startedAt: number; cancelable: true }
  | {
      status: "streaming";
      /** `null` when the result is fully inline (DML or single-page rowset). */
      cursorId: string | null;
      columns: ColumnMeta[];
      rows: Array<Array<string | null>>;
      loadedCount: number;
      exhausted: boolean;
      durationMs: number;
      prefetching: boolean;
      affectedRows: number | null;
      statusMessage: string;
      sort: SortState | null;
      columnWidths: Map<number, number>;
      columnOrder: number[];
    }
  | {
      status: "error";
      code: Exclude<RunErrorCode, "cancelled">;
      /** Backend-provided message; merged into the localized template. */
      detail?: string;
      line?: number;
      col?: number;
      /** — five-character SQLSTATE when backend provided one. */
      sqlstate?: string;
    }
  | { status: "cancelled" };

/**
 * Post-S14 — discriminated union describing what the user asked Run to do:
 * - `current`   : one statement under the cursor (default for Cmd+Enter).
 * - `selection` : every statement inside the editor's non-empty selection.
 * - `all`       : every statement in the whole tab.
 * - `explicit`  : caller-provided SQL string (legacy `runQuery(_, "SQL")`).
 * - `noop`      : explicit no-op so callers can short-circuit cleanly.
 */
export type RunIntent =
  | { kind: "current" }
  | { kind: "selection"; text: string }
  | { kind: "all" }
  | { kind: "explicit"; text: string }
  | { kind: "noop" };

/**
 * Post-S14 multi-statement batch run state — keyed by tabId in
 * `batchRunStates`. The `ready` variant carries every statement's outcome
 * (rowset/dml/error) so the result-panel tab strip can render N tabs from
 * one source of truth. `activeIdx` mirrors the legacy `runStates[tabId]`
 * — see `setActiveBatchTab`.
 */
export type BatchRunState =
  | { status: "idle" }
  | { status: "opening"; startedAt: number; cancelable: boolean }
  | {
      status: "ready";
      statements: StatementResult[];
      activeIdx: number;
      totalDurationMs: number;
      failedAt: number | null;
    };

/** — modal coordination for the pre-execute safety pipeline. */
export type SafetyModalState =
  | { kind: "none" }
  | {
      kind: "confirm";
      action: string;
      target: string;
      environment: string;
      onConfirm: () => void;
      onCancel: () => void;
    }
  | {
      kind: "slow";
      cost: number;
      onProceed: (dontAskAgain: boolean) => void;
      onCancel: () => void;
    }
  | {
      kind: "batchConfirm";
      total: number;
      environment: import("../../lib/tauri").Environment;
      databaseName: string;
      destructive: Array<{ index: number; action: string; target: string; snippet: string }>;
      onConfirm: () => void;
      onCancel: () => void;
    }
  | {
      /**
       * — Easy-mode advisory (cross-join / slow-preview). Surfaced
       * via `SlowQueryWarningModal` with a different body. Only fires in
       * Easy mode, ahead of the legacy preflight pipeline.
       */
      kind: "easyAdvisory";
      advisory: import("./safety/analyzer").EasyAdvisory;
      onProceed: () => void;
      onCancel: () => void;
    };

export interface EditorState {
  tabs: Tab[];
  activeTabId: string | null;
  runStates: Map<string, RunState>;
  /** — keyed by ExplainTab.id, parallel to runStates so the existing
   * RunState shape stays untouched and EXPLAIN-specific status fields
   * (`plan`, `durationMs`, etc) don't pollute the editor-tab union. */
  explainRunStates: Map<string, ExplainRunState>;
  /**
   * Post-S14 — multi-statement support. Cached current-statement is kept
   * fresh by MonacoEditor (Phase E) so `runQuery({kind: "current"})` doesn't
   * have to recompute splitStatements on every Run. Per-tab so each editor
   * tab tracks its own cursor.
   */
  currentStatementByTab: Map<string, Statement | null>;
  /**
   * Mirror of the editor's current non-empty selection text (or null when
   * nothing is selected). MonacoEditor writes to it on selection-change; the
   * RunToolbar reads it to render the "run selection" caption. Without this
   * mirror the toolbar can't reactively show the selection snippet —
   * `window.getSelection()` doesn't return Monaco selections.
   */
  selectionByTab: Map<string, string | null>;
  /** Post-S14 — per-tab batch run state, parallel to `runStates`. */
  batchRunStates: Map<string, BatchRunState>;
  /**
   * — canonical SELECT shape per tab. Populated by MonacoEditor on
   * each successful parse of the editor text; cleared / left null when the
   * tab's content isn't a SELECT or fails to parse. Read by ResultGrid header
   * filters + RerunBanner; written via `applyShapeFromAst`, `setFilter`, and
   * `clearFilters`.
   */
  queryShapes: Map<string, QueryShape | null>;
  /** — parser warnings produced alongside each `queryShape`. */
  shapeWarnings: Map<string, string[]>;
  /**
   * — snapshot of `queryShapes.get(tabId)` at the moment the most
   * recent runQuery fired. RerunBanner compares this against the live shape
   * to decide whether to surface a "filters changed — re-run?" prompt.
   */
  lastExecutedShape: Map<string, QueryShape | null>;
  /**
   * last SELECT parse error per tab so ResultPanel can
   * render a human-readable status banner alongside the Monaco squiggle.
   * Cleared on next successful parse or empty buffer.
   */
  selectParseErrors: Map<string, SelectParseError | null>;
  /**
   * bumped every time the live `queryShape.filters`
   * for a tab differs from the prior render's filters. RerunBanner uses
   * this version as a `useEffect` dep so dismissing the banner only hides
   * THIS filter change; the next change reveals the banner again.
   */
  filterChangeVersion: Map<string, number>;
  untitledCounter: number;
  hydrated: boolean;
  safetyModal: SafetyModalState;
}

export interface EditorActions {
  hydrateFromSqlite(): Promise<void>;
  openEditorTab(connId?: string | null, options?: { prefillSql?: string }): EditorTab;
  openObjectTab(nodeKey: NodeKey, connId: string): ObjectTab;
  openHistoryTab(): HistoryTab;
  closeTab(id: string, opts?: { force?: boolean }): Promise<boolean>;
  switchTab(id: string): void;
  setContent(id: string, content: string): void;
  setCursor(id: string, line: number, col: number): void;
  /**
   * Rename an editor tab. No-ops for non-editor kinds (their labels are
   * derived from other state — e.g. health/erd/object tabs). Persists
   * immediately because renames are infrequent and surfacing a stale name
   * after restart would be more confusing than the cost of one IPC.
   */
  renameEditorTab(id: string, name: string): void;
  setTabConnection(id: string, connId: string | null): void;
  closeObjectTabsForConnection(connId: string): Promise<void>;
  runQuery(tabId: string, intent?: RunIntent | null | string): Promise<void>;
  /** Post-S14 — switch the active sub-tab inside a batch result. Mirrors the
   * newly-active statement's outcome into legacy `runStates`. */
  setActiveBatchTab(tabId: string, idx: number): void;
  fetchMore(tabId: string): Promise<void>;
  cancelRun(tabId: string): void;
  setSort(tabId: string, columnIdx: number, dir: "asc" | "desc" | null): void;
  setColumnWidth(tabId: string, srcColumnIdx: number, widthPx: number): void;
  setColumnOrder(tabId: string, nextOrder: number[]): void;
  /** Returns the connection id of the currently active tab, or null. Used by autocomplete. */
  getActiveConnId(): string | null;
  /**
   * Insert a snippet body at the active Monaco cursor via
   * `editor.action.insertSnippet` so $1/$2/$0 placeholders work. No-op
   * when no editor is mounted (e.g. test environment without a host).
   */
  insertSnippetAtCursor(body: string): void;
  /** — kick off EXPLAIN [ANALYZE] from a source editor tab. */
  runExplain(sourceTabId: string, mode: ExplainMode): Promise<void>;
  /** Toggle one of verbose / wal / timing on an existing explain tab.
   * Does NOT auto-trigger re-run — user must press Re-run explicitly. */
  toggleExplainOption(explainTabId: string, key: "verbose" | "wal" | "timing"): void;
  /** Re-run an existing explain tab with its current options. */
  rerunExplain(explainTabId: string): Promise<void>;
  /** Best-effort cancel of an in-flight EXPLAIN. */
  cancelExplain(explainTabId: string): void;
  /** — open the singleton Recent Plans browser tab. */
  openRecentPlansTab(): RecentPlansTab;
  /** — spawn (or focus) a cached ExplainTab from a stored
   * Recent Plan row. No backend round-trip — runState is set ready
   * inline from the row's plan_json. */
  openCachedExplain(row: import("../../lib/tauri").RecentPlanRow): ExplainTab;
  /** — spawn an editor tab pre-filled with the SQL from a
   * cached Recent Plan. Reuses the original connection if alive. */
  openEditorFromRecent(recentPlanId: string): Promise<void>;
  /** — open or focus a singleton PlanDiffTab for the given pair
   * of sides. Tab id is commutative (see `planDiffTabId`). */
  openPlanDiff(left: PlanDiffSide, right: PlanDiffSide): PlanDiffTab;
  /** — swap left↔right in-place. Tab id stays the same because
   * the singleton-id formula is commutative. */
  swapPlanDiff(tabId: string): void;
  /** — spawn an editor tab pre-filled with an insight's
   * suggested SQL. Resolves the source connection via the source ExplainTab
   * (cached → recentPlansGet, runtime → source EditorTab chain). */
  openEditorFromInsight(
    sourceTabId: string,
    insight: import("./explain/insights").Insight,
  ): Promise<void>;
  /** — open or focus the singleton Health tab for the given
   * connection id. Health tabs are session-only (not persisted). */
  openHealthTab(connectionId: string): HealthTab;
  /** — open or focus the singleton Live Ops tab for the given
   * connection id. Session-only, mirrors openHealthTab. */
  openLiveOpsTab(connectionId: string): LiveOpsTab;
  /** — open or focus the singleton ERD tab for the given
   * connection id. Session-only, mirrors openHealthTab. `options.schemas`
   * sets the initial schema filter (default: all schemas — `undefined`). */
  openErdTab(connectionId: string, options?: { schemas?: string[] }): ErdTab;
  openMapViewTab(input: {
    connectionId: string | null;
    rowsSnapshot: string[][];
    columns: ColumnMeta[];
    geometryColumn: string;
  }): MapViewTab;
  /** — open or focus the singleton pg_stat_statements tab for
   * the given connection. Session-only. */
  openPgStatStatementsTab(connectionId: string): PgStatStatementsTab;
  /** — update the schema filter on an existing ERD tab. */
  setErdTabSchemas(tabId: string, schemas: string[] | undefined): void;
  /** — open or focus the singleton Migrations tab for the given
   * connection id. Session-only, mirrors openHealthTab. */
  openMigrationsTab(connectionId: string): MigrationsTab;
  /** — open or focus a Notebook tab.
   *
   * Каждый notebook получает уникальный tab id (`nb-tab-<notebookId>`).
   * Не singleton: пользователь может открыть несколько notebooks за раз,
   * но один и тот же notebook id фокусирует существующую вкладку. */
  openNotebookTab(notebookId: string, connectionId: string | null): NotebookTab;
  /** — open or focus the singleton Backup/Restore tab for the
   * given connection. Session-only, mirrors openHealthTab. */
  openBackupTab(connectionId: string): BackupTab;
  /** — open or focus a per-target object-editor tab. Re-opening
   * the same target focuses the existing tab. Session-only. */
  openObjectEditor(params: {
    connectionId: string;
    objectKind: ObjectEditorTab["target"]["objectKind"];
    mode: ObjectEditorTab["target"]["mode"];
    schema: string;
    name?: string;
    parentTable?: string;
  }): ObjectEditorTab;
  /** Post-S14 — cache the editor's current statement for `runQuery({kind: "current"})`. */
  setCurrentStatement(tabId: string, stmt: Statement | null): void;
  /** Post-S14 — mirror the editor's current non-empty selection text. */
  setSelection(tabId: string, text: string | null): void;
  /** — patch a single cell in a streaming RunState in place after
   * a successful JSONB save, so the user sees the new value without
   * re-running the query. No-op when the run isn't streaming. */
  patchRowCell(tabId: string, rowIdx: number, srcColIdx: number, value: string): void;
  /**
   * — replace (or remove) the filter on `columnName` inside the
   * tab's `queryShape`. Keyed by NAME rather than index because the result
   * grid supports column reorder, so an index would drift. No-op when the
   * tab has no shape (parse-failure / non-SELECT).
   */
  setFilter(tabId: string, columnName: string, filter: Filter | null): void;
  /** — drop every filter on the tab's queryShape. */
  clearFilters(tabId: string): void;
  /**
   * — fold a freshly-parsed shape into the store. Delegates to
   * `decideShapeApply` for the apply / skip-unrepresentable / noop-equal
   * decision so the diff logic stays unit-testable.
   */
  applyShapeFromAst(tabId: string, shape: QueryShape, warnings: string[]): void;
  /**
   * — snapshot the current shape into `lastExecutedShape`. Called
   * by `runQuery` at the moment the cursor is opened so RerunBanner can
   * detect post-run filter edits.
   */
  markShapeExecuted(tabId: string): void;
  /** — convenience reader. Returns null when the tab has no shape. */
  getQueryShape(tabId: string): QueryShape | null;
  /**
   * store the most recent SELECT parse error so
   * ResultPanel can render a banner. Pass null to clear.
   */
  setSelectParseError(tabId: string, err: SelectParseError | null): void;
  getSelectParseError(tabId: string): SelectParseError | null;
}

export type EditorStore = EditorState & EditorActions;

const ACTIVE_TAB_STORAGE_KEY = "ide99:editor.activeTabId";

/**
 * Per-tab debounce timers for content + cursor persistence. Module-private
 * so two store instances in the same process would share — but the store is
 * a singleton, so this is fine in practice.
 */
const contentDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
const cursorDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

function readActiveTabFromStorage(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(ACTIVE_TAB_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeActiveTabToStorage(id: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (id === null) {
      window.localStorage.removeItem(ACTIVE_TAB_STORAGE_KEY);
    } else {
      window.localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, id);
    }
  } catch {
    // best-effort
  }
}

/**
 * — deterministic tab id for a `PlanDiffTab`. Sorts side-keys so
 * the order of the (left, right) arguments is irrelevant — `(A,B)` and
 * `(B,A)` both produce `plan-diff-r:A-r:B`. Runtime sides hash their
 * planJson so identical-content runtime plans deduplicate.
 */
export function planDiffTabId(left: PlanDiffSide, right: PlanDiffSide): string {
  const keys = [sideKey(left), sideKey(right)].sort();
  return `plan-diff-${keys[0]}-${keys[1]}`;
}

function sideKey(side: PlanDiffSide): string {
  if (side.kind === "recent") return `r:${side.recentPlanId}`;
  return `rt:${runtimeSideHash(side.planJson)}`;
}

/**
 * Stable short hash of a plan-json value for runtime side dedup. Uses
 * djb2 over the JSON.stringify form — collision-resistant enough for the
 * "did the user already open this exact diff" check, and ASCII-safe for
 * the tab id.
 */
function runtimeSideHash(planJson: unknown): string {
  const text = JSON.stringify(planJson) ?? "";
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    h = (h * 33) ^ text.charCodeAt(i);
  }
  return (h >>> 0).toString(16);
}

/** Convert a Tab into the wire-format EditorTabRow expected by `tabs_save`.
 *
 * History and explain (S9) tabs are session-scope and never persist —
 * callers must guard with `tab.kind === "editor" || tab.kind === "object"`
 * before invoking. The fall-through branch throws so a missed guard
 * surfaces immediately in dev.
 */
function tabToRow(tab: Tab): EditorTabRow {
  if (tab.kind === "editor") {
    return {
      id: tab.id,
      kind: "editor",
      name: tab.name,
      content: tab.content,
      connectionId: tab.connectionId,
      nodeKey: null,
      cursorLine: tab.cursorPos.line,
      cursorCol: tab.cursorPos.col,
      createdAt: tab.createdAt,
      updatedAt: tab.updatedAt,
    };
  }
  if (tab.kind === "object") {
    return {
      id: tab.id,
      kind: "object",
      name: tab.nodeKey,
      content: "",
      connectionId: tab.connectionId,
      nodeKey: tab.nodeKey,
      cursorLine: 1,
      cursorCol: 1,
      createdAt: tab.createdAt,
      updatedAt: tab.createdAt,
    };
  }
  if (tab.kind === "plan-diff") {
    // — only recent×recent pairs persist; runtime sides are
    // session-only (the plan_json blob is too large + likely stale on
    // restart). Caller (`persistTab`) guards via `isPersistableTab` first;
    // this throw is a defensive net.
    if (tab.left.kind !== "recent" || tab.right.kind !== "recent") {
      throw new Error(`tabToRow called for plan-diff with runtime side: ${tab.id}`);
    }
    return {
      id: tab.id,
      kind: "plan-diff",
      // Stuff both side ids into `name` (re-used as a slot). Loader splits on
      // `|` to recover. Format: `${leftRecentPlanId}|${rightRecentPlanId}`.
      name: `${tab.left.recentPlanId}|${tab.right.recentPlanId}`,
      content: "",
      connectionId: null,
      nodeKey: null,
      cursorLine: 1,
      cursorCol: 1,
      createdAt: tab.createdAt,
      updatedAt: tab.createdAt,
    };
  }
  throw new Error(`tabToRow called for non-persistable kind: ${tab.kind}`);
}

/** Convert a wire-format EditorTabRow into a Tab discriminated-union value. */
function rowToTab(row: EditorTabRow): Tab | null {
  if (row.kind === "editor") {
    return {
      id: row.id,
      kind: "editor",
      name: row.name,
      content: row.content,
      connectionId: row.connectionId,
      cursorPos: { line: row.cursorLine, col: row.cursorCol },
      dirty: false,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
  if (row.kind === "object") {
    if (row.nodeKey === null || row.connectionId === null) {
      // Malformed row — skip; user can re-open.
      return null;
    }
    return {
      id: row.id,
      kind: "object",
      nodeKey: row.nodeKey,
      connectionId: row.connectionId,
      createdAt: row.createdAt,
    };
  }
  if (row.kind === "plan-diff") {
    const parts = row.name.split("|");
    if (parts.length !== 2 || parts[0] === "" || parts[1] === "") return null;
    return {
      id: row.id,
      kind: "plan-diff",
      left: { kind: "recent", recentPlanId: parts[0] },
      right: { kind: "recent", recentPlanId: parts[1] },
      createdAt: row.createdAt,
    };
  }
  return null;
}

/**
 * Map a 1-based PG character offset into (line, col), counting `\n`s.
 *
 * Exposed for unit tests; `runQuery` calls it inline.
 */
export function mapPositionToLineCol(sql: string, pos: number): { line: number; col: number } {
  if (pos < 1) return { line: 1, col: 1 };
  const upTo = sql.substring(0, pos - 1);
  const newlineCount = (upTo.match(/\n/g) ?? []).length;
  const lastNewlineIdx = upTo.lastIndexOf("\n");
  const line = newlineCount + 1;
  const col = lastNewlineIdx === -1 ? pos : pos - lastNewlineIdx - 1;
  return { line, col };
}

/**
 * Compute the next untitled counter from a list of editor tab names.
 * Names follow `untitled-{N}`; missing or malformed entries are ignored.
 */
function maxUntitledCounter(tabs: Tab[]): number {
  let max = 0;
  for (const tab of tabs) {
    if (tab.kind !== "editor") continue;
    const m = /^untitled-(\d+)$/.exec(tab.name);
    if (m) {
      const n = Number.parseInt(m[1], 10);
      if (!Number.isNaN(n) && n > max) max = n;
    }
  }
  return max;
}

function isPersistableTab(tab: Tab): boolean {
  if (tab.kind === "editor" || tab.kind === "object") return true;
  if (tab.kind === "plan-diff") {
    return tab.left.kind === "recent" && tab.right.kind === "recent";
  }
  return false;
}

function persistTab(tab: Tab): void {
  if (!isPersistableTab(tab)) return;
  void tabsSave(tabToRow(tab)).catch(() => {
    // Persistence is best-effort — swallow to avoid breaking the UI when
    // SQLite is briefly busy. The next `setContent` debounce will retry.
  });
}

export type PreflightOutcome = "ok" | "cancelled" | "read_only_blocked";

/**
 * safety pipeline, extracted in so `runExplain(analyze)`
 * can reuse it. STEP 1 (analyze) → STEP 2 (read-only gate) → STEP 3
 * (destructive confirm modal) → STEP 4 (slow-query modal). Returns:
 * - "ok"                 — caller may proceed.
 * - "read_only_blocked"  — connection forbids the write; caller should
 * surface the matching error code.
 * - "cancelled"          — user dismissed a modal; caller should surface
 * cancelled status.
 *
 * The `set` callback drives `safetyModal` so the existing modal components
 * keep working without leaking store internals here. Behavior must remain
 * identical to the pre-refactor inline form — `runQuery.safety.test.ts`
 * is the regression net.
 */
export async function preflightSafety(
  conn: Connection | undefined,
  sql: string,
  set: (partial: Partial<EditorState>) => void,
): Promise<PreflightOutcome> {
  if (!conn) return "ok";
  const analysis = analyzeStatement(sql);

  // STEP 2: read-only gate.
  const isWrite =
    analysis.kind === "destructive" ||
    /^(insert|update|delete|create|alter|drop|truncate|grant|revoke)\b/i.test(sql.trimStart());
  if (conn.readOnly && isWrite) return "read_only_blocked";

  // STEP 3: destructive confirm gate.
  if (analysis.kind === "destructive") {
    const env = conn.environment;
    const triggers =
      env === "prod" || ((env === "dev" || env === "stage") && conn.confirmDestructive);
    if (triggers) {
      const confirmed = await new Promise<boolean>((resolve) => {
        set({
          safetyModal: {
            kind: "confirm",
            action: (analysis.action ?? "drop").toUpperCase(),
            target: analysis.target ?? "",
            environment: env,
            onConfirm: () => {
              set({ safetyModal: { kind: "none" } });
              resolve(true);
            },
            onCancel: () => {
              set({ safetyModal: { kind: "none" } });
              resolve(false);
            },
          },
        });
      });
      if (!confirmed) return "cancelled";
    }
  }

  // STEP 4: slow-query warning (only for read-heavy SELECT or write-with-WHERE).
  if (
    conn.slowQueryWarning &&
    analysis.kind === "safe" &&
    /^(select|with|update|delete)\b/i.test(sql.trimStart())
  ) {
    let cost: number | null = null;
    try {
      cost = await queryExplainCost(conn.id, sql);
    } catch {
      // Never block on infra hiccup — let the query through.
    }
    if (cost !== null && cost > 100_000) {
      const proceed = await new Promise<boolean>((resolve) => {
        set({
          safetyModal: {
            kind: "slow",
            cost: cost ?? 0,
            onProceed: (dontAskAgain) => {
              set({ safetyModal: { kind: "none" } });
              if (dontAskAgain) {
                void connectionSetSlowQueryWarning(conn.id, false).catch(() => undefined);
              }
              resolve(true);
            },
            onCancel: () => {
              set({ safetyModal: { kind: "none" } });
              resolve(false);
            },
          },
        });
      });
      if (!proceed) return "cancelled";
    }
  }
  return "ok";
}

/**
 * Post-S14 — translate a `RunIntent` plus the editor tab content into the
 * concrete list of statement SQL strings that goes to `query_run_batch`.
 *
 * - `noop`      → []
 * - `explicit`  → [text] (trimmed, dropped when empty)
 * - `selection` → split the selection, never mixes with surrounding tab
 * - `all`       → split the whole tab content
 * - `current`   → the cached current-statement (kept fresh by the editor
 * on selection-change), or the first parsed statement as
 * a fallback for test paths that never wired Monaco.
 */
function resolveStatements(
  content: string,
  tabId: string,
  intent: RunIntent,
  get: () => EditorState,
): string[] {
  if (intent.kind === "noop") return [];
  if (intent.kind === "explicit") {
    const t = intent.text.trim();
    return t.length === 0 ? [] : [t];
  }
  if (intent.kind === "selection") {
    return splitStatements(intent.text)
      .map((s) => s.text)
      .filter((t) => t.length > 0);
  }
  if (intent.kind === "all") {
    return splitStatements(content)
      .map((s) => s.text)
      .filter((t) => t.length > 0);
  }
  // current
  const cached = get().currentStatementByTab.get(tabId) ?? null;
  if (cached && cached.text.length > 0) return [cached.text];
  const stmts = splitStatements(content);
  const fallback = stmts.find((s) => s.text.length > 0);
  return fallback ? [fallback.text] : [];
}

/**
 * Post-S14 — convert a single backend `StatementResult` into the legacy
 * `RunState` shape so selectors that still read `runStates` keep working
 * for the active sub-tab. `sourceSql` lets us recompute (line, col) for
 * postgres errors that report a 1-based character offset.
 */
function mapStatementToRunState(s: StatementResult | undefined, sourceSql: string): RunState {
  if (!s) return { status: "idle" };
  if (s.kind === "rowset") {
    return {
      status: "streaming",
      cursorId: s.cursorId,
      columns: s.columns,
      rows: s.rows,
      loadedCount: s.rows.length,
      // backend now sets `exhausted` explicitly. cursorId can
      // be a real id even when there's nothing more to fetch (so the
      // jsonb editor can resolve finished-cursor metadata).
      exhausted: s.exhausted,
      durationMs: s.durationMs,
      prefetching: false,
      affectedRows: null,
      statusMessage: s.statusMessage,
      sort: null,
      columnWidths: new Map(),
      columnOrder: s.columns.map((_, i) => i),
    };
  }
  if (s.kind === "dml") {
    return {
      status: "streaming",
      cursorId: null,
      columns: [],
      rows: [],
      loadedCount: 0,
      exhausted: true,
      durationMs: s.durationMs,
      prefetching: false,
      affectedRows: s.affectedRows,
      statusMessage: s.statusMessage,
      sort: null,
      columnWidths: new Map(),
      columnOrder: [],
    };
  }
  // error variant
  if (s.error.kind === "postgresError") {
    const sqlstate = s.error.sqlstate ?? undefined;
    if (s.error.position !== null) {
      const { line, col } = mapPositionToLineCol(sourceSql || s.sql, s.error.position);
      return {
        status: "error",
        code: "postgres_error",
        detail: s.error.message,
        line,
        col,
        sqlstate,
      };
    }
    return {
      status: "error",
      code: "postgres_error",
      detail: s.error.message,
      sqlstate,
    };
  }
  if (s.error.kind === "cancelled") return { status: "cancelled" };
  if (s.error.kind === "notConnected") return { status: "error", code: "not_connected" };
  if (s.error.kind === "poolError")
    return { status: "error", code: "pool_error", detail: s.error.message };
  if (s.error.kind === "cursorNotFound") return { status: "error", code: "cursor_lost" };
  if (s.error.kind === "storageError")
    return { status: "error", code: "storage_error", detail: s.error.message };
  return { status: "error", code: "unknown" };
}

/**
 * Post-S14 — same shape as the pre-refactor `runQuery` catch arm, factored
 * out so the new body stays readable. Mirrors only the LEGACY `runStates`
 * value; the batch state is set to `idle` by the caller.
 */
function mapInvokeErrorToRunState(err: unknown, sourceSql: string): RunState {
  if (err instanceof QueryError) {
    if (err.kind === "cancelled") return { status: "cancelled" };
    if (err.kind === "postgresError" && err.position !== null) {
      const { line, col } = mapPositionToLineCol(sourceSql, err.position);
      return {
        status: "error",
        code: "postgres_error",
        detail: err.message,
        line,
        col,
        sqlstate: err.sqlstate ?? undefined,
      };
    }
    if (err.kind === "postgresError")
      return {
        status: "error",
        code: "postgres_error",
        detail: err.message,
        sqlstate: err.sqlstate ?? undefined,
      };
    if (err.kind === "notConnected") return { status: "error", code: "not_connected" };
    if (err.kind === "poolError")
      return { status: "error", code: "pool_error", detail: err.message };
    if (err.kind === "cursorNotFound") return { status: "error", code: "cursor_lost" };
    return { status: "error", code: "storage_error", detail: err.message };
  }
  const detail = err instanceof Error ? err.message : String(err);
  return { status: "error", code: "unknown", detail };
}

/**
 * — default option payload for a freshly-created EXPLAIN tab.
 * `timing` is on by default for ANALYZE (the actual reason most users
 * reach for ANALYZE) and off otherwise.
 */
function defaultExplainOptions(mode: ExplainMode): ExplainOptions {
  return { mode, verbose: false, wal: false, timing: mode === "analyze" };
}

/**
 * — selection text from the active Monaco editor, or null when
 * there's no editor mounted (test env) or the selection is empty/collapsed.
 * Caller falls back to the tab's full content.
 */
function getActiveSelection(): string | null {
  const ed = activeMonacoEditor.current;
  if (!ed) return null;
  const sel = ed.getSelection();
  if (!sel || sel.isEmpty()) return null;
  const model = ed.getModel();
  if (!model) return null;
  return model.getValueInRange(sel);
}

export const useEditor = create<EditorStore>((set, get) => ({
  tabs: [],
  activeTabId: null,
  runStates: new Map(),
  explainRunStates: new Map(),
  currentStatementByTab: new Map(),
  selectionByTab: new Map(),
  batchRunStates: new Map(),
  queryShapes: new Map(),
  shapeWarnings: new Map(),
  lastExecutedShape: new Map(),
  selectParseErrors: new Map(),
  filterChangeVersion: new Map(),
  untitledCounter: 0,
  hydrated: false,
  safetyModal: { kind: "none" },

  hydrateFromSqlite: async () => {
    let rows: Awaited<ReturnType<typeof tabsList>>;
    try {
      rows = await tabsList();
    } catch (err) {
      // SQLite hydrate failed (corrupt file, migration failure, disk-full).
      // Mark the store as hydrated with zero tabs so the empty-state renders;
      // surface the failure via console so dev sees it. The user can still
      // open new tabs via Cmd+T — they just won't be persisted until next
      // run if storage is genuinely broken.
      // eslint-disable-next-line no-console
      console.error("[editor] hydrate failed", err);
      set({ tabs: [], activeTabId: null, untitledCounter: 0, hydrated: true });
      return;
    }
    const tabs: Tab[] = [];
    for (const row of rows) {
      const tab = rowToTab(row);
      if (tab !== null) tabs.push(tab);
    }
    const counter = maxUntitledCounter(tabs);
    const stored = readActiveTabFromStorage();
    const activeTabId =
      stored !== null && tabs.some((t) => t.id === stored)
        ? stored
        : tabs.length > 0
          ? tabs[0].id
          : null;
    set({
      tabs,
      activeTabId,
      untitledCounter: counter,
      hydrated: true,
    });
  },

  openEditorTab: (connId, options) => {
    const state = get();
    const nextCounter = state.untitledCounter + 1;
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const now = new Date().toISOString();
    const tab: EditorTab = {
      id,
      kind: "editor",
      name: `untitled-${nextCounter}`,
      content: options?.prefillSql ?? "",
      connectionId: connId ?? null,
      cursorPos: { line: 1, col: 1 },
      dirty: false,
      createdAt: now,
      updatedAt: now,
    };
    set({
      tabs: [...state.tabs, tab],
      activeTabId: id,
      untitledCounter: nextCounter,
    });
    writeActiveTabToStorage(id);
    persistTab(tab);
    return tab;
  },

  openHistoryTab: () => {
    const state = get();
    const existing = state.tabs.find((t): t is HistoryTab => t.kind === "history");
    if (existing) {
      set({ activeTabId: existing.id });
      writeActiveTabToStorage(existing.id);
      return existing;
    }
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? `hist-${crypto.randomUUID()}`
        : `hist-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const tab: HistoryTab = {
      id,
      kind: "history",
      createdAt: new Date().toISOString(),
    };
    set({
      tabs: [...state.tabs, tab],
      activeTabId: id,
    });
    writeActiveTabToStorage(id);
    return tab;
  },

  openObjectTab: (nodeKey, connId) => {
    const state = get();
    const existing = state.tabs.find((t) => t.id === nodeKey);
    if (existing && existing.kind === "object") {
      set({ activeTabId: existing.id });
      writeActiveTabToStorage(existing.id);
      return existing;
    }
    const tab: ObjectTab = {
      id: nodeKey,
      kind: "object",
      nodeKey,
      connectionId: connId,
      createdAt: new Date().toISOString(),
    };
    set({
      tabs: [...state.tabs, tab],
      activeTabId: tab.id,
    });
    writeActiveTabToStorage(tab.id);
    persistTab(tab);
    return tab;
  },

  closeTab: async (id, _opts) => {
    const state = get();
    const idx = state.tabs.findIndex((t) => t.id === id);
    if (idx === -1) return true;
    const closingTab = state.tabs[idx];

    // lifecycle hook: leaving a streaming state with a live cursor
    // means the backend still holds an open transaction. Fire-and-forget
    // close so the pool reclaims the client.
    const closingRun = state.runStates.get(id);
    if (closingRun?.status === "streaming" && closingRun.cursorId !== null) {
      void queryCloseCursor(closingRun.cursorId).catch(() => {});
    }

    // Cancel any pending debounced persistence for this tab — the deletion
    // wins.
    const pendingContent = contentDebounceTimers.get(id);
    if (pendingContent !== undefined) {
      clearTimeout(pendingContent);
      contentDebounceTimers.delete(id);
    }
    const pendingCursor = cursorDebounceTimers.get(id);
    if (pendingCursor !== undefined) {
      clearTimeout(pendingCursor);
      cursorDebounceTimers.delete(id);
    }

    // cascade: closing an editor tab also takes its singleton
    // EXPLAIN spouse with it (id `explain-${editorTabId}`). The spouse has
    // no other anchor — keeping it alive after the source dies leaves an
    // orphan tab no one can re-run.
    const explainSpouseId = closingTab.kind === "editor" ? `explain-${id}` : null;
    const removed = new Set<string>([id]);
    if (explainSpouseId !== null && state.tabs.some((t) => t.id === explainSpouseId)) {
      removed.add(explainSpouseId);
    }

    const nextTabs = state.tabs.filter((t) => !removed.has(t.id));
    let nextActive: string | null = state.activeTabId;
    if (state.activeTabId !== null && removed.has(state.activeTabId)) {
      // Activate right neighbor relative to the originally-closed tab if
      // any, else the rightmost remaining, else null. Using the
      // pre-removal idx keeps the visual position stable for the user.
      const candidates = state.tabs.slice(idx + 1).filter((t) => !removed.has(t.id));
      if (candidates.length > 0) {
        nextActive = candidates[0].id;
      } else if (nextTabs.length > 0) {
        nextActive = nextTabs[nextTabs.length - 1].id;
      } else {
        nextActive = null;
      }
    }

    const nextRunStates = new Map(state.runStates);
    nextRunStates.delete(id);

    // Drop EXPLAIN runState for the spouse (when closing editor) or for
    // the explain tab itself (when closing explain directly).
    const nextExplainStates = new Map(state.explainRunStates);
    if (closingTab.kind === "editor") {
      nextExplainStates.delete(`explain-${id}`);
    } else if (closingTab.kind === "explain") {
      nextExplainStates.delete(id);
    }

    set({
      tabs: nextTabs,
      activeTabId: nextActive,
      runStates: nextRunStates,
      explainRunStates: nextExplainStates,
    });
    writeActiveTabToStorage(nextActive);

    // History + explain tabs are session-scope; nothing to delete in SQLite.
    if (closingTab.kind !== "history" && closingTab.kind !== "explain") {
      try {
        await tabsDelete(id);
      } catch {
        // Persistence is best-effort.
      }
    }
    return true;
  },

  switchTab: (id) => {
    const state = get();
    if (!state.tabs.some((t) => t.id === id)) return;
    set({ activeTabId: id });
    writeActiveTabToStorage(id);
  },

  setContent: (id, content) => {
    const state = get();
    let updated: EditorTab | null = null;
    const nextTabs = state.tabs.map((t) => {
      if (t.id !== id || t.kind !== "editor") return t;
      const next: EditorTab = {
        ...t,
        content,
        dirty: true,
        updatedAt: new Date().toISOString(),
      };
      updated = next;
      return next;
    });
    if (updated === null) return;
    set({ tabs: nextTabs });

    const existing = contentDebounceTimers.get(id);
    if (existing !== undefined) clearTimeout(existing);

    const timer = setTimeout(() => {
      contentDebounceTimers.delete(id);
      const current = get().tabs.find((t) => t.id === id);
      if (!current || current.kind !== "editor") return;
      tabsSave(tabToRow(current))
        .then(() => {
          const after = get().tabs.find((t) => t.id === id);
          // Only clear dirty if no further keystrokes landed during save.
          if (after && after.kind === "editor" && after.updatedAt === current.updatedAt) {
            const cleaned: EditorTab = { ...after, dirty: false };
            set({
              tabs: get().tabs.map((t) => (t.id === id ? cleaned : t)),
            });
          }
        })
        .catch(() => {
          // best-effort; user keeps dirty=true so the next debounce retries
        });
    }, 500);
    contentDebounceTimers.set(id, timer);
  },

  renameEditorTab: (id, name) => {
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    const state = get();
    const existing = state.tabs.find((t) => t.id === id);
    if (!existing || existing.kind !== "editor") return;
    if (existing.name === trimmed) return;
    const next: EditorTab = {
      ...existing,
      name: trimmed,
      updatedAt: new Date().toISOString(),
    };
    set({ tabs: state.tabs.map((t) => (t.id === id ? next : t)) });
    void tabsSave(tabToRow(next)).catch(() => {
      // Best-effort: leave the in-memory rename in place even if SQLite is
      // briefly busy — the next setContent debounce will retry the row.
    });
  },

  setCursor: (id, line, col) => {
    const state = get();
    let touched = false;
    const nextTabs = state.tabs.map((t) => {
      if (t.id !== id || t.kind !== "editor") return t;
      touched = true;
      return { ...t, cursorPos: { line, col } };
    });
    if (!touched) return;
    set({ tabs: nextTabs });

    const existing = cursorDebounceTimers.get(id);
    if (existing !== undefined) clearTimeout(existing);

    const timer = setTimeout(() => {
      cursorDebounceTimers.delete(id);
      const current = get().tabs.find((t) => t.id === id);
      if (!current || current.kind !== "editor") return;
      void tabsSave(tabToRow(current)).catch(() => {});
    }, 200);
    cursorDebounceTimers.set(id, timer);
  },

  setTabConnection: (id, connId) => {
    const state = get();
    const previous = state.tabs.find((t) => t.id === id);
    if (!previous || previous.kind !== "editor") return;
    if (previous.connectionId === connId) return;

    // connection switch invalidates the cursor. Fire-and-forget
    // close so the backend doesn't keep an open transaction tied to the
    // old conn after we drop the runState below.
    const prevRun = state.runStates.get(id);
    if (prevRun?.status === "streaming" && prevRun.cursorId !== null) {
      void queryCloseCursor(prevRun.cursorId).catch(() => {});
    }

    let updated: EditorTab | null = null;
    const nextTabs = state.tabs.map((t) => {
      if (t.id !== id || t.kind !== "editor") return t;
      const next: EditorTab = {
        ...t,
        connectionId: connId,
        updatedAt: new Date().toISOString(),
      };
      updated = next;
      return next;
    });
    if (updated === null) return;
    // Audit M3: result rows belong to (tab, connection) pair. Switching
    // connection ⇒ previous result is no longer valid in the new context.
    // Drop it back to idle so the user re-runs explicitly.
    const nextRunStates = new Map(state.runStates);
    nextRunStates.delete(id);
    set({ tabs: nextTabs, runStates: nextRunStates });
    persistTab(updated);
  },

  closeObjectTabsForConnection: async (connId) => {
    const state = get();
    const toClose = state.tabs.filter((t) => t.kind === "object" && t.connectionId === connId);
    if (toClose.length === 0) return;
    const targets = new Set(toClose.map((t) => t.id));

    const nextTabs = state.tabs.filter((t) => !targets.has(t.id));
    let nextActive = state.activeTabId;
    if (nextActive !== null && targets.has(nextActive)) {
      nextActive = nextTabs.length > 0 ? nextTabs[nextTabs.length - 1].id : null;
    }
    const nextRunStates = new Map(state.runStates);
    for (const id of targets) nextRunStates.delete(id);

    set({ tabs: nextTabs, activeTabId: nextActive, runStates: nextRunStates });
    writeActiveTabToStorage(nextActive);

    await Promise.all([...targets].map((id) => tabsDelete(id).catch(() => undefined)));
  },

  runQuery: async (tabId, intentArg) => {
    const state = get();
    const tab = state.tabs.find((t) => t.id === tabId);
    if (!tab || tab.kind !== "editor") return;

    // Normalise legacy overloads:
    // runQuery(tabId)            → {kind: "current"}
    // runQuery(tabId, null)      → {kind: "current"}
    // runQuery(tabId, "SELECT")  → {kind: "explicit", text: "SELECT"}
    let intent: RunIntent;
    if (intentArg === null || intentArg === undefined) {
      intent = { kind: "current" };
    } else if (typeof intentArg === "string") {
      intent = { kind: "explicit", text: intentArg };
    } else {
      intent = intentArg;
    }

    const statements = resolveStatements(tab.content, tabId, intent, get);
    if (statements.length === 0) return;

    if (tab.connectionId === null) {
      const next = new Map(get().runStates);
      next.set(tabId, { status: "error", code: "no_connection" });
      set({ runStates: next });
      return;
    }

    // fix: snapshot the current queryShape so RerunBanner can compare
    // post-run filter edits against the shape that was actually executed.
    // Called BEFORE the statement runs (rather than after) so the snapshot
    // reflects user intent at submit time even if the run is cancelled.
    get().markShapeExecuted(tabId);

    // — Easy-mode pre-flight advisory (cross-join / slow-preview).
    // Runs strictly BEFORE the standard preflight pipeline so the learner
    // sees the friendly warning first. No-op in Standard mode.
    if (useUiMode.getState().mode === "easy") {
      for (const stmtSql of statements) {
        const advisory = analyzeForEasyAdvisory(stmtSql);
        if (!advisory) continue;
        const proceed = await new Promise<boolean>((resolve) => {
          set({
            safetyModal: {
              kind: "easyAdvisory",
              advisory,
              onProceed: () => {
                set({ safetyModal: { kind: "none" } });
                resolve(true);
              },
              onCancel: () => {
                set({ safetyModal: { kind: "none" } });
                resolve(false);
              },
            },
          });
        });
        if (!proceed) {
          const next = new Map(get().runStates);
          next.set(tabId, { status: "cancelled" });
          set({ runStates: next });
          return;
        }
      }
    }

    // Consolidated safety pipeline — single-statement path delegates to the
    // legacy `preflightSafety` so the existing ConfirmDestructiveModal and
    // `runQuery.safety.test.ts` keep working unchanged.
    const conn = useConnections.getState().connections.find((c) => c.id === tab.connectionId);
    const preflight = await preflightBatch(conn, statements, (partial) => set(partial));
    if (preflight.outcome === "blocked") {
      const next = new Map(get().runStates);
      next.set(tabId, { status: "error", code: "read_only_blocked" });
      set({ runStates: next });
      return;
    }
    if (preflight.outcome === "cancelled") {
      const next = new Map(get().runStates);
      next.set(tabId, { status: "cancelled" });
      set({ runStates: next });
      return;
    }

    // Per-query cursor lifetime (Q2): close any leftover cursor from a
    // previous Run on this same tab BEFORE we open a new one.
    const prev = get().runStates.get(tabId);
    if (prev?.status === "streaming" && prev.cursorId !== null) {
      void queryCloseCursor(prev.cursorId).catch(() => {});
    }

    // Single-statement path keeps `runStates` populated for legacy consumers
    // (fetchMore, cancel, close-tab cleanup). Multi-statement also writes
    // `runStates[tabId]` to mirror the LAST successful outcome (cursor or
    // DML) so existing selectors keep rendering data without churn.
    const startedAt = Date.now();
    const opening = new Map(get().runStates);
    opening.set(tabId, { status: "opening", startedAt, cancelable: true });
    set({ runStates: opening });

    const batchOpening = new Map(get().batchRunStates);
    batchOpening.set(tabId, { status: "opening", startedAt, cancelable: true });
    set({ batchRunStates: batchOpening });

    try {
      const result = await queryRunBatch(tab.connectionId, statements, true);
      if (!get().tabs.some((x) => x.id === tabId)) return;

      const activeIdx =
        result.failedAt !== null ? result.failedAt : Math.max(0, result.statements.length - 1);
      const batchReady = new Map(get().batchRunStates);
      batchReady.set(tabId, {
        status: "ready",
        statements: result.statements,
        activeIdx,
        totalDurationMs: result.totalDurationMs,
        failedAt: result.failedAt,
      });
      set({ batchRunStates: batchReady });

      // Mirror active statement's outcome into legacy `runStates` so
      // ResultPanel/RunToolbar selectors that still read `runStates` show
      // the active tab's data without churn.
      const active = result.statements[activeIdx];
      const next = new Map(get().runStates);
      next.set(tabId, mapStatementToRunState(active, statements[activeIdx] ?? ""));
      set({ runStates: next });

      // — watch for SET search_path so the autocomplete cache
      // stays current. Syntactic detection only; non-statement paths
      // (pg_catalog.set_config, ALTER ROLE) need a manual Cmd+R refresh.
      // Apply over every statement in the batch so a multi-statement run
      // that toggles search_path mid-batch still refreshes once.
      if (tab.connectionId) {
        for (const stmtSql of statements) {
          const newPath = parseSearchPathFromSql(stmtSql);
          if (newPath) {
            const cache = useAutocompleteCache.getState();
            const snap = cache.getSnapshot(tab.connectionId);
            const sameOrder =
              snap &&
              snap.searchPath.length === newPath.length &&
              snap.searchPath.every((s, i) => s === newPath[i]);
            if (!sameOrder) {
              void cache.refresh(tab.connectionId);
              break;
            }
          }
        }
      }
    } catch (err) {
      if (!get().tabs.some((x) => x.id === tabId)) return;
      const next = new Map(get().runStates);
      next.set(tabId, mapInvokeErrorToRunState(err, statements[0] ?? ""));
      set({ runStates: next });
      const batchErr = new Map(get().batchRunStates);
      batchErr.set(tabId, { status: "idle" });
      set({ batchRunStates: batchErr });
    }
  },

  setActiveBatchTab: (tabId, idx) => {
    const cur = get().batchRunStates.get(tabId);
    if (!cur || cur.status !== "ready") return;
    const next = new Map(get().batchRunStates);
    next.set(tabId, { ...cur, activeIdx: idx });
    set({ batchRunStates: next });

    // Mirror the newly-active statement into legacy runStates so existing
    // selectors keep rendering data for the visible sub-tab.
    const active = cur.statements[idx];
    const rn = new Map(get().runStates);
    rn.set(tabId, mapStatementToRunState(active, ""));
    set({ runStates: rn });
  },

  fetchMore: async (tabId) => {
    const cur = get().runStates.get(tabId);
    if (
      !cur ||
      cur.status !== "streaming" ||
      cur.exhausted ||
      cur.prefetching ||
      cur.cursorId === null
    ) {
      return;
    }
    // Set prefetching so concurrent calls bail out.
    const prefetchingState = new Map(get().runStates);
    prefetchingState.set(tabId, { ...cur, prefetching: true });
    set({ runStates: prefetchingState });

    try {
      const page = await queryFetchPage(cur.cursorId, 1000);
      const after = get().runStates.get(tabId);
      if (!after || after.status !== "streaming") return;
      const merged: Array<Array<string | null>> = [...after.rows, ...page.rows];
      // Re-apply current sort order to the appended block: cheapest correct
      // approach is a stable sort of the whole array since incremental
      // binary-insert across 1000 new rows would be similar O.
      const sortedRows = applySortIfNeeded(merged, after.columns, after.sort);
      const next = new Map(get().runStates);
      next.set(tabId, {
        ...after,
        rows: sortedRows,
        loadedCount: sortedRows.length,
        exhausted: page.exhausted,
        cursorId: page.exhausted ? null : after.cursorId,
        prefetching: false,
      });
      set({ runStates: next });
    } catch (err) {
      const after = get().runStates.get(tabId);
      if (!after || after.status !== "streaming") return;
      const next = new Map(get().runStates);
      if (err instanceof QueryError && err.kind === "cursorNotFound") {
        next.set(tabId, { status: "error", code: "cursor_lost" });
      } else if (err instanceof QueryError && err.kind === "cancelled") {
        next.set(tabId, { status: "cancelled" });
      } else {
        const detail = err instanceof Error ? err.message : String(err);
        next.set(tabId, { status: "error", code: "unknown", detail });
      }
      set({ runStates: next });
    }
  },

  cancelRun: (tabId) => {
    const cur = get().runStates.get(tabId);
    if (!cur) return;
    const next = new Map(get().runStates);

    if (cur.status === "opening") {
      // No data has arrived yet, so the cancelled empty panel is correct.
      next.set(tabId, { status: "cancelled" });
    } else if (cur.status === "streaming" && cur.cursorId !== null) {
      // previously this branch dropped to `{status:"cancelled"}` and
      // the user lost every row already visible on screen. Preserve them by
      // closing the cursor on the backend and freezing the result as
      // "exhausted" — partial data is far more useful than an empty panel.
      void queryCancel(cur.cursorId).catch(() => {});
      next.set(tabId, {
        ...cur,
        cursorId: null,
        exhausted: true,
        prefetching: false,
      });
    } else {
      // Inline result with no cursor, or already-cancelled / errored — no-op.
      return;
    }

    set({ runStates: next });
  },

  setSort: (tabId, columnIdx, dir) => {
    const cur = get().runStates.get(tabId);
    if (!cur || cur.status !== "streaming") return;
    if (dir === null) {
      const next = new Map(get().runStates);
      next.set(tabId, { ...cur, sort: null });
      set({ runStates: next });
      return;
    }
    const sortState: SortState = { columnIdx, dir };
    const sorted = applySortIfNeeded(cur.rows, cur.columns, sortState);
    const next = new Map(get().runStates);
    next.set(tabId, { ...cur, rows: sorted, sort: sortState });
    set({ runStates: next });
  },

  setColumnWidth: (tabId, srcColumnIdx, widthPx) => {
    const cur = get().runStates.get(tabId);
    if (!cur || cur.status !== "streaming") return;
    const widths = new Map(cur.columnWidths);
    widths.set(srcColumnIdx, Math.max(40, widthPx));
    const next = new Map(get().runStates);
    next.set(tabId, { ...cur, columnWidths: widths });
    set({ runStates: next });
  },

  setColumnOrder: (tabId, nextOrder) => {
    const cur = get().runStates.get(tabId);
    if (!cur || cur.status !== "streaming") return;
    if (nextOrder.length !== cur.columns.length) return;
    const next = new Map(get().runStates);
    next.set(tabId, { ...cur, columnOrder: [...nextOrder] });
    set({ runStates: next });
  },

  // ─── — queryShape slice ───────────────────────────────────
  // Five small, side-effect-free actions that own the bidirectional SQL ↔
  // visual-filters state. Kept colocated with the other grid-state
  // mutators so the diff vs. legacy code is one cluster. All five clone
  // the relevant Map(s) before mutating to keep Zustand's reference
  // equality contract intact.
  setFilter: (tabId, columnName, filter) => {
    const cur = get().queryShapes.get(tabId);
    if (!cur) return;
    const filters = [...cur.filters];
    const idx = filters.findIndex((f) => f.column === columnName);
    if (filter === null) {
      if (idx >= 0) filters.splice(idx, 1);
    } else {
      // Force the filter's column to match the slot we're writing into so
      // a caller that passes an out-of-sync `filter.column` can't corrupt
      // the keying invariant.
      const next: Filter = { ...filter, column: columnName };
      if (idx >= 0) filters[idx] = next;
      else filters.push(next);
    }
    const nextShapes = new Map(get().queryShapes);
    nextShapes.set(tabId, { ...cur, filters });
    // bump version so the RerunBanner re-evaluates dismissal each
    // time the user changes the filter set, even when the new shape still
    // diverges from the executed shape.
    const nextVer = new Map(get().filterChangeVersion);
    nextVer.set(tabId, (nextVer.get(tabId) ?? 0) + 1);
    set({ queryShapes: nextShapes, filterChangeVersion: nextVer });
  },

  clearFilters: (tabId) => {
    const cur = get().queryShapes.get(tabId);
    if (!cur) return;
    if (cur.filters.length === 0) return;
    const nextShapes = new Map(get().queryShapes);
    nextShapes.set(tabId, { ...cur, filters: [] });
    const nextVer = new Map(get().filterChangeVersion);
    nextVer.set(tabId, (nextVer.get(tabId) ?? 0) + 1);
    set({ queryShapes: nextShapes, filterChangeVersion: nextVer });
  },

  applyShapeFromAst: (tabId, shape, warnings) => {
    const decision = decideShapeApply(get().queryShapes.get(tabId) ?? null, shape);
    if (decision.type === "noop-equal") return;

    const nextWarnings = new Map(get().shapeWarnings);
    nextWarnings.set(tabId, warnings);

    if (decision.type === "skip-unrepresentable") {
      // fix: surface the unrepresentable_tail by REPLACING the
      // shape with one that carries the tail, not by silently keeping the
      // old shape. ResultGrid + UnrepresentableBar both react to this.
      const nextShapes = new Map(get().queryShapes);
      nextShapes.set(tabId, shape);
      set({ queryShapes: nextShapes, shapeWarnings: nextWarnings });
      return;
    }
    // type === "apply"
    const nextShapes = new Map(get().queryShapes);
    nextShapes.set(tabId, decision.newShape ?? shape);
    set({ queryShapes: nextShapes, shapeWarnings: nextWarnings });
  },

  markShapeExecuted: (tabId) => {
    const cur = get().queryShapes.get(tabId) ?? null;
    const next = new Map(get().lastExecutedShape);
    next.set(tabId, cur);
    set({ lastExecutedShape: next });
  },

  getQueryShape: (tabId) => get().queryShapes.get(tabId) ?? null,

  setSelectParseError: (tabId, err) => {
    const cur = get().selectParseErrors.get(tabId) ?? null;
    if (cur === err) return;
    if (
      cur &&
      err &&
      cur.message === err.message &&
      cur.line === err.line &&
      cur.column === err.column
    )
      return;
    const next = new Map(get().selectParseErrors);
    if (err === null) next.delete(tabId);
    else next.set(tabId, err);
    set({ selectParseErrors: next });
  },

  getSelectParseError: (tabId) => get().selectParseErrors.get(tabId) ?? null,

  getActiveConnId: () => {
    const tabId = get().activeTabId;
    if (!tabId) return null;
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab) return null;
    if (tab.kind === "object") return tab.connectionId;
    if (tab.kind === "editor") return tab.connectionId;
    return null;
  },

  insertSnippetAtCursor: (body: string) => {
    const ed = activeMonacoEditor.current;
    if (!ed) return;
    // Order matters: focus must come BEFORE trigger. Monaco's
    // `editor.action.insertSnippet` is gated on the editor having focus —
    // if we trigger while the snippet palette dialog still owns focus, the
    // action no-ops and the editor content is unchanged ().
    ed.focus();
    ed.trigger("snippet-palette", "editor.action.insertSnippet", { snippet: body });
  },

  // — EXPLAIN visualizer actions.
  runExplain: async (sourceTabId, mode) => {
    const sourceTab = get().tabs.find((t) => t.id === sourceTabId);
    if (!sourceTab || sourceTab.kind !== "editor") return;

    // Resolve SQL: editor selection wins over the whole content so the user
    // can EXPLAIN a single statement out of a multi-statement file. Trim
    // before length-check so " \n" never reaches the backend.
    const sql = (getActiveSelection() ?? sourceTab.content).trim();
    if (sql.length === 0) return;

    // Get-or-create singleton EXPLAIN tab. Id is deterministic so Cmd+E
    // followed by Cmd+Shift+E lands in the same tab — no duplicate spouses.
    // If the tab already exists, swap mode in-place (preserves verbose/wal/
    // timing toggles the user already set on the prior run).
    const explainId = `explain-${sourceTabId}`;
    const existing = get().tabs.find((t): t is ExplainTab => t.id === explainId);
    let explainTab: ExplainTab;
    if (existing) {
      explainTab = { ...existing, options: { ...existing.options, mode } };
      set({
        tabs: get().tabs.map((t) => (t.id === explainId ? explainTab : t)),
        activeTabId: explainId,
      });
    } else {
      explainTab = {
        id: explainId,
        kind: "explain",
        sourceTabId,
        options: defaultExplainOptions(mode),
        createdAt: new Date().toISOString(),
      };
      set({ tabs: [...get().tabs, explainTab], activeTabId: explainId });
    }
    writeActiveTabToStorage(explainId);

    // Connection guard — surface on the explain runState, not the source's.
    if (sourceTab.connectionId === null) {
      const next = new Map(get().explainRunStates);
      next.set(explainId, { status: "error", code: "no_connection" });
      set({ explainRunStates: next });
      return;
    }

    // Safety pipeline only for ANALYZE — plain EXPLAIN is planner-only,
    // doesn't execute the underlying query, and never writes. Skipping the
    // confirm modal there is intentional (low-friction plan-poking).
    if (mode === "analyze") {
      const conn = useConnections
        .getState()
        .connections.find((c) => c.id === sourceTab.connectionId);
      const outcome = await preflightSafety(conn, sql, (partial) => set(partial));
      if (outcome === "read_only_blocked") {
        const next = new Map(get().explainRunStates);
        next.set(explainId, { status: "error", code: "read_only_blocked" });
        set({ explainRunStates: next });
        return;
      }
      if (outcome === "cancelled") {
        const next = new Map(get().explainRunStates);
        next.set(explainId, { status: "cancelled" });
        set({ explainRunStates: next });
        return;
      }
    }

    const startedAt = Date.now();
    const opening = new Map(get().explainRunStates);
    opening.set(explainId, { status: "running", startedAt, cancelable: true });
    set({ explainRunStates: opening });

    try {
      const result = await queryExplain(sourceTab.connectionId, explainId, sql, explainTab.options);
      // Tab might have been closed mid-flight (cascade from closing source);
      // bail without writing state so a stale entry doesn't reappear in
      // explainRunStates after the cascade purged it.
      if (!get().tabs.some((t) => t.id === explainId)) return;
      const next = new Map(get().explainRunStates);
      next.set(explainId, {
        status: "ready",
        plan: result.planJson,
        durationMs: result.durationMs,
        statusMessage: result.statusMessage,
        ranAt: Date.now(),
        executedSql: sql,
      });
      set({ explainRunStates: next });

      // — Recent Plans capture (best-effort, fire-and-forget).
      // Cached re-opens never reach this path (openCachedExplain sets
      // runState=ready directly without going through runExplain), but
      // an explicit guard keeps the intent clear if the flow ever changes.
      const captureConn = useConnections
        .getState()
        .connections.find((c) => c.id === sourceTab.connectionId);
      if (captureConn && !captureConn.excludeFromRecentPlans && explainTab.sourceTabId !== null) {
        void recentPlansSave({
          connectionId: captureConn.id,
          connectionName: captureConn.name,
          sql,
          planJson: result.planJson,
          durationMs: result.durationMs,
          mode: explainTab.options.mode,
          optionsJson: JSON.stringify(explainTab.options),
        }).catch(() => {
          // Capture is best-effort; never break the EXPLAIN UX.
        });
      }
    } catch (err) {
      if (!get().tabs.some((t) => t.id === explainId)) return;
      const next = new Map(get().explainRunStates);
      if (err instanceof ConnectionError) {
        // ConnectionError.kind values are lowercase camelCase per the
        // tauri.ts zod schema (notConnected/postgres/poolError/…). The
        // backend `query_explain` raises ConnectionError, not QueryError,
        // because it pre-dates the QueryError split.
        const detail = err.message;
        if (err.kind === "notConnected") {
          next.set(explainId, { status: "error", code: "not_connected" });
        } else if (err.kind === "postgres") {
          // Postgres parse errors include "at character N" — surface as
          // line/col so the UI can highlight the offending token.
          const posMatch = /at character (\d+)/.exec(detail);
          if (posMatch) {
            const { line, col } = mapPositionToLineCol(sql, Number(posMatch[1]));
            next.set(explainId, {
              status: "error",
              code: "postgres_error",
              detail,
              line,
              col,
            });
          } else {
            next.set(explainId, { status: "error", code: "postgres_error", detail });
          }
        } else {
          next.set(explainId, { status: "error", code: "pool_error", detail });
        }
      } else {
        const detail = err instanceof Error ? err.message : String(err);
        next.set(explainId, { status: "error", code: "unknown", detail });
      }
      set({ explainRunStates: next });
    }
  },
  toggleExplainOption: (explainTabId, key) => {
    const state = get();
    const tab = state.tabs.find((t): t is ExplainTab => t.id === explainTabId);
    if (!tab) return;
    // WAL + TIMING are meaningful only with ANALYZE — the toolbar greys
    // them out for plain EXPLAIN. Don't enforce the gate here: the store
    // tolerates the toggle and `buildExplainSql` silently drops the
    // disabled options when mode != analyze. Toggling never auto-triggers
    // a re-run; the user must press Re-run explicitly so they can flip
    // multiple toggles before paying for another planner round-trip.
    const nextOptions = { ...tab.options, [key]: !tab.options[key] };
    const nextTab: ExplainTab = { ...tab, options: nextOptions };
    set({ tabs: state.tabs.map((t) => (t.id === explainTabId ? nextTab : t)) });
  },
  rerunExplain: async (explainTabId) => {
    const tab = get().tabs.find((t): t is ExplainTab => t.id === explainTabId);
    if (!tab) return;
    // Source tab might have been closed since the last run. Surface the
    // source_closed code instead of silently no-op'ing so the UI can offer
    // "Open in editor" / dismiss.
    // — cached ExplainTabs (sourceTabId=null) cannot be re-run.
    // The toolbar greys the button + tooltips the user; this guard keeps
    // the action safe if some other path triggers it.
    if (tab.sourceTabId === null) {
      const next = new Map(get().explainRunStates);
      next.set(explainTabId, { status: "error", code: "source_closed" });
      set({ explainRunStates: next });
      return;
    }
    const source = get().tabs.find((t) => t.id === tab.sourceTabId);
    if (!source || source.kind !== "editor") {
      const next = new Map(get().explainRunStates);
      next.set(explainTabId, { status: "error", code: "source_closed" });
      set({ explainRunStates: next });
      return;
    }
    await get().runExplain(tab.sourceTabId, tab.options.mode);
  },
  cancelExplain: (explainTabId) => {
    const tab = get().tabs.find((t): t is ExplainTab => t.id === explainTabId);
    if (!tab) return;
    if (tab.sourceTabId === null) return; // cached tabs have nothing to cancel
    const source = get().tabs.find((t) => t.id === tab.sourceTabId);
    // Cancel is fire-and-forget — backend ignores unknown ids, so racing
    // a completed query is fine. Only the runState matters for the UI.
    if (source && source.kind === "editor" && source.connectionId !== null) {
      void queryExplainCancel(source.connectionId, explainTabId).catch(() => {});
    }
    const next = new Map(get().explainRunStates);
    next.set(explainTabId, { status: "cancelled" });
    set({ explainRunStates: next });
  },

  // — Recent Plans actions.
  openRecentPlansTab: () => {
    const state = get();
    const existing = state.tabs.find((t): t is RecentPlansTab => t.kind === "recent-plans");
    if (existing) {
      set({ activeTabId: existing.id });
      writeActiveTabToStorage(existing.id);
      return existing;
    }
    const tab: RecentPlansTab = {
      id: "recent-plans",
      kind: "recent-plans",
      createdAt: new Date().toISOString(),
    };
    set({ tabs: [...state.tabs, tab], activeTabId: tab.id });
    writeActiveTabToStorage(tab.id);
    return tab;
  },
  openCachedExplain: (row) => {
    const id = `explain-cached-${row.id}`;
    const state = get();
    const existing = state.tabs.find((t): t is ExplainTab => t.id === id);
    if (existing) {
      set({ activeTabId: id });
      writeActiveTabToStorage(id);
      return existing;
    }
    // Defensive parse — corrupt optionsJson falls back to a sane default
    // matched to the row's mode. Plan can be null if planJson got
    // truncated; the visualizer surfaces an empty-state in that case.
    let parsedOptions: ExplainOptions;
    try {
      parsedOptions = JSON.parse(row.optionsJson) as ExplainOptions;
    } catch {
      parsedOptions = {
        mode: row.mode,
        verbose: false,
        wal: false,
        timing: row.mode === "analyze",
      };
    }
    let parsedPlan: unknown;
    try {
      parsedPlan = JSON.parse(row.planJson);
    } catch {
      parsedPlan = null;
    }
    const tab: ExplainTab = {
      id,
      kind: "explain",
      sourceTabId: null,
      cachedRecentPlanId: row.id,
      options: parsedOptions,
      createdAt: new Date().toISOString(),
    };
    const nextExplain = new Map(state.explainRunStates);
    nextExplain.set(id, {
      status: "ready",
      plan: parsedPlan,
      durationMs: row.durationMs,
      statusMessage: `Cached · ${row.executedAt}`,
      ranAt: Date.parse(row.executedAt) || Date.now(),
      executedSql: row.sql,
    });
    set({
      tabs: [...state.tabs, tab],
      activeTabId: id,
      explainRunStates: nextExplain,
    });
    writeActiveTabToStorage(id);
    return tab;
  },
  openEditorFromRecent: async (recentPlanId) => {
    // Re-fetch in case the row was deleted between list-render and click.
    const row = await recentPlansGet(recentPlanId).catch(() => null);
    if (!row) return;
    const connAlive = useConnections.getState().connections.some((c) => c.id === row.connectionId);
    const connId = connAlive ? row.connectionId : null;
    get().openEditorTab(connId, { prefillSql: row.sql });
  },

  openPlanDiff: (left, right) => {
    const id = planDiffTabId(left, right);
    const state = get();
    const existing = state.tabs.find((t): t is PlanDiffTab => t.id === id);
    if (existing) {
      set({ activeTabId: id });
      writeActiveTabToStorage(id);
      return existing;
    }
    const tab: PlanDiffTab = {
      id,
      kind: "plan-diff",
      left,
      right,
      createdAt: new Date().toISOString(),
    };
    set({ tabs: [...state.tabs, tab], activeTabId: id });
    writeActiveTabToStorage(id);
    // Only recent×recent persists; runtime sides skipped by `isPersistableTab`.
    persistTab(tab);
    return tab;
  },

  swapPlanDiff: (tabId) => {
    const state = get();
    const tab = state.tabs.find((t): t is PlanDiffTab => t.id === tabId);
    if (!tab) return;
    const swapped: PlanDiffTab = { ...tab, left: tab.right, right: tab.left };
    set({ tabs: state.tabs.map((t) => (t.id === tabId ? swapped : t)) });
    // id is commutative — no LS or persist update required.
  },

  openEditorFromInsight: async (sourceTabId, insight) => {
    const sourceTab = get().tabs.find((t) => t.id === sourceTabId);
    if (!sourceTab || sourceTab.kind !== "explain") return;

    let connId: string | null = null;
    if (sourceTab.cachedRecentPlanId) {
      // Cached ExplainTab — connection id lives on the recent row.
      const row = await recentPlansGet(sourceTab.cachedRecentPlanId).catch(() => null);
      if (row) {
        const alive = useConnections.getState().connections.some((c) => c.id === row.connectionId);
        connId = alive ? row.connectionId : null;
      }
    } else if (sourceTab.sourceTabId) {
      // Runtime ExplainTab — walk to the source EditorTab.
      const source = get().tabs.find((t) => t.id === sourceTab.sourceTabId);
      if (source && source.kind === "editor") {
        const alive = useConnections
          .getState()
          .connections.some((c) => c.id === source.connectionId);
        connId = alive ? source.connectionId : null;
      }
    }

    get().openEditorTab(connId, { prefillSql: insight.suggestedSql });
  },

  openHealthTab: (connectionId) => {
    const id = `health-${connectionId}`;
    const existing = get().tabs.find((t): t is HealthTab => t.id === id && t.kind === "health");
    if (existing) {
      get().switchTab(id);
      return existing;
    }
    const tab: HealthTab = {
      id,
      kind: "health",
      connectionId,
      createdAt: new Date().toISOString(),
    };
    set({ tabs: [...get().tabs, tab], activeTabId: id });
    writeActiveTabToStorage(id);
    return tab;
  },

  openLiveOpsTab: (connectionId) => {
    const id = `live-ops-${connectionId}`;
    const existing = get().tabs.find((t): t is LiveOpsTab => t.id === id && t.kind === "live-ops");
    if (existing) {
      get().switchTab(id);
      return existing;
    }
    const tab: LiveOpsTab = {
      id,
      kind: "live-ops",
      connectionId,
      createdAt: new Date().toISOString(),
    };
    set({ tabs: [...get().tabs, tab], activeTabId: id });
    writeActiveTabToStorage(id);
    return tab;
  },

  openErdTab: (connectionId, options) => {
    const id = `erd-${connectionId}`;
    const existing = get().tabs.find((t): t is ErdTab => t.id === id && t.kind === "erd");
    if (existing) {
      get().switchTab(id);
      return existing;
    }
    const tab: ErdTab = {
      id,
      kind: "erd",
      connectionId,
      schemas: options?.schemas,
      createdAt: new Date().toISOString(),
    };
    set({ tabs: [...get().tabs, tab], activeTabId: id });
    writeActiveTabToStorage(id);
    return tab;
  },

  openMapViewTab: (input) => {
    const id = `mapview-${
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`
    }`;
    const tab: MapViewTab = {
      id,
      kind: "map-view",
      connectionId: input.connectionId,
      rowsSnapshot: input.rowsSnapshot,
      columns: input.columns,
      geometryColumn: input.geometryColumn,
      createdAt: new Date().toISOString(),
    };
    set({ tabs: [...get().tabs, tab], activeTabId: id });
    writeActiveTabToStorage(id);
    return tab;
  },

  openPgStatStatementsTab: (connectionId) => {
    const id = `pgss-${connectionId}`;
    const existing = get().tabs.find(
      (t): t is PgStatStatementsTab => t.id === id && t.kind === "pg-stat-statements",
    );
    if (existing) {
      get().switchTab(id);
      return existing;
    }
    const tab: PgStatStatementsTab = {
      id,
      kind: "pg-stat-statements",
      connectionId,
      createdAt: new Date().toISOString(),
    };
    set({ tabs: [...get().tabs, tab], activeTabId: id });
    writeActiveTabToStorage(id);
    return tab;
  },

  openMigrationsTab: (connectionId) => {
    const id = `migrations-${connectionId}`;
    const existing = get().tabs.find(
      (t): t is MigrationsTab => t.id === id && t.kind === "migrations",
    );
    if (existing) {
      get().switchTab(id);
      return existing;
    }
    const tab: MigrationsTab = {
      id,
      kind: "migrations",
      connectionId,
      createdAt: new Date().toISOString(),
    };
    set({ tabs: [...get().tabs, tab], activeTabId: id });
    writeActiveTabToStorage(id);
    return tab;
  },

  openNotebookTab: (notebookId, connectionId) => {
    const id = `nb-tab-${notebookId}`;
    const existing = get().tabs.find((t): t is NotebookTab => t.id === id && t.kind === "notebook");
    if (existing) {
      get().switchTab(id);
      return existing;
    }
    const tab: NotebookTab = {
      id,
      kind: "notebook",
      notebookId,
      connectionId,
      createdAt: new Date().toISOString(),
    };
    set({ tabs: [...get().tabs, tab], activeTabId: id });
    writeActiveTabToStorage(id);
    return tab;
  },

  openBackupTab: (connectionId) => {
    const id = `backup-${connectionId}`;
    const existing = get().tabs.find((t): t is BackupTab => t.id === id && t.kind === "backup");
    if (existing) {
      get().switchTab(id);
      return existing;
    }
    const tab: BackupTab = {
      id,
      kind: "backup",
      connectionId,
      createdAt: new Date().toISOString(),
    };
    set({ tabs: [...get().tabs, tab], activeTabId: id });
    writeActiveTabToStorage(id);
    return tab;
  },

  openObjectEditor: (params) => {
    const nameOrPlaceholder = params.name ?? "_new";
    const id = `object-editor-${params.connectionId}-${params.objectKind}-${params.schema}-${nameOrPlaceholder}-${params.mode}`;
    const existing = get().tabs.find(
      (t): t is ObjectEditorTab => t.id === id && t.kind === "object-editor",
    );
    if (existing) {
      get().switchTab(id);
      return existing;
    }
    const tab: ObjectEditorTab = {
      id,
      kind: "object-editor",
      connectionId: params.connectionId,
      target: {
        objectKind: params.objectKind,
        mode: params.mode,
        schema: params.schema,
        name: params.name,
        parentTable: params.parentTable,
      },
      createdAt: new Date().toISOString(),
    };
    set({ tabs: [...get().tabs, tab], activeTabId: id });
    writeActiveTabToStorage(id);
    return tab;
  },

  setErdTabSchemas: (tabId, schemas) => {
    const next = get().tabs.map((t) =>
      t.id === tabId && t.kind === "erd" ? { ...t, schemas } : t,
    );
    set({ tabs: next });
  },

  setCurrentStatement: (tabId, stmt) => {
    const m = new Map(get().currentStatementByTab);
    m.set(tabId, stmt);
    set({ currentStatementByTab: m });
  },

  setSelection: (tabId, text) => {
    const m = new Map(get().selectionByTab);
    m.set(tabId, text);
    set({ selectionByTab: m });
  },

  patchRowCell: (tabId, rowIdx, srcColIdx, value) => {
    const cur = get().runStates.get(tabId);
    if (!cur || cur.status !== "streaming") return;
    const row = cur.rows[rowIdx];
    if (!row) return;
    const nextRow = row.slice();
    nextRow[srcColIdx] = value;
    const nextRows = cur.rows.slice();
    nextRows[rowIdx] = nextRow;
    const next = new Map(get().runStates);
    next.set(tabId, { ...cur, rows: nextRows });
    set({ runStates: next });
  },
}));

/**
 * Stable sort of `rows` by `sort.columnIdx` according to column type.
 * Numeric columns use `Number` compare with NaN fallback to lexicographic;
 * non-numeric uses lexicographic. NULLs sort first ascending, last descending
 * — same convention as PG `NULLS FIRST`. Returns `rows` unchanged when sort
 * is null.
 */
function applySortIfNeeded(
  rows: Array<Array<string | null>>,
  columns: ColumnMeta[],
  sort: SortState | null,
): Array<Array<string | null>> {
  if (sort === null) return rows;
  const isNumeric = columns[sort.columnIdx]?.isNumeric ?? false;
  const sign = sort.dir === "asc" ? 1 : -1;
  const cmp = (a: Array<string | null>, b: Array<string | null>): number => {
    const x = a[sort.columnIdx];
    const y = b[sort.columnIdx];
    if (x === null && y === null) return 0;
    if (x === null) return -1;
    if (y === null) return 1;
    if (isNumeric) {
      const xn = Number(x);
      const yn = Number(y);
      if (!Number.isNaN(xn) && !Number.isNaN(yn)) return xn - yn;
    }
    return x < y ? -1 : x > y ? 1 : 0;
  };
  return [...rows].sort((a, b) => cmp(a, b) * sign);
}

/** Test-only escape hatch — resets store + module-private debounce maps. */
export const __testing = {
  reset: () => {
    for (const t of contentDebounceTimers.values()) clearTimeout(t);
    contentDebounceTimers.clear();
    for (const t of cursorDebounceTimers.values()) clearTimeout(t);
    cursorDebounceTimers.clear();
    useEditor.setState(
      {
        tabs: [],
        activeTabId: null,
        runStates: new Map(),
        explainRunStates: new Map(),
        currentStatementByTab: new Map(),
        selectionByTab: new Map(),
        batchRunStates: new Map(),
        untitledCounter: 0,
        hydrated: false,
      },
      false,
    );
  },
  pendingContentTimers: () => contentDebounceTimers.size,
  pendingCursorTimers: () => cursorDebounceTimers.size,
};
