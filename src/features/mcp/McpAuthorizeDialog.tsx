/**
 * Modal for the first connection of an external MCP client.
 *
 * Mounted once at the App level. Listens for the Tauri event
 * `mcp:authorize-request` (payload: { requestId, clientName,
 * requestedScopes }) and shows a Radix dialog with three affirmative
 * buttons (default scope set / read-only / with write) plus Deny.
 *
 * Backend: `mcp_authorize_response(requestId, scopes)` /
 * `mcp_authorize_deny(requestId)` — see `commands.rs`.
 */

import { type UnlistenFn, listen } from "@tauri-apps/api/event";
import { type JSX, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog } from "../../components/Dialog";
import { useToast } from "../../components/Toast";
import {
  type AuthorizeRequestEvent,
  type McpScope,
  authorizeRequestEventSchema,
  mcpAuthorizeDeny,
  mcpAuthorizeResponse,
} from "./api";

const DEFAULT_GRANT: McpScope[] = ["db-read", "ide-read", "ide-write"];
const READ_ONLY_GRANT: McpScope[] = ["db-read", "ide-read"];
const WRITE_GRANT: McpScope[] = ["db-read", "db-write", "ide-read", "ide-write"];

function formatBackendError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export function McpAuthorizeDialog(): JSX.Element | null {
  const { t } = useTranslation();
  const toast = useToast();
  const [pending, setPending] = useState<AuthorizeRequestEvent | null>(null);

  useEffect(() => {
    let cancelled = false;
    let off: UnlistenFn | null = null;
    void (async () => {
      const u = await listen<unknown>("mcp:authorize-request", (event) => {
        const parsed = authorizeRequestEventSchema.safeParse(event.payload);
        if (!parsed.success) {
          toast.error(`mcp:authorize-request: ${parsed.error.message}`);
          return;
        }
        setPending(parsed.data);
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

  const close = () => setPending(null);

  const allow = async (scopes: McpScope[]) => {
    if (!pending) return;
    try {
      await mcpAuthorizeResponse(pending.requestId, scopes);
      close();
    } catch (err) {
      toast.error(formatBackendError(err));
    }
  };

  const deny = async () => {
    if (!pending) return;
    try {
      await mcpAuthorizeDeny(pending.requestId);
      close();
    } catch (err) {
      toast.error(formatBackendError(err));
    }
  };

  if (!pending) return null;

  return (    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) void deny();
      }}
      title={t("settings.mcp.authorize.title")}
      description={t("settings.mcp.authorize.requesting", { client: pending.clientName })}
      size="md"
      footer={
        <>
          <button type="button" onClick={() => void deny()} data-testid="mcp-authorize-deny">
            {t("settings.mcp.authorize.deny")}
          </button>
          <button
            type="button"
            onClick={() => void allow(READ_ONLY_GRANT)}
            data-testid="mcp-authorize-read-only"
          >
            {t("settings.mcp.authorize.allowReadOnly")}
          </button>
          <button
            type="button"
            onClick={() => void allow(WRITE_GRANT)}
            data-testid="mcp-authorize-with-write"
          >
            {t("settings.mcp.authorize.allowWithWrite")}
          </button>
          <button
            type="button"
            onClick={() => void allow(DEFAULT_GRANT)}
            data-testid="mcp-authorize-allow"
          >
            {t("settings.mcp.authorize.allow")}
          </button>
        </>
      }
    >
      <div className="mcp-authorize-body">
        <h4>{t("settings.mcp.authorize.scopesHeading")}</h4>
        <ul className="mcp-authorize-scopes">
          {pending.requestedScopes.map((s) => (            <li key={s}>
              <code>{s}</code>
            </li>
))}
        </ul>
      </div>
    </Dialog>
);
}
