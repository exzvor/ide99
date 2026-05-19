import { type JSX, useEffect, useState } from "react";
import { EnvStrip } from "./components/EnvStrip";
import { ToastProvider } from "./components/Toast";
import { AdminTelemetryHost } from "./features/admin-telemetry/AdminTelemetryHost";
import { ConceptTooltipProvider } from "./features/concept-tooltips";
import { ConnectionForm } from "./features/connections/ConnectionForm";
import { useConnections } from "./features/connections/store";
import { useUiMode } from "./features/easy-mode/store";
import { ConfirmDestructiveModal } from "./features/editor/safety/ConfirmDestructiveModal";
import { SlowQueryWarningModal } from "./features/editor/safety/SlowQueryWarningModal";
import { useEditor } from "./features/editor/store";
import { ErrorExplainModalHost } from "./features/error-explain/ErrorExplainModal";
import { McpActionListener } from "./features/mcp/McpActionListener";
import { McpAuthorizeDialog } from "./features/mcp/McpAuthorizeDialog";
import { McpWriteConfirmDialog } from "./features/mcp/McpWriteConfirmDialog";
import { useMcpBridgeSync } from "./features/mcp/useMcpBridgeSync";
import { OnboardingWizard } from "./features/onboarding";
import { TourHost } from "./features/onboarding-tour/TourHost";
import { VibepgCommandPalette } from "./features/paid-modules";
import { CrashReporterHost } from "./features/privacy/CrashReporterHost";
import { TelemetryOptInDialog } from "./features/privacy/TelemetryOptInDialog";
import { SnippetPalette } from "./features/snippets/SnippetPalette";
import { useSnippets } from "./features/snippets/store";
import { SettingsModal, openSettings } from "./screens/SettingsModal";
import Welcome from "./screens/Welcome";
import Workspace from "./screens/Workspace";

/**
 * Top-level shell:
 * - mounts <ToastProvider /> so any descendant can call useToast();
 * - mounts <ConnectionForm /> once so the create/edit modal is available
 * on both Welcome and Workspace screens (renders nothing when closed);
 * - mounts <SnippetPalette /> + safety modals (S8) at root so they render
 * above tab content;
 * - mounts <EnvStrip /> at the very top — 3px env-color strip under the
 * title bar, reflects the active editor tab's connection env;
 * - global Cmd/Ctrl+J keydown listener opens the snippet palette;
 * - kicks off one-shot listConnections() + snippetsList() on mount;
 * - branches on `connections.length`: 0 → Welcome+EmptyState, ≥1 → Workspace.
 */
export default function App(): JSX.Element {
  const hasConnections = useConnections((s) => s.connections.length > 0);
  // — current UI mode drives layout, tooltips, linter, tour.
  // We surface it as `data-mode` on document.documentElement so CSS rules
  // can target it without prop-threading.
  const mode = useUiMode((s) => s.mode);
  // �� vibepg command palette host. Cmd/Ctrl+K opens; the palette
  // itself shows commands regardless of subscription state and routes
  // unsubscribed clicks to the upgrade page (see `VibepgCommandPalette`).
  const [vibepgPaletteOpen, setVibepgPaletteOpen] = useState(false);
  useEffect(() => {
    document.documentElement.dataset.mode = mode;
  }, [mode]);

  // — keep backend MCP bridge in sync with frontend state. Hook
  // is a no-op when MCP is disabled (backend ignores updates).
  useMcpBridgeSync();

  useEffect(() => {
    void useConnections.getState().load();
    void useSnippets.getState().load();
  }, []);

  // Global hotkeys (cross-platform — Cmd on macOS, Ctrl on Linux/Windows):
  // Cmd/Ctrl+J        — open snippet palette
  // Cmd/Ctrl+,        — open Settings modal
  // Cmd/Ctrl+K        — open command palette (vibepg + connections)
  // Cmd/Ctrl+Shift+E is handled by Workspace.tsx as EXPLAIN ANALYZE on the
  // active editor tab. The Easy-mode toggle binding has been retired so the
  // shortcut belongs to EXPLAIN ANALYZE alone.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      if (key === "j") {
        e.preventDefault();
        useSnippets.getState().openPalette();
      } else if (key === ",") {
        e.preventDefault();
        openSettings();
      } else if (key === "k") {
        // �� Cmd/Ctrl+K opens the vibepg command palette. The palette
        // surfaces vibepg commands without requiring an active subscription
        // (clicks route to upgrade flow when not subscribed).
        e.preventDefault();
        setVibepgPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (    <ToastProvider>
      {/* — Radix Tooltip.Provider so any descendant `ConceptTooltip`
          works without per-call wiring. No-op in Standard mode (gated inside
          `ConceptTooltip` itself). */}
      <ConceptTooltipProvider>
        <EnvStrip />
        {hasConnections ? <Workspace /> : <Welcome />}
        <ConnectionForm />
        <SnippetPalette />
        <SettingsModal />
        <SafetyModals />
        {/* — MCP server UI surfaces. */}
        <McpAuthorizeDialog />
        <McpWriteConfirmDialog />
        <McpActionListener />
        {/* — plain-English error explanation modal (event-driven). */}
        <ErrorExplainModalHost />
        {/* — onboarding tour host (active in Easy mode + via Help). */}
        <TourHost />
        {/* — privacy: first-launch opt-in + crash preview. */}
        <TelemetryOptInDialog />
        <CrashReporterHost />
        {/* — onboarding wizard (welcome → connection profile →
            sample DB → tour handoff). Mounted at App level so it shows
            even when there are zero connections (Welcome screen). */}
        <OnboardingWizard />
        {/* �� vibepg command palette host (Cmd/Ctrl+K). */}
        <VibepgCommandPalette open={vibepgPaletteOpen} onOpenChange={setVibepgPaletteOpen} />
        {/* Phase 5 — wedge telemetry sender (ide.opened + heartbeat). */}
        <AdminTelemetryHost />
      </ConceptTooltipProvider>
    </ToastProvider>
);
}

/** — renders whichever pre-execute pipeline modal is active. */
function SafetyModals(): JSX.Element | null {
  const modal = useEditor((s) => s.safetyModal);
  if (modal.kind === "confirm") {
    return (      <ConfirmDestructiveModal
        open
        action={modal.action}
        target={modal.target}
        environment={modal.environment}
        onConfirm={modal.onConfirm}
        onCancel={modal.onCancel}
      />
);
  }
  if (modal.kind === "slow") {
    return (      <SlowQueryWarningModal
        open
        cost={modal.cost}
        onProceed={modal.onProceed}
        onCancel={modal.onCancel}
      />
);
  }
  if (modal.kind === "easyAdvisory") {
    // — reuses the slow-query modal shell with an alternate body
    // (different translation keys driven by `advisory.kind`).
    return (      <SlowQueryWarningModal
        open
        cost={0}
        advisory={modal.advisory}
        onProceed={() => modal.onProceed()}
        onCancel={modal.onCancel}
      />
);
  }
  return null;
}
