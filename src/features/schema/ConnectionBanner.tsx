import { LogOut, Pencil } from "lucide-react";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { useConnections } from "../connections/store";
import { useSchema } from "./store";

/**
 * Quiet top strip above the main area while a connection is active.
 *
 * ● <name>  /  <database>                           [Edit] [Disconnect]
 *
 * 36px tall, hairline border-bottom, no background (mesh shows through).
 */
export function ConnectionBanner(): JSX.Element | null {
  const { t } = useTranslation();
  const connection = useSchema((s) => s.connection);
  const disconnect = useSchema((s) => s.disconnect);
  const connections = useConnections((s) => s.connections);
  const openEditForm = useConnections((s) => s.openEditForm);

  if (connection.status !== "connected") {
    return null;
  }

  const conn = connections.find((c) => c.id === connection.connId);
  const name = conn?.name ?? connection.connId;

  return (    // biome-ignore lint/a11y/useSemanticElements: passive status strip, not a form-result <output>
    <div
      role="status"
      aria-live="polite"
      style={{
        height: 36,
        flex: "0 0 36px",
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "0 14px",
        borderBottom: "1px solid var(--hairline)",
      }}
      data-testid="connection-banner"
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: 50,
          background: "var(--accent)",
          boxShadow: "0 0 0 3px var(--accent-soft)",
          display: "inline-block",
        }}
        aria-hidden="true"
        data-testid="connection-banner-dot"
      />
      <span style={{ fontSize: 12.5, fontWeight: 500, color: "var(--ink)" }}>{name}</span>
      <span style={{ color: "var(--ink-5)" }}>/</span>
      <span
        style={{
          fontFamily: "var(--font-mono-q)",
          fontSize: 12,
          color: "var(--ink-3)",
        }}
      >
        {connection.database}
      </span>
      <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
        <button
          type="button"
          onClick={() => openEditForm(connection.connId)}
          aria-label={t("connection.banner.edit")}
          className="btn btn-sm btn-ghost"
        >
          <Pencil size={12} aria-hidden="true" />
          <span>{t("connection.banner.edit")}</span>
        </button>
        <button
          type="button"
          onClick={() => void disconnect()}
          aria-label={t("connection.banner.disconnect")}
          className="btn btn-sm btn-ghost"
        >
          <LogOut size={12} aria-hidden="true" />
          <span>{t("connection.banner.disconnect")}</span>
        </button>
      </div>
    </div>
);
}
