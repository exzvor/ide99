/**
 * Confirmation modal for write operations (run_query_write,
 * apply_migration).
 *
 * Listens for the Tauri event `mcp:write-confirm-request` and shows a SQL
 * preview with Approve / Reject. An optional "approve all writes from this
 * client for next 5 min" checkbox is backed by a local `Map<clientName,
 * timestamp>`; every event first checks whether it is already covered by
 * a sticky grant (in which case it is auto-approved without UI).
 *
 * Backend: `mcp_write_confirm_response(requestId, allow)` —
 * see `commands.rs`.
 */

import { type UnlistenFn, listen } from "@tauri-apps/api/event";
import { type JSX, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog } from "../../components/Dialog";
import { useToast } from "../../components/Toast";
import { type WriteConfirmEvent, mcpWriteConfirmResponse, writeConfirmEventSchema } from "./api";

const STICKY_WINDOW_MS = 5 * 60 * 1000;
const stickyGrants = new Map<string, number>();

function formatBackendError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export function McpWriteConfirmDialog(): JSX.Element | null {
  const { t } = useTranslation();
  const toast = useToast();
  const [pending, setPending] = useState<WriteConfirmEvent | null>(null);
  const [approveAll, setApproveAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let off: UnlistenFn | null = null;
    void (async () => {
      const u = await listen<unknown>("mcp:write-confirm-request", (event) => {
        const parsed = writeConfirmEventSchema.safeParse(event.payload);
        if (!parsed.success) {
          toast.error(`mcp:write-confirm-request: ${parsed.error.message}`);
          return;
        }
        const ev = parsed.data;
        const stickyTs = stickyGrants.get(ev.clientName);
        if (stickyTs !== undefined && Date.now() - stickyTs < STICKY_WINDOW_MS) {
          // Auto-approve under sticky grant.
          void mcpWriteConfirmResponse(ev.requestId, true).catch((err) =>
            toast.error(formatBackendError(err)),
          );
          return;
        }
        // Drop expired sticky entries lazily.
        if (stickyTs !== undefined) stickyGrants.delete(ev.clientName);
        setApproveAll(false);
        setPending(ev);
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
    // toast is stable
    // biome-ignore lint/correctness/useExhaustiveDependencies: stable
  }, []);

  const close = () => {
    setPending(null);
    setApproveAll(false);
  };

  const approve = async () => {
    if (!pending) return;
    try {
      await mcpWriteConfirmResponse(pending.requestId, true);
      if (approveAll) stickyGrants.set(pending.clientName, Date.now());
      close();
    } catch (err) {
      toast.error(formatBackendError(err));
    }
  };

  const reject = async () => {
    if (!pending) return;
    try {
      await mcpWriteConfirmResponse(pending.requestId, false);
      close();
    } catch (err) {
      toast.error(formatBackendError(err));
    }
  };

  if (!pending) return null;

  const kindLabel =
    pending.kind === "migration"
      ? t("settings.mcp.writeConfirm.kindMigration")
      : t("settings.mcp.writeConfirm.kindQuery");

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) void reject();
      }}
      title={t("settings.mcp.writeConfirm.title")}
      description={t("settings.mcp.writeConfirm.clientWants", {
        client: pending.clientName,
        kind: kindLabel,
      })}
      size="lg"
      footer={
        <>
          <button type="button" onClick={() => void reject()} data-testid="mcp-write-reject">
            {t("settings.mcp.writeConfirm.reject")}
          </button>
          <button type="button" onClick={() => void approve()} data-testid="mcp-write-approve">
            {t("settings.mcp.writeConfirm.approve")}
          </button>
        </>
      }
    >
      <div className="mcp-write-confirm-body">
        <pre className="mcp-write-sql">{pending.sql}</pre>
        <label className="mcp-sticky-check">
          <input
            type="checkbox"
            checked={approveAll}
            onChange={(e) => setApproveAll(e.target.checked)}
            data-testid="mcp-write-sticky"
          />
          {t("settings.mcp.writeConfirm.approveAllForNext", { minutes: 5 })}
        </label>
      </div>
    </Dialog>
  );
}
