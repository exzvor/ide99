/**
 * — pev2 island entry point.
 *
 * Loaded inside an iframe (`pev2-island.html`) so pev2's CSS dependency
 * on Bootstrap, plus its tippy.js / Popper portals, live in a fully
 * isolated document. The host React app talks to this island via
 * `postMessage` only — no shared globals, no shared CSS.
 *
 * Protocol (window.parent ↔ this iframe):
 *
 * parent → island   { type: "render", plan: <object|string>, theme: "light"|"dark", planQuery?: string }
 * island → parent   { type: "island-ready" }            on first load
 * island → parent   { type: "render-ack", durationMs }   after each render
 *
 * The host posts "render" once on first paint and again whenever plan or
 * theme changes. The island unmounts the previous Vue app and remounts
 * a fresh one — same strategy as the prior in-React Pev2Bridge but now
 * isolated in its own document.
 */

import "bootstrap/dist/css/bootstrap.min.css";
import "pev2/dist/pev2.css";
// Quiet-redesign overrides — must come AFTER pev2.css so we win the cascade.
// Maps Bootstrap CSS-vars to ide99 quiet tokens and patches a small set of
// pev2-specific selectors that don't read from --bs-* directly. Vue tree is
// untouched; this is a pure CSS layer.
import "./quiet.css";

// pev2 has a typed entry but the named-export shape is only declared in its
// own .d.ts; importing the value works at runtime.
import { Plan } from "pev2";
import { type App, createApp } from "vue";

const ROOT_ID = "root";

let currentApp: App | null = null;

function applyTheme(theme: "light" | "dark"): void {
  // Bootstrap 5.3+ uses data-bs-theme for dark/light scheme.
  document.documentElement.setAttribute("data-bs-theme", theme);
}

function render(plan: unknown, theme: "light" | "dark", planQuery: string): void {
  const root = document.getElementById(ROOT_ID);
  if (!root) return;
  if (currentApp) {
    currentApp.unmount();
    currentApp = null;
  }
  applyTheme(theme);
  const planSource = typeof plan === "string" ? plan : JSON.stringify(plan);
  // biome-ignore lint/suspicious/noExplicitAny: pev2's Plan prop shape isn't narrow-typed in its public d.ts.
  currentApp = createApp(Plan as any, { planSource, planQuery });
  currentApp.mount(root);
}

window.addEventListener("message", (event: MessageEvent) => {
  const data = event.data as
    | { type: "render"; plan: unknown; theme?: "light" | "dark"; planQuery?: string }
    | undefined;
  if (!data || data.type !== "render") return;
  const start = performance.now();
  render(data.plan, data.theme ?? "light", data.planQuery ?? "");
  const durationMs = Math.round(performance.now() - start);
  window.parent.postMessage({ type: "render-ack", durationMs }, "*");
});

// Tell the parent we're alive so it can flush a queued plan.
window.parent.postMessage({ type: "island-ready" }, "*");
