import { formatDistanceToNow } from "date-fns";
import { enUS, ru } from "date-fns/locale";
import { CheckCircle2, Circle, Loader2, XCircle } from "lucide-react";
import { type JSX, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * Map the active i18n language to a date-fns locale object so relative time
 * (e.g. "3 minutes ago" / "3 минуты назад") follows the UI language. Without
 * this `formatDistanceToNow` defaults to English even in Russian UI, causing
 * mixed-language strings like "Успешно · 3 minutes ago".
 */
function dateLocaleFor(lng: string) {
  return lng.toLowerCase().startsWith("ru") ? ru : enUS;
}
import { useToast } from "../../components/Toast";
import { localizeConnectionError } from "../../lib/errors";
import { connectionSetExcludeFromRecentPlans, deleteConnection } from "../../lib/tauri";
import { useSchema } from "../schema/store";
import { TestButton } from "./TestButton";
import { useConnections } from "./store";

/**
 * Read-only details card for the currently selected connection (spec §5.4).
 *
 * Shows host/port/database/user/sslmode plus the last-test timestamp
 * (relative via date-fns) and a status icon. Buttons:
 * - <TestButton variant="saved" /> reuses stored credentials.
 * - Edit opens the form in edit mode.
 * - Delete opens a confirm-by-typing dialog (mirrors ConnectionList).
 */
export function ConnectionDetails(): JSX.Element {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const selectedId = useConnections((s) => s.selectedId);
  const connections = useConnections((s) => s.connections);
  const openEditForm = useConnections((s) => s.openEditForm);
  const removeLocal = useConnections((s) => s.removeLocal);
  const upsertLocal = useConnections((s) => s.upsertLocal);
  const schemaConnection = useSchema((s) => s.connection);
  const schemaConnect = useSchema((s) => s.connect);
  const schemaDisconnect = useSchema((s) => s.disconnect);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmTyped, setConfirmTyped] = useState("");

  const conn = selectedId ? connections.find((c) => c.id === selectedId) : undefined;

  const onConfirmDelete = useCallback(async () => {
    if (!conn) return;
    try {
      // Drop schema state first if it's bound to this id — see same guard in
      // ConnectionList. Keeps the banner / object tabs from referencing a
      // ghost connection.
      const schemaState = useSchema.getState();
      const schemaTouchesId =
        schemaState.connection.status !== "idle" && schemaState.connection.connId === conn.id;
      if (schemaTouchesId) {
        await schemaState.disconnect();
      }
      await deleteConnection(conn.id);
      removeLocal(conn.id);
      toast.success(t("toast.connection.deleted"));
      setConfirmOpen(false);
      setConfirmTyped("");
    } catch (err) {
      toast.error(localizeConnectionError(err, t));
    }
  }, [conn, removeLocal, toast, t]);

  if (!conn) {
    return (
      <div
        style={{
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 32,
        }}
      >
        <p style={{ fontSize: 13, color: "var(--ink-4)" }}>
          {t("connection.details.no_selection")}
        </p>
      </div>
    );
  }

  const lastTestLabel = (() => {
    if (conn.lastTestedAt === null) {
      return t("connection.details.last_test.never");
    }
    if (conn.lastTestOk) {
      return t("connection.details.last_test.ok");
    }
    return t("connection.details.last_test.failed");
  })();

  const lastTestRelative = conn.lastTestedAt
    ? formatDistanceToNow(new Date(conn.lastTestedAt), {
        addSuffix: true,
        locale: dateLocaleFor(i18n.language),
      })
    : null;

  const StatusIcon = conn.lastTestedAt === null ? Circle : conn.lastTestOk ? CheckCircle2 : XCircle;
  const statusColor =
    conn.lastTestedAt === null
      ? "var(--ink-5)"
      : conn.lastTestOk
        ? "var(--accent)"
        : "var(--danger-q)";

  return (
    <article style={{ padding: "32px 40px", maxWidth: 720, margin: "0 auto" }}>
      <p className="q-eyebrow" style={{ marginBottom: 6 }}>
        {t("connection.details.host", "Подключение")}
      </p>
      <h2
        style={{
          fontSize: 24,
          fontWeight: 500,
          letterSpacing: "-0.02em",
          color: "var(--ink)",
          margin: 0,
        }}
      >
        {conn.name}
      </h2>
      <p
        className="mono"
        style={{
          marginTop: 6,
          fontSize: 12.5,
          color: "var(--ink-3)",
        }}
      >
        postgresql://{conn.username}@{conn.host}:{conn.port}/{conn.database}
      </p>

      <table className="q-kv" style={{ marginTop: 24 }}>
        <tbody>
          <tr>
            <td className="k">{t("connection.details.host")}</td>
            <td className="v">{conn.host}</td>
          </tr>
          <tr>
            <td className="k">{t("connection.details.port")}</td>
            <td className="v">{conn.port}</td>
          </tr>
          <tr>
            <td className="k">{t("connection.details.database")}</td>
            <td className="v">{conn.database}</td>
          </tr>
          <tr>
            <td className="k">{t("connection.details.username")}</td>
            <td className="v">{conn.username}</td>
          </tr>
          <tr>
            <td className="k">{t("connection.details.ssl_mode")}</td>
            <td className="v">{conn.sslMode}</td>
          </tr>
          <tr>
            <td className="k">{t("connection.details.last_test_label")}</td>
            <td className="v sans">
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <StatusIcon size={13} style={{ color: statusColor }} aria-hidden="true" />
                <span>{lastTestLabel}</span>
                {lastTestRelative ? (
                  <span
                    style={{ color: "var(--ink-4)", marginLeft: 8 }}
                    data-testid="last-test-relative"
                  >
                    {lastTestRelative}
                  </span>
                ) : null}
              </span>
            </td>
          </tr>
        </tbody>
      </table>

      <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 4 }}>
        <label className="q-checkbox" data-testid="details-save-recent-plans-label">
          {/*
           * Inverted semantics — the label reads "Save EXPLAIN plans"
           * (affirmative), so checked = true means save (excludeFromRecentPlans
           * = false). Mirrors the history-exclude flag end-to-end via
           * connectionSetExcludeFromRecentPlans + an optimistic upsertLocal.
           */}
          <input
            type="checkbox"
            data-testid="details-save-recent-plans-checkbox"
            aria-label={t("connection.form.exclude_from_recent_plans.label")}
            checked={!conn.excludeFromRecentPlans}
            onChange={(e) => {
              const exclude = !e.currentTarget.checked;
              upsertLocal({ ...conn, excludeFromRecentPlans: exclude });
              void connectionSetExcludeFromRecentPlans(conn.id, exclude).catch((err) => {
                // Roll back the optimistic flip if IPC fails.
                upsertLocal({ ...conn, excludeFromRecentPlans: !exclude });
                toast.error(localizeConnectionError(err, t));
              });
            }}
          />
          {t("connection.form.exclude_from_recent_plans.label")}
        </label>
        <p style={{ paddingLeft: 24, fontSize: 11, color: "var(--ink-4)", margin: 0 }}>
          {t("connection.form.exclude_from_recent_plans.help")}
        </p>
      </div>

      <div style={{ marginTop: 28, display: "flex", flexWrap: "wrap", gap: 8 }}>
        <TestButton
          variant="saved"
          connectionId={conn.id}
          onResult={(result) => {
            // Backend writes last_tested_at/last_test_ok to SQLite inside
            // test_saved_connection, but our Zustand mirror is stale until
            // the next list refresh — so the "Last test: Never tested"
            // chip contradicted the visible "Connection successful" badge.
            // Patch optimistically; SQLite is the source of truth on next
            // hydrate.
            upsertLocal({
              ...conn,
              lastTestedAt: new Date().toISOString(),
              lastTestOk: result.ok,
            });
          }}
        />
        <ConnectButton
          connectionId={conn.id}
          schemaConnection={schemaConnection}
          onConnect={() => {
            void (async () => {
              await schemaConnect(conn.id);
              const next = useSchema.getState().connection;
              if (next.status === "error" && next.connId === conn.id) {
                const msg = next.message
                  ? localizeConnectionError(new Error(next.message), t)
                  : t("connection.details.connect_failed", "Не удалось подключиться");
                toast.error(msg);
              }
            })();
          }}
          onDisconnect={() => void schemaDisconnect()}
        />
        <button type="button" onClick={() => openEditForm(conn.id)} className="btn">
          {t("connection.details.edit")}
        </button>
        <button
          type="button"
          onClick={() => {
            setConfirmOpen(true);
            setConfirmTyped("");
          }}
          className="btn btn-danger"
        >
          {t("connection.details.delete")}
        </button>
      </div>

      {confirmOpen ? ( // biome-ignore lint/a11y/useSemanticElements: <dialog> element lacks the styling/positioning hooks we need; aria role is sufficient
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="details-delete-title"
          style={{ position: "fixed", inset: 0, zIndex: 90 }}
        >
          <div className="q-backdrop" />
          <div className="q-modal sm" style={{ padding: 24 }}>
            <h3 id="details-delete-title" className="q-modal-title" style={{ userSelect: "text" }}>
              {t("connection.delete.confirm.title")}
            </h3>
            <p
              style={{
                marginTop: 8,
                fontSize: 12.5,
                color: "var(--ink-3)",
                userSelect: "text",
              }}
            >
              {t("connection.delete.confirm.body")}
            </p>
            <div className="q-field" style={{ marginTop: 14 }}>
              <label htmlFor="connection-delete-name-readonly">
                {t("connection.delete.confirm.name_label")}
              </label>
              <input
                id="connection-delete-name-readonly"
                type="text"
                readOnly
                value={conn.name}
                onFocus={(e) => e.currentTarget.select()}
                className="q-input mono"
                style={{ background: "var(--bg-sunken)" }}
              />
            </div>
            <div className="q-field" style={{ marginTop: 10 }}>
              <label htmlFor="connection-delete-confirm-input">
                {t("connection.delete.confirm.type_prompt")}
              </label>
              <input
                id="connection-delete-confirm-input"
                type="text"
                value={confirmTyped}
                onChange={(e) => setConfirmTyped(e.target.value)}
                // biome-ignore lint/a11y/noAutofocus: focus the type-prompt input on dialog open — the modal is the only thing on screen, so the autofocus does not surprise screen-reader users.
                autoFocus
                className="q-input mono"
              />
            </div>
            <div
              style={{
                marginTop: 18,
                display: "flex",
                justifyContent: "flex-end",
                gap: 8,
              }}
            >
              <button
                type="button"
                onClick={() => {
                  setConfirmOpen(false);
                  setConfirmTyped("");
                }}
                className="btn btn-ghost"
              >
                {t("connection.form.action.cancel")}
              </button>
              <button
                type="button"
                disabled={confirmTyped !== conn.name}
                onClick={() => void onConfirmDelete()}
                className="btn btn-danger"
              >
                {t("connection.details.delete")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </article>
  );
}

interface ConnectButtonProps {
  connectionId: string;
  schemaConnection: ReturnType<typeof useSchema.getState>["connection"];
  onConnect: () => void;
  onDisconnect: () => void;
}

/**
 * Per-connection Connect / Disconnect button (spec §7.6).
 *
 * - Shows "Disconnect" when this connection is the active one.
 * - Shows a disabled "Connecting…" state while a connect for this row is in
 * flight.
 * - Otherwise shows "Connect"; disabled if some other connection is currently
 * connecting (one active pool per window).
 */
function ConnectButton({
  connectionId,
  schemaConnection,
  onConnect,
  onDisconnect,
}: ConnectButtonProps): JSX.Element {
  const { t } = useTranslation();
  const isThisConnected =
    schemaConnection.status === "connected" && schemaConnection.connId === connectionId;
  const isThisConnecting =
    schemaConnection.status === "connecting" && schemaConnection.connId === connectionId;
  const isOtherInFlight =
    schemaConnection.status === "connecting" && schemaConnection.connId !== connectionId;

  if (isThisConnected) {
    const label = t("connection.action.disconnect");
    return (
      <button type="button" onClick={onDisconnect} aria-label={label} className="btn">
        {label}
      </button>
    );
  }

  if (isThisConnecting) {
    const label = t("connection.connecting");
    return (
      <button type="button" disabled aria-busy="true" aria-label={label} className="btn btn-accent">
        <Loader2 size={14} className="q-spin" aria-hidden="true" />
        <span>{label}</span>
      </button>
    );
  }

  const label = t("connection.action.connect");
  const disabledReason = isOtherInFlight ? t("connection.action.other_in_flight") : undefined;
  return (
    <button
      type="button"
      onClick={onConnect}
      disabled={isOtherInFlight}
      aria-label={label}
      title={disabledReason ?? label}
      className="btn btn-accent"
    >
      {label}
    </button>
  );
}
