import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import type {
  LiveOpsPublicationRow,
  LiveOpsSlotRow,
  LiveOpsSubscriptionRow,
  ReplicationOverview,
} from "../../../lib/tauri";
import { prettyBytes } from "../../health/cards/DbSizeCard";
import { CardStateRouter } from "../CardStateRouter";
import { useLiveOps } from "../store";

interface Props {
  connId: string;
}

type Tone = "ok" | "warn" | "danger";

function pluralRu(count: number, key: (suffix: "one" | "few" | "many") => string): string {
  const n10 = count % 10;
  const n100 = count % 100;
  if (n100 >= 11 && n100 <= 14) return key("many");
  if (n10 === 1) return key("one");
  if (n10 >= 2 && n10 <= 4) return key("few");
  return key("many");
}

function tone(s: LiveOpsSlotRow): Tone {
  if (s.lagBytes !== null && s.lagBytes > 5_000_000_000) return "danger";
  if (s.lagSeconds !== null && s.lagSeconds > 30) return "danger";
  if (s.lagBytes !== null && s.lagBytes > 1_000_000_000) return "warn";
  if (s.lagSeconds !== null && s.lagSeconds > 10) return "warn";
  if (!s.active) return "warn";
  return "ok";
}

export function ReplicationPane({ connId }: Props): JSX.Element | null {
  const { t } = useTranslation();
  const slice = useLiveOps((s) => s.byConn.get(connId));
  if (!slice) return null;
  const { showEmpty, data } = slice.replication;

  return (    <div className="live-ops-replication-pane" data-testid="live-ops-replication-pane">
      <div className="live-ops-toolbar">
        <ReplicationSummaryChip data={data} />
      </div>

      <div className="live-ops-replication-scroll">
        <CardStateRouter
          state={data}
          renderReady={(d) => {
            const slotsHas = d.slots.length > 0;
            const pubsHas = d.publications.length > 0;
            const subsHas = d.subscriptions.length > 0;
            const hidden = [slotsHas, pubsHas, subsHas].filter((x) => !x).length;
            if (hidden === 3 && !showEmpty) {
              return (                <div className="live-ops-shimmer" data-testid="live-ops-no-replication">
                  {t("live_ops.replication.no_replication")}
                </div>
);
            }
            return (              <div className="live-ops-replication">
                {(slotsHas || showEmpty) && <SlotsSection slots={d.slots} connId={connId} />}
                <div className="live-ops-replication-grid">
                  {(pubsHas || showEmpty) && <PublicationsSection pubs={d.publications} />}
                  {(subsHas || showEmpty) && <SubscriptionsSection subs={d.subscriptions} />}
                </div>
                {hidden > 0 && !showEmpty && (                  <button
                    type="button"
                    className="link"
                    onClick={() => useLiveOps.getState().setShowEmpty(connId, true)}
                    data-testid="live-ops-show-empty"
                  >
                    + {t("live_ops.replication.show_empty", { count: hidden })}
                  </button>
)}
              </div>
);
          }}
        />
      </div>
    </div>
);
}

interface SlotsProps {
  slots: readonly LiveOpsSlotRow[];
  connId: string;
}
function SlotsSection({ slots, connId }: SlotsProps): JSX.Element {
  void connId;
  const { t } = useTranslation();
  return (    <section className="live-ops-section" data-testid="live-ops-slots">
      <header className="section-eyebrow">
        {t("live_ops.replication.slots", { count: slots.length })}
      </header>
      <div className="slot-list">
        {slots.map((s) => (          <SlotCard key={s.slotName} slot={s} />
))}
      </div>
    </section>
);
}

interface SlotCardProps {
  slot: LiveOpsSlotRow;
}
function SlotCard({ slot }: SlotCardProps): JSX.Element {
  const { t } = useTranslation();
  const tn = tone(slot);
  const lagSecondsLabel =
    slot.lagSeconds !== null
      ? t("live_ops.replication.lag_seconds", {
          seconds: slot.lagSeconds.toFixed(1),
        })
      : null;
  const lagBytesLabel = slot.lagBytes !== null ? prettyBytes(slot.lagBytes) : null;
  const stateLabel = slot.state ?? (slot.active ? "active" : t("live_ops.replication.inactive"));
  const showDrop = tn === "danger";
  const fillWidth =
    slot.retentionPctOfMax !== null
      ? `${Math.min(100, slot.retentionPctOfMax * 100).toFixed(0)}%`
      : "0%";
  return (    <article
      className={`live-ops-slot live-ops-slot-card tone-${tn}`}
      data-testid={`live-ops-slot-${slot.slotName}`}
    >
      <header className="card-row card-head">
        <div className="head-left">
          <strong className="slot-name mono">{slot.slotName}</strong>
          <span className="slot-tag">{slot.slotType}</span>
          {lagSecondsLabel && <span className={`lag-chip tone-${tn}`}>{lagSecondsLabel}</span>}
        </div>
        <div className="head-right">
          <span className="state-pill">{stateLabel}</span>
          {showDrop && (            <button type="button" className="btn-ghost-sm danger drop-btn" disabled>
              {t("live_ops.replication.drop_slot")}
            </button>
)}
        </div>
      </header>
      <div className={`progress tone-${tn}`}>
        <div className="fill" style={{ width: fillWidth }} />
      </div>
      <footer className="card-row card-foot">
        <span className="foot-left mono">lag {lagBytesLabel ?? "—"}</span>
        {slot.walStatus && (          <span className="foot-right mono">
            {t("live_ops.replication.last_msg_label")} {slot.walStatus}
          </span>
)}
      </footer>
    </article>
);
}

