import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/globals.css";
import "pev2/dist/pev2.css";
import "./i18n";
import App from "./App";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(    <StrictMode>
      <App />
    </StrictMode>,
);

  // Hide the boot/loading overlay (defined inline in index.html) once the
  // React tree has actually painted. Min-show 600ms so very fast machines
  // still see the brand for a moment instead of a flash.
  const BOOT_MIN_MS = 600;
  const start = performance.now();
  const reveal = () => {
    const wait = Math.max(0, BOOT_MIN_MS - (performance.now() - start));
    window.setTimeout(() => {
      document.documentElement.classList.add("app-ready");
      const boot = document.getElementById("boot");
      if (boot) {
        boot.classList.add("is-hidden");
        // Drop the node after the fade so it stops repainting the grid/shimmer.
        window.setTimeout(() => boot.remove(), 600);
      }
    }, wait);
  };
  if (typeof requestAnimationFrame === "function") {
    // Two RAFs — first ensures the React commit has been scheduled, second
    // gives the browser a frame to paint before we start the fade.
    requestAnimationFrame(() => requestAnimationFrame(reveal));
  } else {
    reveal();
  }
}
