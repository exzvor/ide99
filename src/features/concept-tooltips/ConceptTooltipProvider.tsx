/**
 * — Radix Tooltip provider for the concept tooltips feature.
 *
 * Mounted once at App root so any descendant `<ConceptTooltip>` works without
 * each call site having to wire its own provider. We keep the global delay
 * short (300ms) so hover-to-explanation feels responsive in Easy mode while
 * still avoiding accidental flashes when the user is mousing across the UI.
 */

import * as Tooltip from "@radix-ui/react-tooltip";
import type { JSX, ReactNode } from "react";

interface ConceptTooltipProviderProps {
  children: ReactNode;
}

export function ConceptTooltipProvider({ children }: ConceptTooltipProviderProps): JSX.Element {
  return (
    <Tooltip.Provider delayDuration={300} skipDelayDuration={150}>
      {children}
    </Tooltip.Provider>
  );
}
