/**
 * — Settings → AI / MCP → External servers section.
 *
 * Renders the user-configured external MCP servers (`~/.config/ide99/
 * mcp-servers.json`) with live status (Disconnected / Connecting /
 * Connected{tools, resources} / Error). Per-row Connect / Disconnect.
 * Top toolbar: Reload config (re-read from disk + sync registry) +
 * "Open config file" path display.
 *
 * v1.0 is read-only — we list what each server exposes but don't call
 * tools. v1.1+ AI features will consume the cached `tools`/`resources`.
 */

import { type JSX, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "../../components/Toast";
import {
  type ConnectionStatus,
  type McpClientListItem,
  mcpClientConfigPath,
  mcpClientConnect,
  mcpClientDisconnect,
  mcpClientList,
  mcpClientReload,
} from "./api";

function formatBackendError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function statusBadge(s: ConnectionStatus, t: (k: string) => string): string {
  switch (s.kind) {
    case "disconnected":
      return t("settings.mcp.external.statusDisconnected");
    case "connecting":
      return t("settings.mcp.external.statusConnecting");
    case "connected":
      return t("settings.mcp.external.statusConnected");
    case "error":
      return t("settings.mcp.external.statusError");
  }
}

export function ExternalServers(): JSX.Element {
  const { t } = useTranslation();
  const toast = useToast();
  const [items, setItems] = useState<McpClientListItem[]>([]);
  const [configPath, setConfigPath] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [list, path] = await Promise.all([mcpClientList(), mcpClientConfigPath()]);
      setItems(list);
      setConfigPath(path);
    } catch (err) {
      toast.error(formatBackendError(err));
    }
  }, [toast]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [list, path] = await Promise.all([mcpClientList(), mcpClientConfigPath()]);
        if (!cancelled) {
          setItems(list);
          setConfigPath(path);
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
    // toast is stable
    // biome-ignore lint/correctness/useExhaustiveDependencies: stable
  }, []);

  const onConnect = async (name: string) => {
    setBusy(name);
    try {
      await mcpClientConnect(name);
      await refresh();
    } catch (err) {
      toast.error(formatBackendError(err));
    } finally {
      setBusy(null);
    }
  };

  const onDisconnect = async (name: string) => {
    setBusy(name);
    try {
      await mcpClientDisconnect(name);
      await refresh();
    } catch (err) {
      toast.error(formatBackendError(err));
    } finally {
      setBusy(null);
    }
  };

  const onReload = async () => {
    try {
      await mcpClientReload();
      await refresh();
      toast.success(t("settings.mcp.external.reloaded"));
    } catch (err) {
      toast.error(formatBackendError(err));
    }
  };

  if (loading) {
    return <div className="mcp-loading">{t("settings.mcp.external.loading")}</div>;
  }

  return (
    <div className="mcp-external">
      <header className="mcp-external-header">
        <h3>{t("settings.mcp.external.title")}</h3>
        <p className="mcp-description">{t("settings.mcp.external.description")}</p>
      </header>

      <div className="mcp-external-toolbar">
        <button
          type="button"
          className="btn btn-sm"
          onClick={onReload}
          data-testid="mcp-external-reload"
        >
          {t("settings.mcp.external.reload")}
        </button>
        {configPath ? (
          <span className="mcp-external-config-path" title={configPath}>
            {t("settings.mcp.external.configPath", { path: configPath })}
          </span>
        ) : null}
      </div>

      {items.length === 0 ? (
        <p className="mcp-empty">{t("settings.mcp.external.empty")}</p>
      ) : (
        <ul className="mcp-external-list">
          {items.map((item) => {
            const { config, status } = item;
            const connected = status.kind === "connected";
            const busyHere = busy === config.name;
            return (
              <li key={config.name} className="mcp-external-row">
                <div className="mcp-external-name">
                  <strong>{config.name}</strong>
                  <span className="mcp-external-transport">{config.transport}</span>
                </div>
                <div className="mcp-external-target">{config.displayTarget}</div>
                <div className="mcp-external-status" data-status={status.kind}>
                  {statusBadge(status, t)}
                  {status.kind === "connected" ? (
                    <span className="mcp-external-counts">
                      {t("settings.mcp.external.toolsCount", {
                        count: status.tools.length,
                      })}
                      {" · "}
                      {t("settings.mcp.external.resourcesCount", {
                        count: status.resources.length,
                      })}
                    </span>
                  ) : null}
                  {status.kind === "error" ? (
                    <span className="mcp-external-error" title={status.message}>
                      {status.message}
                    </span>
                  ) : null}
                </div>
                <div className="mcp-external-actions">
                  {connected ? (
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={busyHere}
                      onClick={() => onDisconnect(config.name)}
                      data-testid={`mcp-external-disconnect-${config.name}`}
                    >
                      {t("settings.mcp.external.disconnect")}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      disabled={busyHere || status.kind === "connecting"}
                      onClick={() => onConnect(config.name)}
                      data-testid={`mcp-external-connect-${config.name}`}
                    >
                      {t("settings.mcp.external.connect")}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
