# Contributing to ide99

Thanks for your interest in contributing.

## Reporting bugs

File an issue using the [bug template](.github/ISSUE_TEMPLATE/bug.yml). Please include:
- ide99 version (`Help → About`)
- Operating system and version
- PostgreSQL version
- Minimal reproduction steps
- Expected vs actual behavior

Issues that cannot be reproduced will be closed.

## Proposing features

Open an issue using the [feature template](.github/ISSUE_TEMPLATE/feature.yml). Describe the user problem and your proposed solution. For larger ideas, please open a discussion in [GitHub Discussions](https://github.com/exzvor/ide99/discussions) first.

## Pull requests

1. Fork the repo and create a feature branch from `main`.
2. Make focused changes — one logical change per PR.
3. Run the local checks (see below).
4. Sign off your commits with the Developer Certificate of Origin (DCO):
   ```
   git commit -s -m "..."
   ```
   The `Signed-off-by:` trailer certifies that you wrote the patch or otherwise have the right to submit it under the project's license.
5. Open the PR using the template. Link any related issue.

PRs are reviewed against the existing code style, test coverage, and architectural fit. Substantial changes without prior discussion may be asked to first land as an issue or discussion.

## Local development

Prerequisites: Node.js 20+, Rust stable, [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your OS.

```bash
npm install
npm run tauri dev           # dev mode with hot reload
```

Useful scripts:

```bash
npm run typecheck           # tsc --noEmit
npm run lint                # biome
npm run test                # vitest
cd src-tauri && cargo test  # Rust unit tests
cd src-tauri && cargo clippy -- -D warnings
```

E2E tests (require Playwright browsers):

```bash
npm run test:e2e
```

## Code style

- **TypeScript / React**: enforced by `biome` (`npm run lint`).
- **Rust**: `cargo fmt` + `cargo clippy -- -D warnings`. The workspace pins clippy to default groups; pedantic / nursery lints are opt-in for cleanup work.
- **Comments**: write in English. Comment the *why* when it's non-obvious; let well-named identifiers carry the *what*.

## License

By contributing, you agree that your contributions will be licensed under the [Apache License 2.0](./LICENSE).
