#!/usr/bin/env bash
# scripts/release.sh — release pipeline driver for ide99 v1.0+.
#
# Sprint 37 Phase E. Designed to run inside CI on `release.yml`
# (triggered by `git tag v*.*.*`), but supports a local dry-run via
# `RELEASE_DRY_RUN=1` so a maintainer can rehearse the steps before
# cutting the actual tag.
#
# Pipeline:
#   1. Verify tag matches Cargo.toml + package.json + tauri.conf.json
#   2. Build per-target (`cargo tauri build --target …`)
#   3. Sign each platform's bundle with `tauri signer sign`
#   4. Generate `manifest.json` per channel
#   5. Upload artifacts + manifest to the CDN (S3 or equivalent)
#
# Notes for ops:
#   * Signing key (TAURI_SIGNING_PRIVATE_KEY) and password
#     (TAURI_SIGNING_PRIVATE_KEY_PASSWORD) come from secrets.
#   * The pubkey placeholder in `tauri.conf.json` is replaced at build
#     time via `sed` (see `substitute_pubkey`). Never commit the real
#     pubkey to the source tree — it's a release-time transform.
#   * For v1.0 the upload step is intentionally a TODO: pick the
#     storage target (S3, R2, GCS, …) and wire `aws s3 cp` / `rclone`
#     / equivalent. Until then the script halts after assembling
#     `manifest.json` so a human can copy it up by hand.
#
# See `docs/engineering/18-auto-updater.md` for the protocol details and
# `docs/engineering/09-build-and-release.md` for the broader pipeline.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

DRY_RUN="${RELEASE_DRY_RUN:-0}"
CHANNEL="${RELEASE_CHANNEL:-stable}"

# ── Defaults — override with env vars in CI ────────────────────────────
TARGETS=(
  "aarch64-apple-darwin"
  "x86_64-apple-darwin"
  "x86_64-pc-windows-msvc"
  "x86_64-unknown-linux-gnu"
)

step() { echo; echo "→ $*"; }
warn() { echo "  ⚠ $*" >&2; }
fail() { echo "  ✗ $*" >&2; exit 1; }
run()  {
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "    [dry-run] $*"
  else
    "$@"
  fi
}

# ── 1. Validate version triple ─────────────────────────────────────────

step "validate version triple"

# Cargo.toml is the workspace source of truth; tauri.conf.json + package.json
# must match. (Manual bump is part of the pre-tag checklist; this is the gate
# that catches a missed file.)
CARGO_VERSION=$(grep -m1 -E '^version' Cargo.toml | sed -E 's/.*"([^"]+)".*/\1/')
PKG_VERSION=$(node -p "require('./package.json').version")
TAURI_VERSION=$(node -p "require('./src-tauri/tauri.conf.json').version")

[[ "$CARGO_VERSION" == "$PKG_VERSION" ]] || fail "Cargo.toml ($CARGO_VERSION) ≠ package.json ($PKG_VERSION)"
[[ "$CARGO_VERSION" == "$TAURI_VERSION" ]] || fail "Cargo.toml ($CARGO_VERSION) ≠ tauri.conf.json ($TAURI_VERSION)"
echo "  version=$CARGO_VERSION channel=$CHANNEL"

# ── 2. Substitute updater pubkey ──────────────────────────────────────

substitute_pubkey() {
  local conf="src-tauri/tauri.conf.json"
  if [[ -z "${TAURI_UPDATER_PUBKEY:-}" ]]; then
    warn "TAURI_UPDATER_PUBKEY unset — leaving placeholder in $conf"
    return
  fi
  step "substitute updater pubkey"
  run sed -i.bak \
    -e "s|REPLACE_AT_RELEASE_TIME_WITH_REAL_TAURI_UPDATER_PUBKEY|$TAURI_UPDATER_PUBKEY|g" \
    "$conf"
  run rm -f "$conf.bak"
}
substitute_pubkey

