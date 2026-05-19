import {
  Activity,
  BookOpen,
  HardDrive,
  History,
  Layers,
  Network,
  Plus,
  Radar,
  X,
} from "lucide-react";
import {
  type JSX,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Dialog } from "../../components/Dialog";
import { useConnections } from "../connections/store";
import { useNotebooks } from "../notebook/store";
import { formStateDirty } from "../object-editor/shared/formStateDirty";
import { useObjectEditorStore } from "../object-editor/store";
import { useSchema } from "../schema/store";
import { type Tab, useEditor } from "./store";

/**
 * Multi-tab strip (spec §5.1, §5.3).
 *
 * - `role="tablist"`; each tab carries `role="tab"`, `aria-selected`,
 * and `aria-controls="editor-pane"` so screen readers + keyboard nav
 * reach the active tab body deterministically.
 * - "+" button creates a new editor tab pinned to the currently-connected
 * schema connection (if any).
 * - Closing a clean tab is immediate; closing a dirty editor tab opens a
 * Radix Dialog confirm (§5.3 — `editor.tabs.confirm_discard.*`). On
 * confirm we close with `force: true`.
 * - Listens for `window.editor.requestCloseActive` so Workspace's Cmd+W
 * global hotkey routes through the same dirty-modal flow (§7.9).
 */