interface PubsProps {
  pubs: readonly LiveOpsPublicationRow[];
}
function PublicationsSection({ pubs }: PubsProps): JSX.Element {
  const { t } = useTranslation();
  return (    <section className="live-ops-section" data-testid="live-ops-pubs">
      <header className="section-eyebrow">
        {t("live_ops.replication.publications", { count: pubs.length })}
      </header>
      <div className="card-list">
        {pubs.map((p) => {
          const tagLabel = pluralRu(p.tableCount, (s) =>
            t(`live_ops.replication.tables_count_${s}`, { count: p.tableCount }),
);
          const flags = [
            p.pubinsert ? "I" : "·",
            p.pubupdate ? "U" : "·",
            p.pubdelete ? "D" : "·",
            p.pubtruncate ? "T" : "·",
          ].join(" ");
          return (            <article key={p.pubname} className="live-ops-mini-card">
              <header className="card-row card-head">
                <strong className="mono">{p.pubname}</strong>
                <span className="slot-tag">{tagLabel}</span>
                {p.puballtables && <span className="slot-tag">all tables</span>}
              </header>
              <div className="card-row meta">
                <span className="muted">{t("live_ops.replication.tables_list_label")}</span>
                <span className="mono">{flags}</span>
              </div>
            </article>
);
        })}
      </div>
    </section>
);
}

interface SubsProps {
  subs: readonly LiveOpsSubscriptionRow[];
}
function SubscriptionsSection({ subs }: SubsProps): JSX.Element {
  const { t } = useTranslation();
  return (    <section className="live-ops-section" data-testid="live-ops-subs">
      <header className="section-eyebrow">
        {t("live_ops.replication.subscriptions", { count: subs.length })}
      </header>
      <div className="card-list">
        {subs.map((s) => {
          const stateLabel = s.subenabled ? "streaming" : t("live_ops.replication.inactive");
          const stateTone = s.subenabled ? "ok" : "warn";
          return (            <article key={s.subname} className="live-ops-mini-card">
              <header className="card-row card-head">
                <strong className="mono">{s.subname}</strong>
                <span className={`slot-tag tone-${stateTone}`}>{stateLabel}</span>
              </header>
              <div className="card-row meta">
                <span className="mono conninfo" title={s.subconninfoRedacted}>
                  {s.subconninfoRedacted}
                </span>
              </div>
              {s.publications.length > 0 && (                <div className="card-row meta">
                  <span className="muted">{t("live_ops.replication.publications_label")}</span>
                  <span className="mono">{s.publications.join(", ")}</span>
                </div>
)}
              {s.stat?.lastMsgSendTime && (                <div className="card-row meta">
                  <span className="muted">{t("live_ops.replication.last_msg_label")}</span>
                  <span className="mono">{s.stat.lastMsgSendTime}</span>
                </div>
)}
            </article>
);
        })}
      </div>
    </section>
);
}

interface SummaryProps {
  data: { status: "ready"; data: ReplicationOverview; fetchedAt: number } | { status: string };
}
function ReplicationSummaryChip({ data }: SummaryProps): JSX.Element | null {
  const { t } = useTranslation();
  if (data.status !== "ready") return null;
  const ready = data as { status: "ready"; data: ReplicationOverview; fetchedAt: number };
  const slots = ready.data.slots;
  if (slots.length === 0) return null;
  const criticals = slots.filter((s) => tone(s) === "danger").length;
  const warns = slots.filter((s) => tone(s) === "warn").length;
  const slotLabel = pluralRu(slots.length, (s) =>
    t(`live_ops.replication.summary.slots_${s}`, { count: slots.length }),
);
  const tail =
    criticals > 0
      ? ` · ${t("live_ops.replication.summary.critical", { count: criticals })}`
      : warns > 0
        ? ` · ${t("live_ops.replication.summary.warn", { count: warns })}`
        : "";
  return (    <span
      className={`live-ops-summary-chip${criticals > 0 ? " has-blocked" : ""}`}
      data-testid="live-ops-replication-summary"
    >
      {slotLabel}
      {criticals > 0 ? <span className="chip-danger">{tail}</span> : tail}
    </span>
);
}
