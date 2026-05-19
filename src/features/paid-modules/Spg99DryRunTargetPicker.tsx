// — Migration ApplyDialog "Dry-run target" radio group.
//
// md §5.2: when dry-run is enabled, the
// user picks SPG99 Instant DB (recommended) or Local Docker. v1.0 routes
// both to the same testcontainers backend; the selected_target is
// annotated on the dryrun event payload so downstream telemetry can split
// adoption metrics. Real SPG99 cloud routing is wired in v1.1.

import { type JSX, useEffect } from "react";
import { useTranslation } from "react-i18next";

import { usePaidModules } from "./store";
import { sendFeatureEvent } from "./telemetry";

export type DryRunTarget = "spg99" | "docker";

export function Spg99DryRunTargetPicker({
  value,
  onChange,
}: {
  value: DryRunTarget;
  onChange: (next: DryRunTarget) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const subscription = usePaidModules((s) => s.subscription);
  const hydrate = usePaidModules((s) => s.hydrate);

  useEffect(() => {
    if (!subscription) void hydrate();
  }, [subscription, hydrate]);

  const subscribed = subscription?.spg99Subscribed ?? false;
  const upgradeUrl = subscription?.upgradeUrlSpg99 ?? "https://spg99.ru/instant-db";

  const handleSelectSpg99 = () => {
    if (!subscribed) return;
    onChange("spg99");
  };

  const handleSelectDocker = () => {
    onChange("docker");
  };

  const handleUpgrade = () => {
    sendFeatureEvent("paid_modules.spg99.dry_run.upgrade_click");
    if (typeof window !== "undefined") {
      window.open(upgradeUrl, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <fieldset
      data-testid="spg99-dryrun-target-picker"
      style={{
        border: "1px solid var(--hairline)",
        borderRadius: 4,
        padding: 8,
        margin: 0,
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <legend style={{ fontSize: 11, color: "var(--ink-3)", padding: "0 4px" }}>
        {t("paid_modules.spg99.dry_run.target_legend")}
      </legend>

      <label
        style={{
          display: "inline-flex",
          gap: 6,
          alignItems: "center",
          fontSize: 12,
          color: subscribed ? "inherit" : "var(--ink-4)",
          cursor: subscribed ? "pointer" : "not-allowed",
        }}
        title={
          subscribed
            ? t("paid_modules.spg99.dry_run.target_spg99_hint")
            : t("paid_modules.spg99.dry_run.target_locked_tooltip")
        }
      >
        <input
          type="radio"
          name="dryrun-target"
          value="spg99"
          checked={value === "spg99" && subscribed}
          disabled={!subscribed}
          onChange={handleSelectSpg99}
          aria-checked={value === "spg99" && subscribed}
          data-testid="spg99-dryrun-target-spg99"
        />
        <span>{t("paid_modules.spg99.dry_run.target_spg99")}</span>
        {!subscribed ? (
          <button
            type="button"
            onClick={handleUpgrade}
            className="link"
            data-testid="spg99-dryrun-upgrade-link"
            style={{
              marginLeft: 6,
              background: "none",
              border: 0,
              color: "var(--accent, #6366f1)",
              fontSize: 11,
              cursor: "pointer",
              padding: 0,
              textDecoration: "underline",
            }}
          >
            {t("paid_modules.spg99.dry_run.upgrade_hint")}
          </button>
        ) : null}
      </label>

      <label
        style={{
          display: "inline-flex",
          gap: 6,
          alignItems: "center",
          fontSize: 12,
        }}
      >
        <input
          type="radio"
          name="dryrun-target"
          value="docker"
          checked={value === "docker" || !subscribed}
          onChange={handleSelectDocker}
          aria-checked={value === "docker" || !subscribed}
          data-testid="spg99-dryrun-target-docker"
        />
        <span>{t("paid_modules.spg99.dry_run.target_docker")}</span>
      </label>
    </fieldset>
  );
}
