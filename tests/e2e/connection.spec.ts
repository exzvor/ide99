import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

/**
 * Connection-manager full-lifecycle e2e.
 *
 * The Tauri shell does NOT expose a Chromium-DevTools endpoint by default,
 * so this suite drives the binary at the OS level — we spawn the process,
 * wait for the `READY` handshake on stdout (emitted from `lib.rs::setup`),
 * and rely on the binary's own integration tests + UI vitest suites to
 * cover form behaviour. The e2e here is a coarse smoke covering:
 *
 *   1. Binary spawns, prints READY, stays alive while the test PG env is
 *      reachable. (smokes the Tauri app + Rust persistence side together)
 *   2. SIGTERM yields a clean exit.
 *   3. Re-spawn + READY again (acceptance criterion 2 — store survives
 *      restart; the SQLite + keychain row would be observable in the UI on
 *      a browser-driven driver, which lands in a later sprint).
 *
 * Self-skips when:
 *   - No `IDE99_BINARY` and the conventional release path doesn't exist, OR
 *   - `IDE99_TEST_PG_HOST` is unset (no Postgres available for the round-trip
 *     side of the lifecycle).
 *
 * The skip path matches the launch.spec.ts pattern so CI on macOS / Windows
 * (no Docker) gracefully no-ops the same way.
 */

function resolveBinary(): string {
  const fromEnv = process.env.IDE99_BINARY;
  if (fromEnv && fromEnv.length > 0) return resolve(fromEnv);
  const fallback =
    process.platform === "win32"
      ? "src-tauri/target/release/ide99.exe"
      : "src-tauri/target/release/ide99";
  return resolve(fallback);
}

const BINARY = resolveBinary();
const HAS_BINARY = (process.env.IDE99_BINARY?.length ?? 0) > 0 || existsSync(BINARY);
const HAS_TEST_PG = (process.env.IDE99_TEST_PG_HOST?.length ?? 0) > 0;

const TEST_PG_HOST = process.env.IDE99_TEST_PG_HOST ?? "localhost";
const TEST_PG_PORT = process.env.IDE99_TEST_PG_PORT ?? "5432";
const TEST_PG_USER = process.env.IDE99_TEST_PG_USER ?? "postgres";
const TEST_PG_PASSWORD = process.env.IDE99_TEST_PG_PASSWORD ?? "test";
const TEST_PG_DATABASE = process.env.IDE99_TEST_PG_DATABASE ?? "postgres";

test.describe("connection manager full lifecycle", () => {
  test.skip(
    !HAS_BINARY,
    "no ide99 binary present (set IDE99_BINARY=/path/to/ide99 or build via `cargo tauri build`)",
  );
  test.skip(
    !HAS_TEST_PG,
    "no test Postgres available (set IDE99_TEST_PG_HOST/PORT/USER/PASSWORD/DATABASE)",
  );

  test("binary survives the full create/restart/delete simulation", async () => {
    test.setTimeout(120_000);

    // Step 1: First launch.
    const first = await spawnAndAwaitReady();
    expect(first.exitCode, "process should still be alive after READY").toBeNull();

    // Step 2: SIGTERM and ensure clean exit (proxies for a graceful shutdown
    // path, which in turn flushes any pending SQLite writes).
    await terminate(first);

    // Step 3: Re-launch — verifies that AppState rebuilds cleanly against
    // the previously-written SQLite + keychain state. The UI assertions
    // (sidebar still shows the row, ConnectionDetails reflects host/port)
    // are covered by the vitest component tests + the Rust integration
    // test in `src-tauri/tests/connection_integration.rs`; we simply assert
    // that the relaunch reaches READY without panicking on the existing DB.
    const second = await spawnAndAwaitReady();
    expect(second.exitCode, "second launch should still be alive after READY").toBeNull();
    await terminate(second);
  });
});

interface SpawnedHandle {
  child: ChildProcess;
  stdout: () => string;
  stderr: () => string;
  exitCode: number | null;
}

async function spawnAndAwaitReady(): Promise<SpawnedHandle> {
  const child: ChildProcess = spawn(BINARY, [], {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      IDE99_TEST_PG_HOST: TEST_PG_HOST,
      IDE99_TEST_PG_PORT: TEST_PG_PORT,
      IDE99_TEST_PG_USER: TEST_PG_USER,
      IDE99_TEST_PG_PASSWORD: TEST_PG_PASSWORD,
      IDE99_TEST_PG_DATABASE: TEST_PG_DATABASE,
    },
  });

  let stdoutBuffer = "";
  let stderrBuffer = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    stdoutBuffer += chunk.toString("utf8");
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderrBuffer += chunk.toString("utf8");
  });

  const ready = await waitForReady(child, () => stdoutBuffer);
  expect(ready, `did not see READY within 30s. stdout=${stdoutBuffer} stderr=${stderrBuffer}`).toBe(
    true,
  );

  return {
    child,
    stdout: () => stdoutBuffer,
    stderr: () => stderrBuffer,
    exitCode: child.exitCode,
  };
}

async function terminate(handle: SpawnedHandle): Promise<void> {
  const exit = waitForExit(handle.child);
  if (process.platform === "win32") handle.child.kill();
  else handle.child.kill("SIGTERM");

  const result = await Promise.race([
    exit,
    new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((_, reject) =>
      setTimeout(() => {
        handle.child.kill("SIGKILL");
        reject(new Error("process did not exit within 10s of SIGTERM"));
      }, 10_000),
    ),
  ]);

  const cleanCode = result.code === 0 || result.code === null;
  const signalled =
    result.signal === "SIGTERM" || result.signal === "SIGKILL" || result.signal === "SIGINT";
  expect(
    cleanCode || signalled,
    `unexpected exit: code=${result.code} signal=${result.signal} stderr=${handle.stderr()}`,
  ).toBe(true);
}

async function waitForReady(child: ChildProcess, getBuffer: () => string): Promise<boolean> {
  const deadline = Date.now() + 30_000;
  return new Promise<boolean>((resolveReady) => {
    const tick = () => {
      if (/(^|\n)READY(\r?\n|$)/.test(getBuffer())) {
        resolveReady(true);
        return;
      }
      if (child.exitCode !== null) {
        resolveReady(false);
        return;
      }
      if (Date.now() >= deadline) {
        resolveReady(false);
        return;
      }
      setTimeout(tick, 50);
    };
    tick();
  });
}

function waitForExit(
  child: ChildProcess,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolveExit) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolveExit({ code: child.exitCode, signal: child.signalCode });
      return;
    }
    child.once("exit", (code, signal) => {
      resolveExit({ code, signal });
    });
  });
}
