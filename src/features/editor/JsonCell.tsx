import type { JSX } from "react";

/**
 * Renders a JSON/JSONB cell value in a single collapsed line.
 *
 * We do not parse the JSON in render — that would burn CPU on every
 * scroll frame. Truncation is purely substring + ellipsis via CSS.
 *
 * this component is render-only. Double-click handling for
 * jsonb cells lives on the parent grid cell in `ResultGrid.tsx` and
 * routes to the editable JSONB modal (`useJsonbEditor.openEditor`).
 * Mounting a separate `ValueModal` here would race the editor modal and
 * surface as a stacked second dialog (the bug the user observed).
 */
export function JsonCell({ value }: { value: string }): JSX.Element {
  return (    <span
      className="block w-full overflow-hidden text-ellipsis whitespace-nowrap font-mono"
      title={value}
    >
      {value}
    </span>
);
}
