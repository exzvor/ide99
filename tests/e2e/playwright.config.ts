import { defineConfig } from "@playwright/test";

/**
 * Playwright configuration for ide99 end-to-end tests.
 *
 * We do NOT open a browser here — the suite spawns the native Tauri
 * binary directly via Node's `child_process` and asserts on its stdout
 * / lifecycle. Hence no `projects` block; Playwright is used as a test
 * runner, not a browser driver.
 */
export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  workers: 1,
  retries: 0,
  fullyParallel: false,
  reporter: "list",
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
});