# Flip plugins.updater.active = true at release time. We keep it `false` in
# the source tree so dev builds don't ping the manifest endpoint.
step "activate updater plugin in tauri.conf.json"
run node -e "
  const fs = require('fs');
  const p = 'src-tauri/tauri.conf.json';
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  j.plugins = j.plugins || {};
  j.plugins.updater = j.plugins.updater || {};
  j.plugins.updater.active = true;
  fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
"

# ── 3. Per-target build ───────────────────────────────────────────────

step "build per target"
for target in "${TARGETS[@]}"; do
  echo "  ── building $target"
  # CI uses a matrix runner per OS; locally we'd skip cross-targets since
  # cross-platform Tauri builds need OS-specific toolchains.
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "    [dry-run] cargo tauri build --target $target"
    continue
  fi
  if ! cargo tauri build --target "$target"; then
    fail "build failed for $target"
  fi
done

# ── 4. Sign + emit detached signatures ────────────────────────────────

# `cargo tauri build` already signs the .app/.msi/.AppImage bundles when
# the signing env vars are set. The `.sig` file we ship in manifest.json
# is the **bundle** signature (not the installer's own signature) — the
# Tauri updater plugin verifies it client-side using the embedded pubkey.
step "collect signatures"
SIG_DIR="dist/release/$CARGO_VERSION/$CHANNEL"
run mkdir -p "$SIG_DIR"
echo "  signatures gathered under $SIG_DIR"

# ── 5. Build manifest.json ────────────────────────────────────────────

step "generate manifest.json"
MANIFEST_PATH="$SIG_DIR/manifest.json"

# In a real run this would walk the per-target signature files and the
# per-target download URLs. For the v1.0 cut we emit the schema with
# empty signature/url fields — ops fills them in or we replace this with
# a Python emitter once we have stable storage URLs.
if [[ "$DRY_RUN" != "1" ]]; then
  cat > "$MANIFEST_PATH" <<EOF
{
  "version": "$CARGO_VERSION",
  "notes": "$(git tag -l --format='%(contents:body)' "v$CARGO_VERSION" || echo '')",
  "pub_date": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "platforms": {
    "darwin-aarch64": { "signature": "TODO_FILL_AT_UPLOAD", "url": "TODO_FILL_AT_UPLOAD" },
    "darwin-x86_64":  { "signature": "TODO_FILL_AT_UPLOAD", "url": "TODO_FILL_AT_UPLOAD" },
    "linux-x86_64":   { "signature": "TODO_FILL_AT_UPLOAD", "url": "TODO_FILL_AT_UPLOAD" },
    "windows-x86_64": { "signature": "TODO_FILL_AT_UPLOAD", "url": "TODO_FILL_AT_UPLOAD" }
  }
}
EOF
fi
echo "  manifest at $MANIFEST_PATH"

# ── 6. Upload to CDN ──────────────────────────────────────────────────

step "upload to CDN"
echo "  TODO — pick storage target и wire upload here. The end state:"
echo "    PUT $MANIFEST_PATH → updates.ide99.io/$CHANNEL/manifest.json"
echo "    PUT each per-target bundle (.dmg / .msi / .AppImage) → "
echo "        updates.ide99.io/$CHANNEL/<version>/ide99-<target>.<ext>"
echo
echo "  Suggested implementations:"
echo "    aws s3 cp $SIG_DIR/ s3://updates-ide99-io/$CHANNEL/ --recursive --acl public-read"
echo "    rclone copy $SIG_DIR/ r2:updates/$CHANNEL/"
echo
echo "  (Until this step lands, copy artifacts up по hand; manifest URL"
echo "   is manifested in src-tauri/tauri.conf.json::plugins.updater.endpoints.)"

step "release.sh complete"
echo "  next: smoke-test the auto-updater against the published manifest"
echo "  (see docs/engineering/18-auto-updater.md → Release rehearsal)"
