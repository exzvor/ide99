import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

/**
 * Resolve the ide99 binary path. CI sets `IDE99_BINARY` to the absolute
 * path of the artifact downloaded from the `tauri-build` job. Locally we
 * fall back to the conventional `cargo tauri build --release --no-bundle`
 * output location.
 */
function resolveBinary(): string {
  const fromEnv = process.env.IDE99_BINARY;
  if (fromEnv && fromEnv.length > 0) {
    return resolve(fromEnv);
  }
  const fallback =
    process.platform === "win32"
      ? "src-tauri/target/release/ide99.exe"
      : "src-tauri/target/release/ide99";
  return resolve(fallback);
}

const BINARY = resolveBinary();

test.describe("ide99 launch", () => {
  test.skip(
    !process.env.IDE99_BINARY && !existsSync(BINARY),
    "no ide99 binary present (set IDE99_BINARY or build first)",
  );

  // The launch test relies on the main window showing and emitting "READY"
  // on stdout. The CI Windows runner is a gitlab-runner Windows service
  // (LocalSystem) with no interactive desktop, so the Tauri webview never
  // attaches and the READY handshake never fires. Coverage on Windows is
  // provided by `cross:rust:windows` (compile-only) + `build:tauri:windows`
  // (release link). When the runner gets converted to user-session
  // (interactive logon), drop this skip.
  test.skip(
    process.platform === "win32" && !!process.env.CI,
    "headless gitlab-runner service on Windows can't open a GUI window",
  );

  test("launches and exits cleanly", async () => {
    test.setTimeout(60_000);

    const child: ChildProcess = spawn(BINARY, [], {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let stdoutBuffer = "";
    let stderrBuffer = "";

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutBuffer += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrBuffer += chunk.toString("utf8");
    });

    // Wait up to 30s for the READY handshake on stdout. The binary prints
    // `READY` once the main window is shown (wired by sub-agent C in
    // src-tauri/src/lib.rs).
    const ready = await waitForReady(child, () => stdoutBuffer);

    expect(
      ready,
      `did not see READY within 30s. stdout=${stdoutBuffer} stderr=${stderrBuffer}`,
    ).toBe(true);

    // Process should still be alive after READY.
    expect(child.exitCode, "process should still be alive after READY").toBeNull();

    // Graceful shutdown.
    const exit = waitForExit(child);
    if (process.platform === "win32") {
      // Windows lacks SIGTERM semantics; child.kill() maps to
      // TerminateProcess which is the most reliable shutdown for the
      // smoke test on Windows runners.
      child.kill();
    } else {
      child.kill("SIGTERM");
    }

    const result = await Promise.race([
      exit,
      new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((_, reject) =>
        setTimeout(() => {
          child.kill("SIGKILL");
          reject(new Error("process did not exit within 10s of SIGTERM"));
        }, 10_000),
      ),
    ]);

    // Accept either clean exit (0) or signal-terminated (SIGTERM/SIGKILL),
    // both of which indicate the binary respected the shutdown request.
    const cleanCode = result.code === 0 || result.code === null;
    const signalled =
      result.signal === "SIGTERM" || result.signal === "SIGKILL" || result.signal === "SIGINT";
    expect(
      cleanCode || signalled,
      `unexpected exit: code=${result.code} signal=${result.signal} stderr=${stderrBuffer}`,
    ).toBe(true);
  });
});

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
