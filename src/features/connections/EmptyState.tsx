import { Plus } from "lucide-react";
import { type JSX, type KeyboardEvent, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "../../components/Toast";
import { parseConnectionUri } from "../../lib/parseConnectionUri";
import type { ParsedUri } from "../../lib/tauri";
import { CoachMark } from "../coach-marks";
import { Spg99InstantDbButton } from "../paid-modules/Spg99InstantDbButton";
import { useAppSettings } from "../privacy/store";
import { useConnections } from "./store";

const DEFAULT_PG_PORT = 5432;

function deriveConnectionName(parsed: ParsedUri): string {
  const hostPart = parsed.port === DEFAULT_PG_PORT ? parsed.host : `${parsed.host}:${parsed.port}`;
  return `${parsed.username}@${hostPart}/${parsed.database}`;
}

/**
 * Welcome-screen empty state (handoff/screens.md §01a).
 *
 * [ + Новое подключение ]              ← btn-primary, h:38, radius:10
 *
 * или вставьте строку подключения      ← hint, ink-4
 * ┌──────────────────────────────────┐
 * │ postgresql://user:pass@host/db   │ ← .input.mono w:460 h:36 centered
 * └──────────────────────────────────┘
 */
export function EmptyState(): JSX.Element {
  const { t } = useTranslation();
  const toast = useToast();
  const openCreateForm = useConnections((s) => s.openCreateForm);
  const [uri, setUri] = useState("");
  // only show the coach mark after the user has cleared the
  // privacy + onboarding dialogs. While either is open, an inline
  // "ничего страшного, давайте подключимся" hint behind the modal
  // creates a confusing two-source onboarding state.
  const settings = useAppSettings((s) => s.settings);
  const showCoachMark =
    !!settings && settings.privacyChoiceMade === true && settings.onboardingCompleted === true;

  const handleAdd = useCallback(() => {
    openCreateForm();
  }, [openCreateForm]);

  const handleParse = useCallback(async () => {
    const trimmed = uri.trim();
    if (!trimmed) return;
    try {
      const parsed = await parseConnectionUri(trimmed);
      openCreateForm({
        name: deriveConnectionName(parsed),
        host: parsed.host,
        port: parsed.port,
        database: parsed.database,
        username: parsed.username,
        sslMode: parsed.sslMode,
        ...(parsed.password ? { password: parsed.password } : {}),
      });
    } catch {
      toast.error(t("toast.connection.uri_invalid"));
    }
  }, [uri, openCreateForm, toast, t]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void handleParse();
      }
    },
    [handleParse],
  );

  const uriLabel = t("welcome.no_connections.uri_label");

  return (
    <section
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 0,
        width: "100%",
      }}
    >
      <div style={{ height: 14 }} />
      <button
        type="button"
        onClick={handleAdd}
        className="btn btn-primary btn-cta"
        data-testid="empty-state-add"
      >
        <Plus size={14} aria-hidden="true" />
        {t("welcome.no_connections.add")}
      </button>

      <div style={{ height: 28 }} />

      <p
        style={{
          fontSize: 12,
          color: "var(--ink-4)",
          margin: 0,
          fontFamily: "var(--font-sans-q)",
        }}
      >
        {uriLabel}
      </p>
      <input
        type="text"
        value={uri}
        onChange={(e) => setUri(e.target.value)}
        onBlur={() => void handleParse()}
        onKeyDown={handleKeyDown}
        placeholder={t("welcome.no_connections.uri_placeholder")}
        aria-label={uriLabel}
        className="q-input mono"
        style={{
          marginTop: 8,
          width: 460,
          maxWidth: "100%",
          height: 36,
          textAlign: "center",
        }}
      />

      {/* Instant DB CTA — replaces the retired local sample-db loader. */}
      <div style={{ height: 22 }} />
      <p
        style={{
          fontSize: 12,
          color: "var(--ink-4)",
          margin: 0,
          fontFamily: "var(--font-sans-q)",
        }}
      >
        {t("welcome.no_connections.instant_db_label", {
          defaultValue: "or spin up a temporary test DB in seconds",
        })}
      </p>
      <div style={{ marginTop: 8 }} data-testid="empty-state-instant-db">
        <Spg99InstantDbButton />
      </div>

      {showCoachMark ? (
        <div style={{ width: 460, maxWidth: "100%" }}>
          <CoachMark
            id="empty-connections-help"
            title={t("coach.empty_connections.title")}
            body={t("coach.empty_connections.body")}
            dismissLabel={t("coach.dismiss")}
          />
        </div>
      ) : null}
    </section>
  );
}
