import { type JSX, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog } from "../../../components/Dialog";
import { type RecentPlanRow, recentPlansSearch } from "../../../lib/tauri";
import type { PlanDiffSide } from "../store";

interface RecentPlansPickerModalProps {
  open: boolean;
  defaultConnectionId: string | null;
  onPick(side: PlanDiffSide): void;
  onCancel(): void;
}

const DEBOUNCE_MS = 300;
const PAGE_SIZE = 50;

/**
 * — single-select modal listing Recent Plans for the
 * `[Diff with…]` flow. Uses a local `recentPlansSearch` call so the
 * singleton `useRecentPlans` store doesn't get its filter state mutated
 * out from under the user's open Recent Plans tab.
 */
export function RecentPlansPickerModal({
  open,
  defaultConnectionId,
  onPick,
  onCancel,
}: RecentPlansPickerModalProps): JSX.Element | null {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [scope, setScope] = useState<"current" | "all">(defaultConnectionId ? "current" : "all");
  const [rows, setRows] = useState<RecentPlanRow[]>([]);
  const [loading, setLoading] = useState(false);

  // Reset on open / scope change
  useEffect(() => {
    if (!open) return;
    setScope(defaultConnectionId ? "current" : "all");
    setSearch("");
    setDebounced("");
  }, [open, defaultConnectionId]);

  // Debounce search input
  useEffect(() => {
    if (!open) return;
    const handle = setTimeout(() => setDebounced(search), DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [search, open]);

  // Fetch on filter change
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    const filter = {
      connectionId: scope === "current" ? (defaultConnectionId ?? undefined) : undefined,
      query: debounced || undefined,
      limit: PAGE_SIZE,
      offset: 0,
    };
    recentPlansSearch(filter)
      .then((res) => {
        if (cancelled) return;
        setRows(res.rows);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, scope, debounced, defaultConnectionId]);

  if (!open) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
      title={t("editor.explain.diff.picker.title")}
      description={t("editor.explain.diff.picker.description")}
      closeAriaLabel={t("editor.explain.diff.picker.cancel")}
      size="md"
      footer={
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          {t("editor.explain.diff.picker.cancel")}
        </button>
      }
    >
      <div
        data-testid="recent-plans-picker-modal"
        style={{ display: "flex", flexDirection: "column", gap: 8 }}
      >
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            className={`btn btn-sm ${scope === "current" ? "btn-accent" : "btn-ghost"}`}
            onClick={() => setScope("current")}
            disabled={!defaultConnectionId}
            data-testid="picker-scope-current"
          >
            {t("editor.explain.diff.picker.scope_current_conn")}
          </button>
          <button
            type="button"
            className={`btn btn-sm ${scope === "all" ? "btn-accent" : "btn-ghost"}`}
            onClick={() => setScope("all")}
            data-testid="picker-scope-all"
          >
            {t("editor.explain.diff.picker.scope_all")}
          </button>
        </div>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="q-input"
          placeholder={t("editor.explain.diff.picker.title")}
          data-testid="picker-search"
        />
        <div style={{ maxHeight: 320, overflowY: "auto", borderTop: "1px solid var(--hairline)" }}>
          {!loading && rows.length === 0 ? (
            <div data-testid="picker-empty" style={{ padding: 12, opacity: 0.6 }}>
              {t("editor.explain.diff.picker.empty")}
            </div>
          ) : null}
          {rows.map((row) => (
            <button
              type="button"
              key={row.id}
              data-testid={`picker-row-${row.id}`}
              onClick={() => onPick({ kind: "recent", recentPlanId: row.id })}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "8px 10px",
                background: "transparent",
                border: 0,
                borderBottom: "1px solid var(--hairline)",
                cursor: "pointer",
              }}
            >
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>
                {row.sql.length > 140 ? `${row.sql.slice(0, 140)}…` : row.sql}
              </div>
              <div style={{ display: "flex", gap: 6, fontSize: 10, opacity: 0.65 }}>
                <span>{row.connectionName}</span>
                <span>·</span>
                <span>{row.mode === "analyze" ? "ANALYZE" : "EXPLAIN"}</span>
                <span>·</span>
                <span>{row.durationMs}ms</span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </Dialog>
  );
}