export function EditorTabs(): JSX.Element {
  const { t } = useTranslation();
  const tabs = useEditor((s) => s.tabs);
  const activeTabId = useEditor((s) => s.activeTabId);
  const switchTab = useEditor((s) => s.switchTab);
  const closeTab = useEditor((s) => s.closeTab);
  const openEditorTab = useEditor((s) => s.openEditorTab);
  // — connections store drives the Health tab label; subscribe
  // to the whole schema state (mirrors how the test mock is shaped, while
  // still picking up reactive changes in production).
  const connections = useConnections((s) => s.connections);
  const schemaState = useSchema((s) => s);
  // subscribe to per-tab form-state map so the dirty dot
  // re-renders when the user types in any object-editor.
  const objectEditorFormByTab = useObjectEditorStore((s) => s.formByTab);
  const activeConnId =
    schemaState.connection.status === "connected" ? schemaState.connection.connId : null;

  const [pendingClose, setPendingClose] = useState<Tab | null>(null);
  // Inline rename — only editor tabs are renameable (other kinds derive their
  // label from connection / object / explain state). Holds the id of the tab
  // being renamed and the in-progress draft string.
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  function startRename(tab: Tab) {
    if (tab.kind !== "editor") return;
    setEditingTabId(tab.id);
    setRenameDraft(tab.name);
  }

  function commitRename() {
    if (editingTabId === null) {
      return;
    }
    const trimmed = renameDraft.trim();
    if (trimmed.length > 0) {
      useEditor.getState().renameEditorTab(editingTabId, trimmed);
    }
    setEditingTabId(null);
    setRenameDraft("");
  }

  function cancelRename() {
    setEditingTabId(null);
    setRenameDraft("");
  }

  // Auto-focus + select-all when the rename input mounts.
  useEffect(() => {
    if (editingTabId === null) return;
    const el = renameInputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [editingTabId]);
  // auto-scroll the active tab into view inside the horizontally
  // scrollable strip. Without this, opening a Live Ops tab via Cmd+Shift+L
  // appended a new tab off the right edge while the visible window still
  // showed Health, leaving the user unable to see what's now active.
  const tabScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (activeTabId === null) return;
    const root = tabScrollRef.current;
    if (!root) return;
    const target = root.querySelector<HTMLElement>(
      `[data-testid="editor-tab-${cssEscape(activeTabId)}"]`,
    );
    // jsdom (vitest) doesn't implement scrollIntoView; guard so unit
    // tests don't crash on a missing platform API.
    if (target && typeof target.scrollIntoView === "function") {
      target.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [activeTabId]);

  // Custom thin (3 px) scrollbar — native ::-webkit-scrollbar height is
  // ignored by macOS WKWebView (Tauri), so we draw our own thumb and sync
  // it with scrollLeft. `visible` flips off when content fits so the bar
  // doesn't render at all when there's nothing to scroll.
  const [scrollMeta, setScrollMeta] = useState<{
    leftPct: number;
    widthPct: number;
    visible: boolean;
  }>({ leftPct: 0, widthPct: 0, visible: false });

  // Click-and-drag the custom thumb to scroll the strip. Pointer capture
  // keeps move/up events flowing to the thumb even when the cursor leaves
  // it during the drag (e.g. moves below the tabbar).
  const onThumbPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const strip = tabScrollRef.current;
    if (!strip) return;
    e.preventDefault();
    e.stopPropagation();
    const thumb = e.currentTarget;
    const track = thumb.parentElement;
    const trackWidth = track?.clientWidth ?? strip.clientWidth;
    if (trackWidth === 0) return;
    // Each px of thumb travel == this many px of scroll. Track width tracks
    // strip clientWidth (same flex slot), so this collapses to the standard
    // scrollbar ratio scrollWidth / clientWidth.
    const ratio = strip.scrollWidth / trackWidth;
    const startX = e.clientX;
    const startScrollLeft = strip.scrollLeft;
    thumb.classList.add("is-dragging");
    try {
      thumb.setPointerCapture(e.pointerId);
    } catch {
      // setPointerCapture can throw if the pointer is already released;
      // safe to ignore — we still attach the move/up listeners below.
    }
    const onMove = (ev: PointerEvent) => {
      strip.scrollLeft = startScrollLeft + (ev.clientX - startX) * ratio;
    };
    const onUp = (ev: PointerEvent) => {
      thumb.classList.remove("is-dragging");
      thumb.removeEventListener("pointermove", onMove);
      thumb.removeEventListener("pointerup", onUp);
      thumb.removeEventListener("pointercancel", onUp);
      try {
        thumb.releasePointerCapture(ev.pointerId);
      } catch {
        // already released
      }
    };
    thumb.addEventListener("pointermove", onMove);
    thumb.addEventListener("pointerup", onUp);
    thumb.addEventListener("pointercancel", onUp);
  };
  // Track the scrollWidth via the React-known tab list rather than via a
  // MutationObserver — the previous version observed `subtree+characterData`
  // which fired on every i18next async-translation update, every dirty-dot
  // toggle, and every rename keystroke, dragging the main thread under load.
  // Now we only re-measure when (a) the user scrolls, (b) the strip itself
  // resizes (window / pane split), and (c) the React-tracked tab list
  // changes (add / remove / reorder / rename).
  const tabsKey = tabs.map((tab) => tab.id).join("|");
  useEffect(() => {
    const el = tabScrollRef.current;
    if (!el) return;
    let raf = 0;
    const measure = () => {
      const { scrollLeft, scrollWidth, clientWidth } = el;
      if (scrollWidth <= clientWidth + 1) {
        setScrollMeta({ leftPct: 0, widthPct: 0, visible: false });
        return;
      }
      const widthPct = (clientWidth / scrollWidth) * 100;
      const leftPct = (scrollLeft / scrollWidth) * 100;
      setScrollMeta({ leftPct, widthPct, visible: true });
    };
    // Defer first measure to next frame so the new tab DOM has flexed in.
    raf = requestAnimationFrame(measure);
    el.addEventListener("scroll", measure, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("scroll", measure);
      ro?.disconnect();
    };
    // tabsKey is the dep that re-runs the measure when tabs change.
    // biome-ignore lint/correctness/useExhaustiveDependencies: tabsKey covers tabs
  }, [tabsKey]);

  useEffect(() => {
    function onRequestCloseActive() {
      const state = useEditor.getState();
      const id = state.activeTabId;
      if (id === null) return;
      const tab = state.tabs.find((x) => x.id === id);
      if (!tab) return;
      requestClose(tab);
    }
    window.addEventListener("editor.requestCloseActive", onRequestCloseActive);
    return () => {
      window.removeEventListener("editor.requestCloseActive", onRequestCloseActive);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function requestClose(tab: Tab) {
    if (tab.kind === "editor" && tab.dirty) {
      setPendingClose(tab);
      return;
    }
    // object-editor tabs keep their dirty state in
    // `useObjectEditorStore`, not on the tab object itself. Mirror the
    // SQL-editor guard.
    if (tab.kind === "object-editor") {
      const formState = useObjectEditorStore.getState().formByTab[tab.id];
      if (formState && formStateDirty(formState.initial, formState.form)) {
        setPendingClose(tab);
        return;
      }
    }
    void closeTab(tab.id);
  }

  function handleNewTab() {
    const schema = useSchema.getState();
    const connId = schema.connection.status === "connected" ? schema.connection.connId : null;
    openEditorTab(connId);
  }

  function handleOpenHistory() {
    useEditor.getState().openHistoryTab();
  }

  function handleOpenRecentPlans() {
    useEditor.getState().openRecentPlansTab();
  }

  function handleOpenHealth() {
    if (activeConnId === null) return;
    useEditor.getState().openHealthTab(activeConnId);
  }

  // Notebook tab kind already exists in editor store, but had no
  // user-facing entry point. Create a fresh notebook with one empty SQL cell
  // and open it in a new tab; the user can rename + add cells as usual.
  async function handleOpenNotebook() {
    const id = `nb-${
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2)
    }`;
    try {
      const saved = await useNotebooks.getState().save({
        id,
        name: "Untitled notebook",
        cells: [],
        connectionId: activeConnId,
      });
      useEditor.getState().openNotebookTab(saved.id, activeConnId);
    } catch {
      // Fall back to opening a session-only tab — the notebook pane will
      // surface the underlying error.
      useEditor.getState().openNotebookTab(id, activeConnId);
    }
  }

  function handleOpenBackup() {
    if (activeConnId === null) return;
    useEditor.getState().openBackupTab(activeConnId);
  }

  function confirmClose() {
    if (pendingClose === null) return;
    const id = pendingClose.id;
    setPendingClose(null);
    void closeTab(id, { force: true });
  }

  function cancelClose() {
    setPendingClose(null);
  }

  return (
    <>
      <div
        role="tablist"
        aria-label={t("editor.tabs.new")}
        className="q-tabbar"
        data-testid="editor-tabs"
      >
        <div className="q-tab-strip-wrap">
          <div
            ref={tabScrollRef}
            style={{
              display: "flex",
              alignItems: "stretch",
              flex: 1,
              overflowX: "auto",
              overflowY: "hidden",
            }}
            className="q-tab-strip"
          >
            {tabs.map((tab) => {
              const isActive = tab.id === activeTabId;
              const tabName =
                tab.kind === "editor"
                  ? tab.name
                  : tab.kind === "object"
                    ? tab.nodeKey
                    : tab.kind === "history"
                      ? t("history.tab.title")
                      : tab.kind === "recent-plans"
                        ? t("recent_plans.tab.title")
                        : tab.kind === "plan-diff"
                          ? t("editor.tab.plan_diff_title", {
                              left: planDiffSideShortLabel(tab.left),
                              right: planDiffSideShortLabel(tab.right),
                            })
                          : tab.kind === "health"
                            ? t("health.tab.title", {
                                connection: getConnectionName(tab.connectionId, connections),
                              })
                            : tab.kind === "live-ops"
                              ? t("live_ops.tab.name_with_conn", {
                                  name: getConnectionName(tab.connectionId, connections),
                                })
                              : tab.kind === "erd"
                                ? t("erd.tab.title", {
                                    connection: getConnectionName(tab.connectionId, connections),
                                  })
                                : tab.kind === "migrations"
                                  ? t("migrations.tab.title", {
                                      connection: getConnectionName(tab.connectionId, connections),
                                    })
                                  : tab.kind === "object-editor"
                                    ? t("object_editor.tab.title", {
                                        kind: tab.target.objectKind,
                                        schema: tab.target.schema,
                                        name: tab.target.name ?? t("object_editor.tab.new_suffix"),
                                      })
                                    : tab.kind === "map-view"
                                      ? `Map View: ${tab.geometryColumn}`
                                      : tab.kind === "pg-stat-statements"
                                        ? "pg_stat_statements"
                                        : tab.kind === "notebook"
                                          ? t("notebook.tab.title")
                                          : tab.kind === "backup"
                                            ? t("backup.tab.title", {
                                                connection: getConnectionName(
                                                  tab.connectionId,
                                                  connections,
                                                ),
                                              })
                                            : t("editor.explain.tab.title", {
                                                source: tab.sourceTabId
                                                  ? getSourceName(tab.sourceTabId, tabs)
                                                  : "",
                                              });
              const objectEditorDirty =
                tab.kind === "object-editor"
                  ? (() => {
                      const s = objectEditorFormByTab[tab.id];
                      return s ? formStateDirty(s.initial, s.form) : false;
                    })()
                  : false;
              const dirty = (tab.kind === "editor" && tab.dirty) || objectEditorDirty;
              return (
                <div
                  key={tab.id}
                  className={`q-tab ${isActive ? "active" : ""}`}
                  style={{ paddingRight: 6 }}
                >
                  <button
                    type="button"
                    role="tab"
                    id={`editor-tab-${tab.id}`}
                    aria-selected={isActive}
                    aria-controls="editor-pane"
                    tabIndex={isActive ? 0 : -1}
                    onClick={() => switchTab(tab.id)}
                    onDoubleClick={() => startRename(tab)}
                    title={
                      tab.kind === "editor"
                        ? t("editor.tabs.rename_hint", "Двойной клик — переименовать")
                        : undefined
                    }
                    style={{
                      background: "transparent",
                      border: 0,
                      padding: 0,
                      color: "inherit",
                      fontSize: "inherit",
                      fontFamily: "inherit",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      cursor: "default",
                    }}
                    data-testid={`editor-tab-${tab.id}`}
                  >
                    {tab.kind === "live-ops" ? <Radar size={11} aria-hidden="true" /> : null}
                    {tab.kind === "erd" ? <Network size={11} aria-hidden="true" /> : null}
                    {editingTabId === tab.id ? (
                      <input
                        ref={renameInputRef}
                        value={renameDraft}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            commitRename();
                          } else if (e.key === "Escape") {
                            e.preventDefault();
                            cancelRename();
                          }
                        }}
                        onBlur={commitRename}
                        aria-label={t("editor.tabs.rename_aria", "Имя вкладки")}
                        data-testid={`editor-tab-rename-input-${tab.id}`}
                        style={{
                          background: "var(--bg-elev)",
                          border: "1px solid var(--accent)",
                          boxShadow: "0 0 0 3px var(--accent-soft)",
                          borderRadius: 4,
                          color: "inherit",
                          fontSize: "inherit",
                          fontFamily: "inherit",
                          padding: "1px 6px",
                          width: Math.max(80, renameDraft.length * 7 + 24),
                          maxWidth: 240,
                          outline: "none",
                        }}
                      />
                    ) : (
                      <span style={{ maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis" }}>
                        {tabName}
                      </span>
                    )}
                    {dirty ? (
                      <span
                        aria-hidden="true"
                        style={{ color: "var(--accent)", fontSize: 9 }}
                        data-testid={`editor-tab-dirty-${tab.id}`}
                      >
                        ●
                      </span>
                    ) : null}
                  </button>
                  <button
                    type="button"
                    aria-label={t("editor.tabs.close", { name: tabName })}
                    onClick={() => requestClose(tab)}
                    className="x"
                    data-testid={`editor-tab-close-${tab.id}`}
                    style={{ marginLeft: 2 }}
                  >
                    <X size={11} aria-hidden="true" />
                  </button>
                </div>
              );
            })}
          </div>
          {scrollMeta.visible ? (
            <div className="q-tab-scrollbar" aria-hidden="true">
              <div
                className="q-tab-scrollbar-thumb"
                onPointerDown={onThumbPointerDown}
                style={{
                  left: `${scrollMeta.leftPct}%`,
                  width: `${scrollMeta.widthPct}%`,
                }}
              />
            </div>
          ) : null}
        </div>
        <button
          type="button"
          aria-label={t("editor.tabs.new")}
          onClick={handleNewTab}
          className="btn-icon"
          style={{ alignSelf: "center", margin: "0 2px 0 4px" }}
          data-testid="editor-tab-new"
        >
          <Plus size={13} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label={t("history.tab.title")}
          title={t("history.tab.title")}
          onClick={handleOpenHistory}
          className="btn-icon"
          style={{ alignSelf: "center", margin: "0 4px 0 0" }}
          data-testid="editor-tab-history"
        >
          <History size={13} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label={t("recent_plans.tab.title")}
          title={t("recent_plans.tab.title")}
          onClick={handleOpenRecentPlans}
          className="btn-icon"
          style={{ alignSelf: "center", margin: "0 4px 0 0" }}
          data-testid="editor-tab-recent-plans"
        >
          <Layers size={13} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label={
            activeConnId === null
              ? t("editor.run.no_connection")
              : t("health.tab.aria_open", {
                  connection: getConnectionName(activeConnId, connections),
                })
          }
          title={
            activeConnId === null
              ? t("editor.run.no_connection")
              : t("health.tab.aria_open", {
                  connection: getConnectionName(activeConnId, connections),
                })
          }
          onClick={handleOpenHealth}
          disabled={activeConnId === null}
          className="btn-icon"
          style={{ alignSelf: "center", margin: "0 4px 0 0" }}
          data-testid="editor-tab-health"
        >
          <Activity size={13} aria-hidden="true" />
        </button>
        {/* Notebook entry. Always enabled; SQL cells will surface
            "Pick a connection" if no active connection. */}
        <button
          type="button"
          aria-label={t("notebook.tab.title")}
          title={t("notebook.tab.title")}
          onClick={() => void handleOpenNotebook()}
          className="btn-icon"
          style={{ alignSelf: "center", margin: "0 4px 0 0" }}
          data-testid="editor-tab-notebook"
        >
          <BookOpen size={13} aria-hidden="true" />
        </button>
        {/* Backup/Restore center entry. Disabled until a connection
            is active because the wizard dispatches against `connectionId`. */}
        <button
          type="button"
          aria-label={
            activeConnId === null
              ? t("editor.run.no_connection")
              : t("backup.tab.title", {
                  connection: getConnectionName(activeConnId, connections),
                })
          }
          title={
            activeConnId === null
              ? t("editor.run.no_connection")
              : t("backup.tab.title", {
                  connection: getConnectionName(activeConnId, connections),
                })
          }
          onClick={handleOpenBackup}
          disabled={activeConnId === null}
          className="btn-icon"
          style={{ alignSelf: "center", margin: "0 4px 0 0" }}
          data-testid="editor-tab-backup"
        >
          <HardDrive size={13} aria-hidden="true" />
        </button>
      </div>

      <Dialog
        open={pendingClose !== null}
        onOpenChange={(open) => {
          if (!open) cancelClose();
        }}
        title={t("editor.tabs.confirm_discard.title")}
        description={t("editor.tabs.confirm_discard.body", {
          name:
            pendingClose?.kind === "editor"
              ? pendingClose.name
              : pendingClose?.kind === "object-editor"
                ? `${pendingClose.target.objectKind} ${pendingClose.target.name ?? ""}`.trim()
                : "",
        })}
        size="sm"
        footer={
          <>
            <button
              type="button"
              onClick={cancelClose}
              className="btn btn-ghost"
              data-testid="editor-tab-discard-cancel"
            >
              {t("editor.tabs.confirm_discard.cancel")}
            </button>
            <button
              type="button"
              onClick={confirmClose}
              className="btn btn-danger"
              data-testid="editor-tab-discard-confirm"
            >
              {t("editor.tabs.confirm_discard.confirm")}
            </button>
          </>
        }
      />
    </>
  );
}

/**
 * escape an id for use inside an attribute selector. Live Ops
 * tab ids look like `live-ops-<uuid>` (already querySelector-safe), but
 * other call paths can mint ids with `:` or `.` that would otherwise
 * make the selector invalid. Prefer the native CSS.escape when present;
 * fall back to a minimal regex for the test environment.
 */
function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/([^\w-])/g, "\\$1");
}

