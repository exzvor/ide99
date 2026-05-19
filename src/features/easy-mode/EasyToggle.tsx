/**
 * — Easy / Standard mode toggle.
 *
 * Side effects beyond `setMode`:
 * - On first switch standard → easy AND `tourCompleted === false`,
 * dispatches `ide99:tour:start` so the onboarding-tour host starts the
 * mandatory walk-through (functional spec §3.4).
 * - Cmd/Ctrl+Shift+E global shortcut is registered in `App.tsx`; the
 * button itself only handles click.
 *
 * Visual treatment in Easy mode (orange accent fill on the indicator) is
 * driven by `[data-mode="easy"]` CSS rules in `easy-mode.css`.
 */

import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { useUiMode } from "./store";

export function EasyToggle(): JSX.Element {
  const { t } = useTranslation();
  const mode = useUiMode((s) => s.mode);

  const onClick = (): void => {
    const before = useUiMode.getState();
    const wasEasy = before.mode === "easy";
    useUiMode.getState().toggleMode();
    // Dispatch tour-start on the first standard → easy switch ever (when
    // tourCompleted is still false). Subsequent switches are silent.
    if (!wasEasy && !before.tourCompleted) {
      window.dispatchEvent(new CustomEvent("ide99:tour:start"));
    }
  };

  const label = mode === "easy" ? t("easyMode.toggle.easyOn") : t("easyMode.toggle.standardOn");
  return (
    <button
      type="button"
      className="easy-toggle btn-icon"
      data-mode={mode}
      onClick={onClick}
      aria-pressed={mode === "easy"}
      data-testid="easy-mode-toggle"
      title={t("easyMode.toggle.hint")}
    >
      <span aria-hidden="true" className="easy-toggle-glyph">
        {mode === "easy" ? "✨" : "·"}
      </span>
      <span className="easy-toggle-label">{label}</span>
    </button>
  );
}
