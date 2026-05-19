import { Sparkles } from "lucide-react";
import { type JSX, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { useToast } from "../../components/Toast";
import { adminTelemetry } from "../../lib/adminTelemetry";
import { instantDbCreate } from "../../lib/instantDb";
import { useConnections } from "../connections/store";

/**
 * Instant DB launcher (free beta).
 *
 * Click flow: POST /v1/instant-db on the ide99 Instant Beta control service
 * via the Rust `instant_db_create` command → prefill the connection form with
 * the returned host/port/db/user/password → user saves it as a regular
 * connection. The "Free Beta" badge stays on until the wedge graduates to
 * paid serverless. No subscription gate: the gate was  paid-module
 * scaffolding; the IDE itself ships free.
 */
export function Spg99InstantDbButton(): JSX.Element {
  const { t } = useTranslation();
  const toast = useToast();
  const openCreateForm = useConnections((s) => s.openCreateForm);
  const [pending, setPending] = useState(false);

  const onClick = useCallback(async () => {
    if (pending) return;
    setPending(true);
    adminTelemetry.emit("ide.instant_db_clicked");
    const startedAt = performance.now();
    try {
      const created = await instantDbCreate();
      const latencyMs = Math.round(performance.now() - startedAt);
      adminTelemetry.emit("ide.instant_db_created", {
        db_id: created.dbId,
        latency_ms: latencyMs,
      });
      const name = t("paid_modules.spg99.connection_name_prefix", {
        defaultValue: "Instant DB",
      });
      openCreateForm({
        name: `${name} · ${created.dbId}`,
        host: created.host,
        port: created.port,
        database: created.database,
        username: created.username,
        sslMode: "disable",
        password: created.password,
        instantDbId: created.dbId,
      });
      toast.success(
        t("paid_modules.spg99.create_ok", {
          defaultValue: "Instant DB ready — review and save",
        }),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(
        t("paid_modules.spg99.create_error", {
          defaultValue: "Failed to create Instant DB: {{msg}}",
          msg,
        }),
      );
    } finally {
      setPending(false);
    }
  }, [openCreateForm, pending, t, toast]);

  return (
    <button
      type="button"
      onClick={() => void onClick()}
      disabled={pending}
      data-testid="spg99-instant-db-button"
      data-state={pending ? "pending" : "ready"}
      aria-busy={pending}
      aria-label={t("paid_modules.spg99.cta", { defaultValue: "Spin up Instant DB" })}
      style={{
        display: "inline-flex",
        gap: 6,
        alignItems: "center",
        padding: "4px 10px",
        border: "1px solid var(--accent, #6366f1)",
        borderRadius: 4,
        background: "var(--accent, #6366f1)",
        color: "var(--bg, white)",
        fontSize: 12,
        fontWeight: 600,
        opacity: pending ? 0.7 : 1,
        cursor: pending ? "progress" : "pointer",
      }}
    >
      <Sparkles size={12} aria-hidden="true" />
      <span>
        {pending
          ? t("paid_modules.spg99.cta_pending", { defaultValue: "Creating…" })
          : t("paid_modules.spg99.cta", { defaultValue: "Instant DB" })}
      </span>
      <span
        aria-label={t("paid_modules.spg99.free_beta_badge", { defaultValue: "Free Beta" })}
        style={{
          marginLeft: 4,
          padding: "1px 6px",
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: 0.3,
          textTransform: "uppercase",
          background: "rgba(255,255,255,0.18)",
          border: "1px solid rgba(255,255,255,0.35)",
          borderRadius: 3,
        }}
      >
        {t("paid_modules.spg99.free_beta_badge", { defaultValue: "Free Beta" })}
      </span>
    </button>
  );
}
