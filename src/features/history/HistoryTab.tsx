/**
 * — Query History tab.
 *
 * Layout:
 * header  → search input + connection / status filters + pinned toggle + ⋯ menu
 * main    → virtualized list of HistoryRow (or empty / error state)
 * footer  → "Showing N of M" + Load More
 *
 * Search debounces 250ms — typed keystrokes mutate `filters.query` synchronously
 * (so the input value never lags the user) but the actual `refresh()` IPC fires
 * after the debounce window closes. The store guarantees that loadMore is a
 * no-op while loading or when all rows are already loaded.
 *
 * Onmount → store.refresh(). The History tab is created lazily by Cmd/Ctrl+H
 * (or the History icon in the tab strip) so this only runs when the user
 * explicitly opens it.
 *
 * Styling uses the q-* design language from `src/styles/design.css` — the
 * input is a plain `q-input` with no overlapping icon (the magnifying glass
 * lived inside the field via absolute positioning, but it collided with the
 * placeholder text). Filter selects use `q-select`-like primitives wrapped in
 * the existing `<Select />` component.
 */

import { useVirtualizer } from "@tanstack/react-virtual";
import { MoreHorizontal } from "lucide-react";
import { type ChangeEvent, type JSX, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog } from "../../components/Dialog";
import { DropdownMenu } from "../../components/DropdownMenu";
import { Select } from "../../components/Select";
import { useToast } from "../../components/Toast";
import type { HistoryStatus } from "../../lib/tauri";
import { useConnections } from "../connections/store";
import { HistoryRow } from "./HistoryRow";
import { useHistory } from "./store";

const ROW_HEIGHT = 36;
const SEARCH_DEBOUNCE_MS = 250;
const ALL_OPTION = "__all__";

