/**
 * — HypoPgEstimate subcomponent.
 *
 * Renders the result of `jsonb_suggester_hypothetical_explain` —
 * a discriminated union with loading / computed / unavailable variants.
 * All copy comes from i18n keys under `jsonb.suggester.speedup*`.
 */

import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import type { HypoPgEstimate as HypoPgEstimateType } from "../../../lib/tauri";

export interface HypoPgEstimateProps {
  state: { kind: "loading" } | HypoPgEstimateType;
}

const SPINNER_STYLE: React.CSSProperties = {
  display: "inline-block",
  width: 12,
  height: 12,
  border: "2px solid var(--hairline)",
  borderTopColor: "var(--accent)",
  borderRadius: "50%",
  animation: "hypopg-spin 0.7s linear infinite",
  verticalAlign: "middle",
  marginRight: 6,
};

export function HypoPgEstimate({ state }: HypoPgEstimateProps): JSX.Element {
  const { t } = useTranslation();

  if (state.kind === "loading") {
    return (      <span data-testid="hypopg-loading">
        <style>{"@keyframes hypopg-spin { to { transform: rotate(360deg); } }"}</style>
        <span style={SPINNER_STYLE} aria-hidden="true" />
        {t("jsonb.suggester.speedupComputing")}
      </span>
);
  }

  if (state.kind === "computed") {
    const { baselineCost, hypotheticalCost, reductionPct } = state;
    const pctStr = reductionPct.toFixed(1);
    const isImprovement = reductionPct > 0;
    return (      <span data-testid="hypopg-computed">
        {t("jsonb.suggester.speedupComputed", {
          baseline: baselineCost.toFixed(2),
          hypothetical: hypotheticalCost.toFixed(2),
          pct: pctStr,
        })}{" "}
        <span
          data-testid="hypopg-pct"
          style={{
            color: isImprovement ? "var(--success-500, #22c55e)" : undefined,
            fontWeight: 600,
          }}
        >
          {pctStr}%
        </span>
      </span>
);
  }

  // state.kind === "unavailable"
  const { reason } = state;

  if (reason.kind === "extensionMissing") {
    return (      <span data-testid="hypopg-unavailable-extensionMissing">
        {t("jsonb.suggester.speedupUnavailable.hypopgMissing")}{" "}
        <code
          style={{
            display: "inline-block",
            padding: "2px 4px",
            background: "var(--bg-2)",
            borderRadius: 3,
            fontSize: 11,
            fontFamily: "var(--font-mono)",
          }}
          data-testid="hypopg-install-sql"
        >
          {t("jsonb.suggester.speedupUnavailable.hypopgInstallSql")}
        </code>
      </span>
);
  }

  if (reason.kind === "pgVersionTooOld") {
    return (      <span data-testid="hypopg-unavailable-pgTooOld">
        {t("jsonb.suggester.speedupUnavailable.pgTooOld", {
          actual: reason.actual,
        })}
      </span>
);
  }

  if (reason.kind === "noRepresentativeQuery") {
    return (      <span data-testid="hypopg-unavailable-noRepresentativeQuery">
        {t("jsonb.suggester.speedupUnavailable.noRepresentativeQuery")}
      </span>
);
  }

  // reason.kind === "plannerError"
  return (    <span data-testid="hypopg-unavailable-plannerError">
      {t("jsonb.suggester.speedupUnavailable.plannerError", {
        message: reason.message,
      })}
    </span>
);
}
