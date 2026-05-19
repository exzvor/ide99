import * as RadixDialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Thin wrapper around Radix Dialog primitives — quiet redesign.
 *
 * .q-backdrop  rgba(15,17,21,0.40) + blur(8px)
 * .q-modal     bg-elev, border, radius xl, shadow-lg, padding 28
 * header       title (16/600) + close icon
 * body         children
 * footer       slot, justify-end, gap 8
 */

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  /** Closes the dialog when the user presses Esc. Default true. */
  closeOnEscape?: boolean;
  /** Closes the dialog when the user clicks outside. Default true. */
  closeOnOutsideClick?: boolean;
  /** Optional label for an icon-only close button rendered in the corner. */
  closeAriaLabel?: string;
  /** Extra CSS modifier on .q-modal (e.g. "sm" / "lg" / "xl"). */
  size?: "sm" | "md" | "lg" | "xl";
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  closeOnEscape = true,
  closeOnOutsideClick = true,
  closeAriaLabel,
  size = "md",
}: DialogProps) {
  const sizeClass = size === "md" ? "" : size;
  return (    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="q-backdrop" data-testid="dialog-overlay" />
        <RadixDialog.Content
          className={`q-modal ${sizeClass}`.trim()}
          onEscapeKeyDown={(event) => {
            if (!closeOnEscape) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (!closeOnOutsideClick) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (!closeOnOutsideClick) event.preventDefault();
          }}
        >
          <div className="q-modal-header">
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <RadixDialog.Title className="q-modal-title">{title}</RadixDialog.Title>
              {description ? (                <RadixDialog.Description
                  style={{
                    fontSize: 12.5,
                    color: "var(--ink-3)",
                    margin: 0,
                  }}
                >
                  {description}
                </RadixDialog.Description>
) : null}
            </div>
            {closeAriaLabel ? (              <RadixDialog.Close
                aria-label={closeAriaLabel}
                className="btn-icon"
                style={{ width: 28, height: 28 }}
              >
                <X size={14} aria-hidden="true" />
              </RadixDialog.Close>
) : null}
          </div>
          <div className="q-modal-body" style={{ color: "var(--ink-2)" }}>
            {children}
          </div>
          {footer ? <div className="q-modal-footer">{footer}</div> : null}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
);
}

export const DialogClose = RadixDialog.Close;
