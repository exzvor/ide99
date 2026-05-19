import * as RadixDropdown from "@radix-ui/react-dropdown-menu";
import type { ReactNode } from "react";

/**
 * Thin wrapper around Radix DropdownMenu primitives.
 *
 * - `trigger` is the element a consumer renders (e.g. a button, a row).
 * - `items` is a flat list — for v1 we don't need submenus or separators
 * (S2's only consumer is the connection list right-click menu with three
 * actions).
 * - Position autoflips via Radix's collision-aware Content placement.
 *
 * Destructive items (e.g. Delete) get red text via the design tokens.
 */

export interface DropdownItem {
  /** Visible label. Must already be translated by the caller. */
  label: string;
  /** Click + Enter handler. */
  onSelect: () => void;
  /** Tints the item red and applies destructive ARIA styling. */
  destructive?: boolean;
  /** Disables the item (greyed, not focusable). */
  disabled?: boolean;
}

export interface DropdownMenuProps {
  /** Element rendered inside the trigger slot. */
  trigger: ReactNode;
  /** Items shown when the menu is open. */
  items: DropdownItem[];
  /** Optional aria-label for the menu (Radix derives one if absent). */
  ariaLabel?: string;
  /** Side relative to the trigger; default "bottom". */
  side?: "top" | "right" | "bottom" | "left";
  /** Alignment relative to the trigger; default "start". */
  align?: "start" | "center" | "end";
}

export function DropdownMenu({
  trigger,
  items,
  ariaLabel,
  side = "bottom",
  align = "start",
}: DropdownMenuProps) {
  return (    <RadixDropdown.Root>
      <RadixDropdown.Trigger asChild>{trigger}</RadixDropdown.Trigger>
      <RadixDropdown.Portal>
        <RadixDropdown.Content
          aria-label={ariaLabel}
          side={side}
          align={align}
          sideOffset={4}
          collisionPadding={8}
          className="z-[var(--z-dropdown)] min-w-[10rem] rounded-[var(--radius-md)] border border-[var(--gray-200)] bg-[var(--gray-0)] p-[var(--space-1)] shadow-[var(--shadow-md)]"
        >
          {items.map((item) => (            <RadixDropdown.Item
              key={item.label}
              disabled={item.disabled}
              onSelect={(event) => {
                event.preventDefault();
                if (!item.disabled) item.onSelect();
              }}
              className={
                item.destructive
                  ? "flex cursor-pointer select-none items-center rounded-[var(--radius-sm)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--text-sm)] leading-[var(--text-sm-lh)] text-[var(--error-600)] outline-none data-[highlighted]:bg-[var(--error-50)] data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50"
                  : "flex cursor-pointer select-none items-center rounded-[var(--radius-sm)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--text-sm)] leading-[var(--text-sm-lh)] text-[var(--gray-900)] outline-none data-[highlighted]:bg-[var(--gray-100)] data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50"
              }
            >
              {item.label}
            </RadixDropdown.Item>
))}
        </RadixDropdown.Content>
      </RadixDropdown.Portal>
    </RadixDropdown.Root>
);
}
