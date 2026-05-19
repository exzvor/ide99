import * as RadixSelect from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";

/**
 * Thin wrapper around Radix Select primitives.
 *
 * - Controlled via `value` + `onValueChange`.
 * - `options` is a flat list of `{ value, label }`. Labels must already
 * be translated by the caller.
 * - Items render with a checkmark when selected; chevron icon on the
 * trigger advertises the popover affordance.
 *
 * Radix provides full keyboard support (Enter / Space / arrow keys /
 * type-ahead) and the appropriate ARIA roles.
 */

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  /** Required for accessibility — Radix renders this on the trigger. */
  ariaLabel: string;
  /** Optional placeholder displayed when value === "". */
  placeholder?: string;
  /** Disable the trigger entirely. */
  disabled?: boolean;
  /** id on the trigger so a separate <label> can target it via htmlFor. */
  id?: string;
}

export function Select({
  value,
  onValueChange,
  options,
  ariaLabel,
  placeholder,
  disabled,
  id,
}: SelectProps) {
  return (
    <RadixSelect.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <RadixSelect.Trigger
        id={id}
        aria-label={ariaLabel}
        className="inline-flex h-9 w-full items-center justify-between gap-[var(--space-2)] rounded-[var(--radius)] border border-[var(--gray-300)] bg-[var(--gray-0)] px-[var(--space-3)] text-[var(--text-sm)] leading-[var(--text-sm-lh)] text-[var(--gray-900)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-500)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <RadixSelect.Value placeholder={placeholder} />
        <RadixSelect.Icon>
          <ChevronDown size={14} aria-hidden="true" />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content
          position="popper"
          sideOffset={4}
          className="z-[var(--z-popover)] overflow-hidden rounded-[var(--radius-md)] border border-[var(--gray-200)] bg-[var(--gray-0)] shadow-[var(--shadow-md)]"
        >
          <RadixSelect.Viewport className="p-[var(--space-1)]">
            {options.map((option) => (
              <RadixSelect.Item
                key={option.value}
                value={option.value}
                className="relative flex cursor-pointer select-none items-center rounded-[var(--radius-sm)] py-[var(--space-2)] pl-[var(--space-6)] pr-[var(--space-3)] text-[var(--text-sm)] leading-[var(--text-sm-lh)] text-[var(--gray-900)] outline-none data-[highlighted]:bg-[var(--gray-100)] data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50"
              >
                <RadixSelect.ItemIndicator className="absolute left-[var(--space-2)] inline-flex items-center">
                  <Check size={12} aria-hidden="true" />
                </RadixSelect.ItemIndicator>
                <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}
