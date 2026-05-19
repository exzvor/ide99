import { LifeBuoy } from "lucide-react";
import { type JSX, useState } from "react";
import { useTranslation } from "react-i18next";

import { SupportDialog } from "./SupportDialog";

/**
 * Status-bar "Support" chip — opens the feedback form on click. Sits between
 * the active-Instant-DB widget slot and the UTF-8 chip in Workspace's
 * bottom rail.
 */
export function SupportButton(): JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const label = t("support.button", { defaultValue: "Support" });

  return (    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="status-bar-support"
        aria-label={label}
        className="q-fchip"
        // appearance:none kills the Chromium UA padding/border injected on
        // <button>, which otherwise shifts the text down ~1px relative to
        // the neighbouring UTF-8 <span>. lineHeight:1 matches the icon
        // height so the text baseline lines up with the span next door.
        style={{
          appearance: "none",
          WebkitAppearance: "none",
          lineHeight: 1,
          cursor: "pointer",
        }}
      >
        <LifeBuoy size={11} aria-hidden="true" />
        {label}
      </button>
      <SupportDialog open={open} onOpenChange={setOpen} />
    </>
);
}
