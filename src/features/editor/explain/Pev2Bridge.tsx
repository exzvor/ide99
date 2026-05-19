import { type JSX, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

interface Pev2BridgeProps {
  plan: unknown;
  theme: "light" | "dark";
  /**
   * — pev2's planQuery prop accepts a substring; matching nodes
   * get its built-in highlight outline. Used by the InsightsPanel and
   * PlanDiffPanel click handlers to focus a specific node label.
   */
  highlightQuery?: string;
}

const ISLAND_URL = "/pev2-island.html";

/**
 * — React adapter for the Vue 3 `pev2` plan-visualizer.
 *
 * pev2 hard-depends on Bootstrap 5 CSS classes and uses Popper / tippy.js
 * portals that mount tooltips into `document.body`. To keep that out of
 * the host React app, pev2 lives inside an iframe (`pev2-island.html`,
 * separate Vite entry) and we communicate via `postMessage`.
 *
 * Protocol — see `src/pev2-island/main.ts`:
 * parent → island   { type: "render", plan, theme, planQuery }
 * island → parent   { type: "island-ready" } / { type: "render-ack", durationMs }
 */
export function Pev2Bridge({ plan, theme, highlightQuery }: Pev2BridgeProps): JSX.Element {
  const { t } = useTranslation();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (iframeRef.current && event.source !== iframeRef.current.contentWindow) return;
      const data = event.data as { type?: string } | null;
      if (data?.type === "island-ready") setReady(true);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage({ type: "render", plan, theme, planQuery: highlightQuery ?? "" }, "*");
  }, [plan, theme, highlightQuery, ready]);

  return (
    <iframe
      ref={iframeRef}
      src={ISLAND_URL}
      title={t("editor.explain.iframe_title")}
      className="pev2-host"
      data-testid="pev2-host"
      style={{
        width: "100%",
        height: "100%",
        border: 0,
        background: "transparent",
        display: "block",
      }}
    />
  );
}
