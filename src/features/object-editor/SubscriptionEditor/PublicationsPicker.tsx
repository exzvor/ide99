// — comma-separated freeform input for publication names. The
// publications live on the *source* DB which we don't have a connection to
// from this side, so remote autocomplete isn't available — the user types
// the names exactly as they exist on the publisher.

import type { JSX } from "react";
import { useTranslation } from "react-i18next";

export interface PublicationsPickerProps {
  value: string[];
  onChange: (next: string[]) => void;
}

export function PublicationsPicker({ value, onChange }: PublicationsPickerProps): JSX.Element {
  const { t } = useTranslation();
  const text = value.join(", ");
  return (    <div className="q-field">
      <label htmlFor="sub-publications-input">
        {t("object_editor.subscription.publications_label")}
      </label>
      <input
        id="sub-publications-input"
        data-testid="sub-publications"
        className="q-input mono"
        value={text}
        onChange={(e) => {
          const next = e.target.value
            .split(",")
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
          onChange(next);
        }}
      />
    </div>
);
}
