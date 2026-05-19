/**
 * — Query History row.
 *
 * Renders a single row in the History list. Layout:
 * [pin star] [time] [duration] [status pill] [SQL preview] [⋮ menu]
 *
 * Actions:
 * - Replay: opens a NEW editor tab pinned to the recorded connection,
 * prefilled with the SQL. If that connection no longer exists we toast
 * `history.replay.connection_deleted` and bail (never reuse a current
 * tab — the user might be staring at unrelated work).
 * - Pin / unpin: toggles `pinned` via store.setPinned.
 * - Copy SQL: writes to clipboard.
 * - Delete: opens a confirm dialog, then store.remove.
 *
 * Styling uses the q-* design language (q-pill for status, btn-icon for the
 * actions trigger) so the History panel reads as part of the same workspace
 * as Connections / Schema / RunToolbar.
 */

import { Star } from "lucide-react";
import { type CSSProperties, type JSX, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog } from "../../components/Dialog";
import { DropdownMenu } from "../../components/DropdownMenu";
import { useToast } from "../../components/Toast";
import type { HistoryRow as HistoryRowData, HistoryStatus } from "../../lib/tauri";
import { useConnections } from "../connections/store";
import { useEditor } from "../editor/store";
import { useHistory } from "./store";

export interface HistoryRowProps {
  row: HistoryRowData;
  /** Optional inline style — used by the virtualizer for transform: translateY(...). */
  style?: CSSProperties;
}

function formatTime(iso: string): string {
  // HH:MM:SS in local time. `Date.toLocaleTimeString` is enough here and
  // saves us pulling date-fns just for one row format.
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleTimeString();
  } catch {
    return iso;
  }
}

/**
 * Map a HistoryStatus to the matching `q-pill` modifier. Cancelled rows fall
 * back to the default neutral pill (no modifier) — it has the same gray
 * surface treatment as the schema browser's "row count" chip.
 */
function statusPillClass(status: HistoryStatus): string {
  switch (status) {
    case "ok":
      return "q-pill ok";
    case "error":
      return "q-pill err";
    case "cancelled":
      return "q-pill";
  }
}

export function HistoryRow({ row, style }: HistoryRowProps): JSX.Element {
  const { t } = useTranslation();
  const toast = useToast();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  function replay() {
    const conn = useConnections.getState().connections.find((c) => c.id === row.connectionId);
    if (!conn) {
      toast.error(t("history.replay.connection_deleted"));
      return;
    }
    useEditor.getState().openEditorTab(row.connectionId, { prefillSql: row.sql });
  }

  async function togglePin() {
    try {
      await useHistory.getState().setPinned(row.id, !row.pinned);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  async function copySql() {
    try {
      await navigator.clipboard.writeText(row.sql);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  async function confirmDelete() {
    setShowDeleteConfirm(false);
    try {
      await useHistory.getState().remove(row.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  const items = [
    { label: t("history.row.replay"), onSelect: replay },
    {
      label: row.pinned ? t("history.row.unpin") : t("history.row.pin"),
      onSelect: () => {
        void togglePin();
      },
    },
    {
      label: t("history.row.copy_sql"),
      onSelect: () => {
        void copySql();
      },
    },
    {
      label: t("history.row.delete"),
      onSelect: () => setShowDeleteConfirm(true),
      destructive: true,
    },
  ];

  return (
    <>
      <div
        data-testid={`history-row-${row.id}`}
        style={{
          ...style,
          display: "grid",
          gridTemplateColumns: "24px 80px 64px 88px 1fr 28px",
          alignItems: "center",
          gap: 8,
          padding: "0 12px",
          borderBottom: "1px solid var(--hairline)",
          fontSize: 12.5,
          color: "var(--ink-2)",
          background: "var(--bg-elev)",
        }}
      >
        <button
          type="button"
          aria-label={row.pinned ? t("history.row.unpin") : t("history.row.pin")}
          onClick={() => void togglePin()}
          className="btn-icon"
          data-testid={`history-row-pin-${row.id}`}
          style={{ width: 22, height: 22 }}
        >
          <Star
            size={13}
            aria-hidden="true"
            fill={row.pinned ? "currentColor" : "none"}
            style={{ color: row.pinned ? "var(--accent)" : "currentColor" }}
          />
        </button>
        <span
          title={row.executedAt}
          style={{ fontFamily: "var(--font-mono-q)", color: "var(--ink-3)", fontSize: 11.5 }}
        >
          {formatTime(row.executedAt)}
        </span>
        <span style={{ fontFamily: "var(--font-mono-q)", color: "var(--ink-3)", fontSize: 11.5 }}>
          {row.durationMs}ms
        </span>
        <span className={statusPillClass(row.status)} data-testid={`history-row-status-${row.id}`}>
          {t(`history.filter.status.${row.status}`)}
        </span>
        <code
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontFamily: "var(--font-mono-q)",
            fontSize: 12,
            color: "var(--ink)",
          }}
        >
          {row.sql}
        </code>
        <DropdownMenu
          ariaLabel={t("history.row.replay")}
          align="end"
          trigger={
            <button
              type="button"
              aria-label={t("history.row.replay")}
              className="btn-icon"
              data-testid={`history-row-menu-${row.id}`}
              style={{ width: 22, height: 22, fontSize: 14, lineHeight: 1 }}
            >
              ⋮
            </button>
          }
          items={items}
        />
      </div>

      <Dialog
        open={showDeleteConfirm}
        onOpenChange={(next) => {
          if (!next) setShowDeleteConfirm(false);
        }}
        title={t("history.row.delete")}
        description={t("history.confirm.delete_row")}
        size="sm"
        footer={
          <>
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(false)}
              className="btn btn-ghost"
              data-testid={`history-row-delete-cancel-${row.id}`}
            >
              {t("editor.tabs.confirm_discard.cancel")}
            </button>
            <button
              type="button"
              onClick={() => void confirmDelete()}
              className="btn btn-danger"
              data-testid={`history-row-delete-confirm-${row.id}`}
            >
              {t("history.row.delete")}
            </button>
          </>
        }
      />
    </>
  );
}
