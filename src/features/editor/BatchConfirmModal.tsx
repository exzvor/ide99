/**
 * Post-S14 — consolidated destructive-confirm modal for multi-statement
 * batches.
 *
 * Renders ONE prompt that summarises every destructive statement in the
 * incoming batch (DROP/TRUNCATE/DELETE-ALL/UPDATE-ALL) plus the total
 * statement count. On `prod` the user must type the database name to enable
 * the Confirm button; on `dev`/`stage` (when `confirm_destructive=true`)
 * the gate is skipped and Confirm is enabled immediately.
 *
 * Single-statement runs DO NOT use this modal — they fall back to the
 * legacy `ConfirmDestructiveModal` via `preflightSafety` (see
 * `preflightBatch` for the dispatch).
 *
 * — refactored as a thin wrapper around `<TypingConfirmModal>`.
 * The external props shape is unchanged; the existing S8 tests still pass.
 */

import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { TypingConfirmModal } from "../../components/TypingConfirmModal";
import type { Environment } from "../../lib/tauri";

interface DestructiveItem {
  /** 0-based index of the destructive statement inside the batch. */
  index: number;
  action: string;
  target: string;
  snippet: string;
}

interface Props {
  open: boolean;
  total: number;
  environment: Environment;
  databaseName: string;
  destructive: DestructiveItem[];
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Russian noun pluralisation helper. For a count `n` returns the suffix
 * key (`one` | `few` | `many`) so the caller can build the i18n key
 * `editor.batch.confirm.lead_${suffix}`. English collapses `few`/`many`
 * to the same string in the i18n bundle, so this is a no-op there.
 */
function pluralRu(count: number, key: (suffix: "one" | "few" | "many") => string): string {
  const n10 = count % 10;
  const n100 = count % 100;
  if (n100 >= 11 && n100 <= 14) return key("many");
  if (n10 === 1) return key("one");
  if (n10 >= 2 && n10 <= 4) return key("few");
  return key("many");
}

export function BatchConfirmModal(props: Props): JSX.Element | null {
  const { t } = useTranslation();
  if (!props.open) return null;

  const requireTyping = props.environment === "prod";
  const lead = pluralRu(props.destructive.length, (s) =>
    t(`editor.batch.confirm.lead_${s}`, {
      total: props.total,
      env: props.environment,
      count: props.destructive.length,
    }),
);

  const list = (    <ul className="q-batch-confirm-list">
      {props.destructive.map((d) => (        <li key={d.index}>
          <span className="idx">#{d.index + 1}</span>
          <span className="sql" title={d.snippet}>
            {d.snippet}
          </span>
        </li>
))}
    </ul>
);

  return (    <TypingConfirmModal
      title={t("editor.batch.confirm.title")}
      description={lead}
      bodyExtras={list}
      expectedToken={props.databaseName}
      inputLabel={t("editor.batch.confirm.type_db_prompt")}
      confirmLabel={t("editor.batch.confirm.confirm_button", { total: props.total })}
      cancelLabel={t("editor.batch.confirm.cancel_button")}
      requireTyping={requireTyping}
      onCancel={props.onCancel}
      onConfirm={() => props.onConfirm()}
    />
);
}
