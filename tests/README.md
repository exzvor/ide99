# ide99 tests

This directory holds end-to-end smoke tests that exercise the built
ide99 binary. Unit + component tests live next to their sources under
`src/` and run via `npm test` (Vitest).

## Layout

```
tests/
├── e2e/
│   ├── playwright.config.ts   # workers:1, no browser projects — Playwright runs as a test runner
│   └── launch.spec.ts         # spawn ide99 binary, wait for READY, assert clean exit
└── README.md                  # this file
```

The e2e suite uses Playwright purely as a test runner — no browser is
launched. `launch.spec.ts` spawns the native ide99 binary, waits for the
`READY` handshake on stdout (printed by `src-tauri/src/lib.rs` once the
main window is shown), and asserts the process shuts down cleanly on
`SIGTERM`.

## Run e2e locally

1. Build the frontend bundle and the release binary:

   ```bash
   npm run build
   cargo tauri build --release --no-bundle
   ```

2. Run the suite, pointing `IDE99_BINARY` at the freshly built executable:

   ```bash
   # macOS / Linux
   IDE99_BINARY=src-tauri/target/release/ide99 \
     npx playwright test --config tests/e2e/playwright.config.ts

   # Windows (PowerShell)
   $env:IDE99_BINARY = "src-tauri\target\release\ide99.exe"
   npx playwright test --config tests/e2e/playwright.config.ts
   ```

   The shorthand `npm run test:e2e` works once `package.json` points the
   script at `tests/e2e/playwright.config.ts` (e.g.
   `"test:e2e": "playwright test --config tests/e2e/playwright.config.ts"`).
   See the **Integration note** below.

3. The single test (`launches and exits cleanly`) auto-skips when
   `IDE99_BINARY` is unset and no binary exists at the conventional
   fallback path — that keeps local `npm test` runs green before the
   release build is done.

## Run cold-start benchmark locally

```bash
IDE99_BINARY=src-tauri/target/release/ide99 \
  cargo bench --bench cold_start --manifest-path src-tauri/Cargo.toml
jq '.median.point_estimate' \
  src-tauri/target/criterion/cold_start/spawn_to_ready/new/estimates.json
```

The CI gate fails if the median exceeds 2,000,000,000 ns (2 s).

## CI

The matrix `tauri-build → e2e` jobs in `.github/workflows/ci.yml`:

1. Build the release binary on each OS.
2. Measure size (fail if >30 MB).
3. Run the cold-start bench and parse `target/criterion/.../estimates.json`
   (fail if median >2 s).
4. Upload the binary + criterion report as an artifact.
5. Download the artifact in the `e2e` job and run this Playwright suite
   against it (`xvfb-run` is used on Linux runners).

## Integration note

`tests/e2e/playwright.config.ts` lives under `tests/e2e/` so the suite is
self-contained. Playwright does not auto-discover configs outside the
project root, so `npm run test:e2e` must invoke
`playwright test --config tests/e2e/playwright.config.ts`. Updating
`package.json` is owned by the integration step (sub-agent A does not
modify root config files).
