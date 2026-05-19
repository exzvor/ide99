/**
 * Settings → AI / MCP section.
 *
 * Full UI for managing the MCP server:
 * - Enable toggle and status (port / IPC socket / N clients).
 * - List of authorized clients with last-used and a Revoke button.
 * - "Connect your agent" block: shows ready-made JSON for Claude Code
 *   and Cursor with copy-to-clipboard. Auto-add via a CLI command is
 *   deferred (no rust-side helper yet; UI is prepared for it).
 * - Link button to the full MCP guide.
 */

import { type JSX, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "../../components/Toast";
import { ExternalServers } from "./ExternalServers";
import {
  type AuthorizedClient,
  type McpConfigSnippet,
  type McpServerStatus,
  mcpGetConfigSnippet,
  mcpGetStatus,
  mcpListClients,
  mcpRevokeClient,
  mcpSetEnabled,
} from "./api";

function formatBackendError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (    err &&
    typeof err === "object" &&
    "message" in err &&
    typeof (err as { message: unknown }).message === "string"
) {
    return (err as { message: string }).message;
  }
  return String(err);
}

function formatLastUsed(iso: string | null): string | null {
  if (iso === null) return null;
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return iso;
  return new Date(ts).toLocaleString();
}

export function SettingsMcp(): JSX.Element {
  const { t } = useTranslation();
  const toast = useToast();
  const [status, setStatus] = useState<McpServerStatus | null>(null);
  const [clients, setClients] = useState<AuthorizedClient[]>([]);
  const [snippet, setSnippet] = useState<McpConfigSnippet | null>(null);
  const [snippetError, setSnippetError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<"claude" | "cursor" | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [s, c] = await Promise.all([mcpGetStatus(), mcpListClients()]);
        if (cancelled) return;
        setStatus(s);
        setClients(c);
        if (s.enabled) {
          try {
            const snip = await mcpGetConfigSnippet();
            if (!cancelled) setSnippet(snip);
          } catch (err) {
            if (!cancelled) setSnippetError(formatBackendError(err));
          }
        }
      } catch (err) {
        if (!cancelled) toast.error(formatBackendError(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // toast is stable — exclude to avoid re-fetch.
    // biome-ignore lint/correctness/useExhaustiveDependencies: stable
  }, []);

  const refreshSnippet = async (enabled: boolean) => {
    if (!enabled) {
      setSnippet(null);
      setSnippetError(null);
      return;
    }
    try {
      const snip = await mcpGetConfigSnippet();
      setSnippet(snip);
      setSnippetError(null);
    } catch (err) {
      setSnippetError(formatBackendError(err));
    }
  };

  const onToggle = async (enabled: boolean) => {
    try {
      const next = await mcpSetEnabled(enabled);
      setStatus(next);
      await refreshSnippet(next.enabled);
    } catch (err) {
      toast.error(formatBackendError(err));
    }
  };

  const onRevoke = async (id: string) => {
    try {
      await mcpRevokeClient(id);
      setClients((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      toast.error(formatBackendError(err));
    }
  };

  const onCopy = async (which: "claude" | "cursor", text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      window.setTimeout(() => setCopied((cur) => (cur === which ? null : cur)), 2000);
    } catch (err) {
      toast.error(formatBackendError(err));
    }
  };

  if (loading) {
    return <div className="mcp-loading">{t("settings.mcp.loading")}</div>;
  }

  const enabled = status?.enabled ?? false;

  return (    <section className="mcp-section settings-mcp">
      <header>
        <h2>{t("settings.mcp.title")}</h2>
        <p className="mcp-description">{t("settings.mcp.description")}</p>
      </header>

      <div className="mcp-toggle-row">
        <label>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => onToggle(e.target.checked)}
            data-testid="mcp-enable-toggle"
          />
          {t("settings.mcp.enableLabel")}
        </label>
        {enabled && status?.httpPort != null ? (          <span className="mcp-port-info">
            {t("settings.mcp.runningOnPort", { port: status.httpPort })}
          </span>
) : null}
      </div>

      <div className="mcp-clients">
        <h3>{t("settings.mcp.authorizedClients")}</h3>
        {clients.length === 0 ? (          <p className="mcp-empty">{t("settings.mcp.noClients")}</p>
) : (          <ul>
            {clients.map((c) => {
              const lastUsed = formatLastUsed(c.lastUsedAt);
              return (                <li key={c.id} className="mcp-client-row">
                  <span className="mcp-client-name">{c.name}</span>
                  <span className="mcp-scopes">{c.scopes.join(", ")}</span>
                  <span className="mcp-last-used">
                    {lastUsed
                      ? t("settings.mcp.lastUsed", { when: lastUsed })
                      : t("settings.mcp.lastUsedNever")}
                  </span>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => onRevoke(c.id)}
                    data-testid={`mcp-revoke-${c.id}`}
                  >
                    {t("settings.mcp.revoke")}
                  </button>
                </li>
);
            })}
          </ul>
)}
      </div>

      <div className="mcp-onboarding">
        <h3>{t("settings.mcp.connectAgent")}</h3>
        <p>{t("settings.mcp.connectAgentHint")}</p>

        {!enabled ? (          <p className="mcp-empty">{t("settings.mcp.connect.enableFirst")}</p>
) : snippetError ? (          <p className="mcp-empty">{snippetError}</p>
) : snippet ? (          <div className="mcp-config-blocks">
            <div className="mcp-config-block">
              <header>
                <strong>{t("settings.mcp.connect.claudeCode")}</strong>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => onCopy("claude", snippet.claudeCode)}
                  data-testid="mcp-copy-claude"
                >
                  {copied === "claude"
                    ? t("settings.mcp.connect.copied")
                    : t("settings.mcp.connect.copy")}
                </button>
              </header>
              <pre className="mcp-config-json">{snippet.claudeCode}</pre>
            </div>

            <div className="mcp-config-block">
              <header>
                <strong>{t("settings.mcp.connect.cursor")}</strong>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => onCopy("cursor", snippet.cursor)}
                  data-testid="mcp-copy-cursor"
                >
                  {copied === "cursor"
                    ? t("settings.mcp.connect.copied")
                    : t("settings.mcp.connect.copy")}
                </button>
              </header>
              <pre className="mcp-config-json">{snippet.cursor}</pre>
            </div>
          </div>
) : null}

        <p className="mcp-help-link">
          <a
            href="https://ide99.ru/docs/mcp"
            target="_blank"
            rel="noopener noreferrer"
          >
            {t("settings.mcp.connect.readGuide")}
          </a>
        </p>
      </div>

      {/* — outbound MCP client to external servers (Linear, GitHub, …). */}
      <ExternalServers />
    </section>
);
}