/**
 * — resolve the display name of an EXPLAIN tab's source.
 *
 * EXPLAIN tabs are spouses of editor tabs (one explain per editor tab,
 * keyed by `sourceTabId`). The tab strip shows them as "EXPLAIN — <source>"
 * so the user can tell which editor tab the plan belongs to. If the source
 * has been closed (cascade should have happened, but defensively we may
 * miss a frame), we fall back to the raw id rather than blanking the strip.
 */
function getSourceName(sourceTabId: string, tabs: Tab[]): string {
  const src = tabs.find((t) => t.id === sourceTabId);
  return src && src.kind === "editor" ? src.name : sourceTabId;
}

/**
 * — short label for a PlanDiffSide for the tab strip. Cached
 * sides expose the recentPlanId prefix; runtime sides label as "current".
 * The full executedAt is shown inside the diff toolbar.
 */
function planDiffSideShortLabel(side: import("./store").PlanDiffSide): string {
  if (side.kind === "runtime") return "current";
  return side.recentPlanId.slice(0, 8);
}

/**
 * — resolve the display name for a Health tab's connection.
 * Falls back to a short id slice when the connection has been deleted.
 */
function getConnectionName(
  connectionId: string,
  connections: ReadonlyArray<{ id: string; name: string }>,
): string {
  const conn = connections.find((c) => c.id === connectionId);
  return conn ? conn.name : connectionId.slice(0, 8);
}
