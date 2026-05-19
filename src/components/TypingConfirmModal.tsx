/**
 * — generalized typing-confirm modal extracted 
 * `BatchConfirmModal` so the JSONB editor can reuse it for the production
 * write guard.
 *
 * Caller-provided props drive every label so the modal stays content-agnostic
 * (no embedded i18n keys). The match check is case-insensitive — caller
 * decides whether the typed token is destructive (DB name, table name, etc.).
 *
 * `BatchConfirmModal` is now a thin wrapper around this component that
 * preserves the original S8 props shape (`environment`, `databaseName`,
 * `destructive[]`, …) — its existing tests pass unchanged.
 */

import * as Dialog from "@radix-ui/react-dialog";
import { type JSX, type ReactNode, useState } from "react";

export interface TypingConfirmModalProps {
  /** Modal title (already-translated string). */
  title: string;
  /** Lead description below the title. May be a string or any node — the
   * caller can render rich content (e.g. SQL preview rendered above the
   * input via `dangerSqlPreview`). */
  description: ReactNode;
  /** The token the user must type to enable the confirm button. */
  expectedToken: string;
  /** Visible <label> text for the input. */
  inputLabel: string;
  /** Confirm button label. */
  confirmLabel: string;
  /** Cancel button label. */
  cancelLabel: string;
  /** Optional SQL block rendered below the description, above the input. */
  dangerSqlPreview?: string;
  /** Optional summary list (used by the BatchConfirmModal wrapper). */
  bodyExtras?: ReactNode;
  /** Defaults to true. When false, the typing gate is skipped — useful when
   * callers want a confirmation prompt without the typing requirement. */
  requireTyping?: boolean;
  onCancel: () => void;
  onConfirm: (typedToken: string) => void;
}

/** Generalized typing-confirm modal. */
export function TypingConfirmModal(props: TypingConfirmModalProps): JSX.Element {
  const requireTyping = props.requireTyping !== false;
  const [typed, setTyped] = useState("");
  const matches = typed.trim().toLowerCase() === props.expectedToken.trim().toLowerCase();
  const canConfirm = !requireTyping || matches;

  const inputId = "typing-confirm-input";

  return (    <Dialog.Root open onOpenChange={(o) => (o ? null : props.onCancel())}>
      <Dialog.Portal>
        <Dialog.Overlay className="q-backdrop" />
        <Dialog.Content className="q-modal sm" style={{ padding: 24 }}>
          <Dialog.Title className="q-modal-title" style={{ userSelect: "text" }}>
            {props.title}
          </Dialog.Title>
          <Dialog.Description style={{ marginTop: 8, fontSize: 12.5, color: "var(--ink-3)" }}>
            {props.description}
          </Dialog.Description>
          {props.bodyExtras ?? null}
          {props.dangerSqlPreview ? (            <pre
              style={{
                marginTop: 12,
                padding: 12,
                background: "var(--bg-sunken)",
                border: "1px solid var(--hairline)",
                borderRadius: 6,
                fontFamily: "var(--font-mono-q)",
                fontSize: 12,
                whiteSpace: "pre-wrap",
                color: "var(--ink-2)",
                maxHeight: 200,
                overflow: "auto",
              }}
            >
              {props.dangerSqlPreview}
            </pre>
) : null}
          {requireTyping ? (            <div className="q-field" style={{ marginTop: 10 }}>
              <label htmlFor={inputId}>{props.inputLabel}</label>
              <input
                id={inputId}
                type="text"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                // biome-ignore lint/a11y/noAutofocus: focus the type-prompt input on dialog open
                autoFocus
                className="q-input mono"
              />
            </div>
) : null}
          <div
            style={{
              marginTop: 18,
              display: "flex",
              justifyContent: "flex-end",
              gap: 8,
            }}
          >
            <button type="button" className="btn btn-ghost" onClick={props.onCancel}>
              {props.cancelLabel}
            </button>
            <button
              type="button"
              disabled={!canConfirm}
              className="btn btn-danger"
              onClick={() => props.onConfirm(typed)}
            >
              {props.confirmLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
);
}
