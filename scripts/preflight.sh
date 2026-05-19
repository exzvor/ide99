#!/usr/bin/env bash
# scripts/preflight.sh — local CI parity gate.
# Run before every push to catch failures locally instead of burning CI minutes.
# Tier 2 jobs are gated behind PR `ready_for_review` event in CI; this script
# is your local Tier 2 equivalent.

set -euo pipefail

cd "$(dirname "$0")/.."

step() {
  echo
  echo "→ $1"
}

step "cargo fmt --check"
cargo fmt --all -- --check

step "cargo clippy"
cargo clippy --workspace --all-targets -- -D warnings

step "cargo test (workspace)"
cargo test --workspace

if command -v docker > /dev/null 2>&1 && docker info > /dev/null 2>&1; then
  step "cargo test --test connection_integration"
  ( cd src-tauri && cargo test --test connection_integration )
else
  echo "⚠ Docker недоступен — пропускаем connection_integration"
fi

step "biome check"
npx biome check .

step "typecheck"
npm run typecheck

step "vitest"
npm test

step "vite build"
npm run build

echo
echo "✓ preflight passed"