export function HistoryTab(): JSX.Element {
  const { t } = useTranslation();
  const toast = useToast();

  const filters = useHistory((s) => s.filters);
  const rows = useHistory((s) => s.rows);
  const totalMatched = useHistory((s) => s.totalMatched);
  const loading = useHistory((s) => s.loading);
  const error = useHistory((s) => s.error);

  const connections = useConnections((s) => s.connections);

  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Mount: kick off initial fetch.
  useEffect(() => {
    void useHistory.getState().refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Workspace dispatches `history.focusSearch` when Cmd/Ctrl+F lands while
  // the History tab is active. Brings the search input into focus instead
  // of leaving the user staring at the suppressed native find-in-page.
  useEffect(() => {
    function onFocusSearch() {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    }
    window.addEventListener("history.focusSearch", onFocusSearch);
    return () => window.removeEventListener("history.focusSearch", onFocusSearch);
  }, []);

  // Debounced refresh on filter changes that should re-query the backend.
  // We trigger refresh whenever any filter changes — the store has its own
  // single-flight loading flag. Biome flags these deps as unused because the
  // effect body reads via getState(), but we DO need the deps to fire the
  // re-run when filters mutate.
  // biome-ignore lint/correctness/useExhaustiveDependencies: each filter triggers a new debounced refresh — getState() inside is intentional.
  useEffect(() => {
    const timer = setTimeout(() => {
      void useHistory.getState().refresh();
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [
    filters.query,
    filters.connectionId,
    filters.status,
    filters.pinnedOnly,
    filters.since,
    filters.until,
  ]);

  const virtualParentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => virtualParentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  const connectionOptions = useMemo(() => {
    const opts = [
      { value: ALL_OPTION, label: t("history.filter.connection.all") },
      ...connections.map((c) => ({ value: c.id, label: c.name })),
    ];
    // Surface deleted connections referenced by current rows so the user can
    // still filter to them post-deletion.
    const knownIds = new Set(connections.map((c) => c.id));
    const deletedIds = new Map<string, string>();
    for (const r of rows) {
      if (!knownIds.has(r.connectionId)) {
        deletedIds.set(r.connectionId, r.connectionName || r.connectionId);
      }
    }
    for (const [id, name] of deletedIds) {
      opts.push({
        value: id,
        label: `${name} ${t("history.filter.connection.deleted")}`,
      });
    }
    return opts;
  }, [connections, rows, t]);

  const statusOptions = [
    { value: ALL_OPTION, label: t("history.filter.status.all") },
    { value: "ok", label: t("history.filter.status.ok") },
    { value: "error", label: t("history.filter.status.error") },
    { value: "cancelled", label: t("history.filter.status.cancelled") },
  ];

  function handleConnectionChange(value: string) {
    useHistory.getState().setFilter("connectionId", value === ALL_OPTION ? null : value);
  }

  function handleStatusChange(value: string) {
    useHistory
      .getState()
      .setFilter("status", value === ALL_OPTION ? null : (value as HistoryStatus));
  }

  function togglePinnedOnly() {
    useHistory.getState().setFilter("pinnedOnly", !filters.pinnedOnly);
  }

  function onSearchInput(e: ChangeEvent<HTMLInputElement>) {
    useHistory.getState().setFilter("query", e.target.value);
  }

  async function handleExport() {
    const result = await useHistory.getState().exportToFile();
    if (result.ok) {
      toast.success(t("history.export.success", { count: result.count, path: result.path }));
    } else if (!result.cancelled) {
      toast.error(result.error ?? "");
    }
  }

  async function handleClearForConnection() {
    setShowClearConfirm(false);
    const connId = filters.connectionId;
    if (!connId) return;
    try {
      await useHistory.getState().clearForConnection(connId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  const overflowItems = [
    {
      label: t("history.menu.refresh"),
      onSelect: () => {
        void useHistory.getState().refresh();
      },
    },
    {
      label: t("history.menu.clear_for_connection"),
      onSelect: () => setShowClearConfirm(true),
      disabled: !filters.connectionId,
    },
    {
      label: t("history.menu.export"),
      onSelect: () => {
        void handleExport();
      },
    },
  ];

  const showLoadMore = rows.length < totalMatched;

  return (    <div
      data-testid="history-tab"
      style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 12px",
          borderBottom: "1px solid var(--hairline)",
          background: "var(--bg)",
          flex: "0 0 auto",
          flexWrap: "wrap",
        }}
      >
        <input
          ref={searchInputRef}
          type="search"
          value={filters.query}
          onChange={onSearchInput}
          placeholder={t("history.search.placeholder")}
          aria-label={t("history.search.aria")}
          data-testid="history-search-input"
          className="q-input"
          style={{ flex: "1 1 180px", minWidth: 140 }}
        />
        <div
          style={{ flex: "1 1 160px", minWidth: 140, maxWidth: 220 }}
          data-testid="history-filter-connection"
        >
          <Select
            ariaLabel={t("history.filter.connection.all")}
            value={filters.connectionId ?? ALL_OPTION}
            onValueChange={handleConnectionChange}
            options={connectionOptions}
          />
        </div>
        <div
          style={{ flex: "1 1 120px", minWidth: 110, maxWidth: 160 }}
          data-testid="history-filter-status"
        >
          <Select
            ariaLabel={t("history.filter.status.all")}
            value={filters.status ?? ALL_OPTION}
            onValueChange={handleStatusChange}
            options={statusOptions}
          />
        </div>
        <button
          type="button"
          onClick={togglePinnedOnly}
          aria-pressed={filters.pinnedOnly}
          data-testid="history-filter-pinned"
          className={filters.pinnedOnly ? "btn btn-accent btn-sm" : "btn btn-sm"}
        >
          {t("history.filter.pinned_only")}
        </button>
        <DropdownMenu
          align="end"
          ariaLabel={t("history.menu.refresh")}
          trigger={
            <button
              type="button"
              aria-label={t("history.menu.refresh")}
              data-testid="history-menu-trigger"
              className="btn-icon"
            >
              <MoreHorizontal size={14} aria-hidden="true" />
            </button>
          }
          items={overflowItems}
        />
      </header>

      <main
        ref={virtualParentRef}
        className="q-scroll"
        style={{
          position: "relative",
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          background: "var(--bg-elev)",
        }}
      >
        {error ? (          <div
            role="alert"
            data-testid="history-error"
            style={{
              margin: 12,
              padding: "10px 12px",
              borderRadius: "var(--r-md)",
              border: "1px solid var(--danger-q)",
              background: "var(--danger-q-soft)",
              color: "var(--danger-q)",
              fontSize: 13,
            }}
          >
            <p style={{ fontWeight: 500, margin: 0 }}>{t("history.error.title")}</p>
            <p style={{ margin: "4px 0 0", fontSize: 12 }}>{error}</p>
            <button
              type="button"
              onClick={() => {
                void useHistory.getState().refresh();
              }}
              className="btn btn-sm"
              style={{ marginTop: 8 }}
            >
              {t("history.error.retry")}
            </button>
          </div>
) : null}

        {!loading && rows.length === 0 && !error ? (          <div
            data-testid="history-empty"
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              padding: "0 24px",
              textAlign: "center",
              color: "var(--ink-3)",
            }}
          >
            <p style={{ fontSize: 14, fontWeight: 500, margin: 0, color: "var(--ink-2)" }}>
              {t("history.empty.title")}
            </p>
            <p style={{ fontSize: 13, margin: "4px 0 0", color: "var(--ink-4)" }}>
              {t("history.empty.body")}
            </p>
          </div>
) : null}

        {rows.length > 0 ? (          <div
            style={{ height: virtualizer.getTotalSize(), position: "relative" }}
            data-testid="history-list"
          >
            {virtualizer.getVirtualItems().map((vi) => {
              const row = rows[vi.index];
              if (!row) return null;
              return (                <HistoryRow
                  key={row.id}
                  row={row}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: ROW_HEIGHT,
                    transform: `translateY(${vi.start}px)`,
                  }}
                />
);
            })}
          </div>
) : null}
      </main>

      <footer
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "6px 12px",
          borderTop: "1px solid var(--hairline)",
          background: "var(--bg)",
          color: "var(--ink-4)",
          fontSize: 11.5,
          flex: "0 0 auto",
        }}
      >
        <span data-testid="history-pagination-summary">
          {t("history.pagination.showing", { shown: rows.length, total: totalMatched })}
        </span>
        {showLoadMore ? (          <button
            type="button"
            onClick={() => {
              void useHistory.getState().loadMore();
            }}
            data-testid="history-load-more"
            disabled={loading}
            className="btn btn-sm"
          >
            {t("history.pagination.load_more")}
          </button>
) : null}
      </footer>

      <Dialog
        open={showClearConfirm}
        onOpenChange={(next) => {
          if (!next) setShowClearConfirm(false);
        }}
        title={t("history.menu.clear_for_connection")}
        description={t("history.confirm.clear_for_connection")}
        size="sm"
        footer={
          <>
            <button
              type="button"
              onClick={() => setShowClearConfirm(false)}
              className="btn btn-ghost"
              data-testid="history-clear-cancel"
            >
              {t("editor.tabs.confirm_discard.cancel")}
            </button>
            <button
              type="button"
              onClick={() => void handleClearForConnection()}
              className="btn btn-danger"
              data-testid="history-clear-confirm"
            >
              {t("history.row.delete")}
            </button>
          </>
        }
      />
    </div>
);
}
