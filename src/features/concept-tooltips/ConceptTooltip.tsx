/**
 * — wraps a child with a Radix concept tooltip when in Easy mode.
 *
 * <ConceptTooltip id="schema"><span>Schema</span></ConceptTooltip>
 *
 * Behavioural contract:
 * - In Standard mode → `return <>{children}</>`. Zero overhead, no Radix
 * hooks fire, no extra DOM nodes; safe to sprinkle through the codebase.
 * - In Easy mode → wraps `children` with a Radix `Tooltip.Trigger` and
 * renders a `Tooltip.Content` panel containing the concept's explanation
 * plus a monospace example block. By default a small ❓ adornment is
 * rendered next to `children` so users can discover that the concept is
 * hover-able. Pass `showHelpIcon={false}` when the surrounding UI already
 * reads as interactive (e.g. a tree row, a column header button).
 * - An unknown `id` → `console.warn` once and render `children` unchanged
 * so a missing entry never breaks the surrounding layout.
 *
 * Locale resolution is done via `pickLocale` (re-used from error-explain) so
 * en+ru fall back consistently to EN when react-i18next is set to a third
 * locale.
 */

import * as Tooltip from "@radix-ui/react-tooltip";
import { HelpCircle } from "lucide-react";
import { type JSX, type ReactNode, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useUiMode } from "../easy-mode/store";
import { pickLocale } from "../error-explain/lookup";
import { CONCEPTS_BY_ID } from "./concepts";

export interface ConceptTooltipProps {
  /** Stable id from `CONCEPTS_BY_ID`. */
  id: string;
  /** Visual label / element that triggers the tooltip on hover/focus. */
  children: ReactNode;
  /** Render the muted ❓ adornment next to `children`. Defaults to `true`. */
  showHelpIcon?: boolean;
}

const warnedIds = new Set<string>();

function warnMissingConcept(id: string): void {
  if (warnedIds.has(id)) return;
  warnedIds.add(id);
  // eslint-disable-next-line no-console
  console.warn(`[concept-tooltips] no entry for id="${id}" — render children unchanged.`);
}

export function ConceptTooltip({
  id,
  children,
  showHelpIcon = true,
}: ConceptTooltipProps): JSX.Element {
  const mode = useUiMode((s) => s.mode);
  const { i18n, t } = useTranslation();
  const concept = useMemo(() => CONCEPTS_BY_ID.get(id), [id]);

  // Standard mode → zero overhead. Skip every Radix hook below by short-
  // circuiting before they'd otherwise mount.
  if (mode !== "easy") return <>{children}</>;

  // Bad id → warn once and degrade gracefully (still render children).
  if (concept === undefined) {
    warnMissingConcept(id);
    return <>{children}</>;
  }

  // `i18n.language` is undefined when react-i18next has not been initialised
  // (e.g. inside isolated unit tests). Falling back to `"en"` keeps the
  // component renderable in those contexts without depending on the host
  // mounting an `<I18nextProvider>`.
  const lang = i18n.language ?? "en";
  const explanation = pickLocale(concept.explanation, lang);
  const example = concept.example ? pickLocale(concept.example, lang) : null;

  return (    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <span
          className="concept-tooltip-trigger"
          data-concept-id={id}
          data-testid={`concept-tooltip-trigger-${id}`}
          style={{ display: "inline-flex", alignItems: "center", gap: 3, cursor: "help" }}
        >
          {children}
          {showHelpIcon ? (            <HelpCircle
              size={11}
              aria-hidden="true"
              style={{ color: "var(--ink-4, #888)", flexShrink: 0 }}
            />
) : null}
        </span>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="top"
          align="start"
          sideOffset={6}
          className="concept-tooltip-content"
          aria-label={t("conceptTooltip.trigger")}
          data-testid={`concept-tooltip-content-${id}`}
          style={{
            maxWidth: 320,
            padding: "10px 12px",
            background: "var(--bg-1, #1f1f1f)",
            color: "var(--ink-1, #e6e6e6)",
            border: "1px solid var(--hairline, rgba(255,255,255,0.08))",
            borderRadius: 6,
            boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
            fontSize: 12,
            lineHeight: 1.45,
            zIndex: 70,
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.02em",
              textTransform: "uppercase",
              color: "var(--ink-4, #999)",
              marginBottom: 4,
            }}
          >
            {t("conceptTooltip.trigger")}
          </div>
          <p style={{ margin: "0 0 8px 0" }}>{explanation}</p>
          {example !== null ? (            <pre
              style={{
                margin: 0,
                padding: "6px 8px",
                background: "var(--bg-sunken, rgba(255,255,255,0.04))",
                borderRadius: 4,
                fontFamily: "var(--font-mono-q, ui-monospace, monospace)",
                fontSize: 11,
                whiteSpace: "pre-wrap",
                overflowX: "auto",
              }}
            >
              {example}
            </pre>
) : null}
          <Tooltip.Arrow style={{ fill: "var(--bg-1, #1f1f1f)" }} />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
);
}
