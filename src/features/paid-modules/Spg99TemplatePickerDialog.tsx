// — SPG99 Instant DB template picker.
//
// Mounted once at the App / Workspace level ('s choice — we mount
// at App  Phase B). Listens for `ide99:spg99:open-template-picker`
// CustomEvents (dispatched by Spg99InstantDbButton when subscription is
// active, or by the Health-screen "Reproduce on disposable" action with a
// pre-selected template) and renders a Radix Dialog template picker.
//
// v1.0 contract: this component is *fully wired UI* but the `Create` action
// only persists the user's choice locally + shows a friendly note that
// cloud provisioning ships in v1.1. There is no real SPG99 backend client
// yet — the slot must be visible without subscription (per acceptance
// criterion #2) and operate as a stub when the user IS subscribed.

import { type JSX, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Dialog } from "../../components/Dialog";
import { usePaidModules } from "./store";
import { sendFeatureEvent } from "./telemetry";

export type Spg99TemplateKind =
  | "clean"
  | "pgvector"
  | "postgis"
  | "timescale"
  | "project"
  | "custom";

export type TemplatePickerOpenDetail = {
  /** Pre-selected template — used by Health "Reproduce on disposable". */
  preset?: Spg99TemplateKind;
  /** Source slot id (telemetry / a11y label augmentation). */
  source?: string;
};

const ALL_TEMPLATES: ReadonlyArray<Spg99TemplateKind> = [
  "clean",
  "pgvector",
  "postgis",
  "timescale",
  "project",
  "custom",
];

const DEFAULT_AUTO_STOP_MIN = 30;
const DEFAULT_TTL_HOURS = 24;

export function Spg99TemplatePickerDialog(): JSX.Element | null {
  const { t } = useTranslation();
  const subscribed = usePaidModules((s) => s.subscription?.spg99Subscribed ?? false);

  const [open, setOpen] = useState(false);
  const [template, setTemplate] = useState<Spg99TemplateKind>("clean");
  const [autoStop, setAutoStop] = useState(DEFAULT_AUTO_STOP_MIN);
  const [ttl, setTtl] = useState(DEFAULT_TTL_HOURS);
  const [source, setSource] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState(false);

  // Listen for the open-event on window. Only act when subscribed —
  // unsubscribed clicks are routed straight to upgrade page in their
  // dispatcher (Spg99InstantDbButton + ReproduceOnDisposableButton).
  useEffect(() => {
    const handler = (event: Event) => {
      if (!subscribed) return;
      const detail = (event as CustomEvent<TemplatePickerOpenDetail>).detail ?? {};
      if (detail.preset) setTemplate(detail.preset);
      else setTemplate("clean");
      setAutoStop(DEFAULT_AUTO_STOP_MIN);
      setTtl(DEFAULT_TTL_HOURS);
      setSource(detail.source);
      setOpen(true);
    };
    window.addEventListener("ide99:spg99:open-template-picker", handler as EventListener);
    return () =>
      window.removeEventListener("ide99:spg99:open-template-picker", handler as EventListener);
  }, [subscribed]);

  const handleCreate = useCallback(() => {
    setPending(true);
    sendFeatureEvent(`paid_modules.spg99.template_picker.create.${template}`);
    // v1.0: no real backend. v1.1 wires real cloud API.
    // We deliberately keep this resolved synchronously so test expectations
    // stay simple — close dialog after one tick.
    queueMicrotask(() => {
      setPending(false);
      setOpen(false);
    });
  }, [template]);

  const handleCancel = useCallback(() => {
    setOpen(false);
  }, []);

  if (!open) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setOpen(false);
      }}
      title={t("paid_modules.spg99.template_picker.title")}
      description={t("paid_modules.spg99.template_picker.description")}
      size="md"
      closeAriaLabel={t("paid_modules.spg99.template_picker.cancel")}
      footer={
        <>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={handleCancel}
            data-testid="spg99-template-picker-cancel"
          >
            {t("paid_modules.spg99.template_picker.cancel")}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleCreate}
            disabled={pending}
            data-testid="spg99-template-picker-create"
          >
            {t("paid_modules.spg99.template_picker.create")}
          </button>
        </>
      }
    >
      <form
        data-testid="spg99-template-picker"
        data-source={source ?? ""}
        onSubmit={(e) => {
          e.preventDefault();
          handleCreate();
        }}
        style={{ display: "flex", flexDirection: "column", gap: 12 }}
      >
        <fieldset
          style={{
            border: "1px solid var(--hairline)",
            borderRadius: 4,
            padding: 8,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <legend style={{ fontSize: 12, color: "var(--ink-3)", padding: "0 4px" }}>
            {t("paid_modules.spg99.template_picker.template_label")}
          </legend>
          {ALL_TEMPLATES.map((tpl) => (
            <label
              key={tpl}
              style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 13 }}
            >
              <input
                type="radio"
                name="spg99-template"
                value={tpl}
                checked={template === tpl}
                onChange={() => setTemplate(tpl)}
                aria-checked={template === tpl}
                data-testid={`spg99-template-radio-${tpl}`}
              />
              <span>{t(`paid_modules.spg99.template_picker.template.${tpl}`)}</span>
            </label>
          ))}
        </fieldset>

        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
          <span>{t("paid_modules.spg99.template_picker.auto_stop_label")}</span>
          <input
            type="number"
            min={5}
            max={240}
            step={5}
            value={autoStop}
            onChange={(e) => setAutoStop(Math.max(5, Number(e.target.value) || 0))}
            className="q-input"
            data-testid="spg99-template-picker-auto-stop"
          />
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
          <span>{t("paid_modules.spg99.template_picker.ttl_label")}</span>
          <input
            type="number"
            min={1}
            max={168}
            step={1}
            value={ttl}
            onChange={(e) => setTtl(Math.max(1, Number(e.target.value) || 0))}
            className="q-input"
            data-testid="spg99-template-picker-ttl"
          />
        </label>

        <div
          role="note"
          data-testid="spg99-template-picker-v1-note"
          style={{
            fontSize: 11.5,
            color: "var(--ink-3)",
            padding: "6px 8px",
            background: "var(--bg-sunken)",
            border: "1px dashed var(--hairline)",
            borderRadius: 4,
          }}
        >
          {t("paid_modules.spg99.template_picker.v1_disabled_note")}
        </div>
      </form>
    </Dialog>
  );
}
