#!/usr/bin/env bash
# scripts/ci/build-macos-pkg.sh — wrap target/release/bundle/macos/ide99.app
# into a .pkg installer with a postinstall script that strips
# com.apple.quarantine and re-applies the ad-hoc seal on the installed
# bundle.
#
# Why: until Apple Developer ID is provisioned, every bundle is ad-hoc
# signed. .dmg distribution leaves quarantine attached to the copied
# .app and Gatekeeper re-verifies on every launch, where the ad-hoc seal
# often fails. The .pkg form lets us run a privileged postinstall that
# finalises the install on the user's machine — one Gatekeeper warning
# to dismiss when launching the .pkg, then zero on subsequent launches.
# Once Developer ID is in place, we sign + notarise the .pkg with the
# same script flow and the dismissal disappears too.
#
# Usage:
#   build-macos-pkg.sh
#     reads version from src-tauri/tauri.conf.json
#     expects target/release/bundle/macos/ide99.app to exist
#     emits  target/release/bundle/pkg/ide99_${VERSION}_${ARCH}.pkg

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

APP_PATH="target/release/bundle/macos/ide99.app"
[[ -d "$APP_PATH" ]] \
  || { echo "::error:: $APP_PATH not found — run \`cargo tauri build\` first" >&2; exit 1; }

VERSION=$(node -p "require('./src-tauri/tauri.conf.json').version")
IDENT=$(node -p "require('./src-tauri/tauri.conf.json').identifier")
ARCH=$(uname -m)
case "$ARCH" in
  arm64)  ARCH_TAG="aarch64" ;;
  x86_64) ARCH_TAG="x86_64"  ;;
  *) echo "::error:: unsupported arch $ARCH" >&2; exit 2 ;;
esac

OUT_DIR="target/release/bundle/pkg"
OUT_PKG="$OUT_DIR/ide99_${VERSION}_${ARCH_TAG}.pkg"
mkdir -p "$OUT_DIR"

STAGING=$(mktemp -d -t ide99-pkg)
trap 'rm -rf "$STAGING"' EXIT

# pkgbuild expects --root to contain the file tree that will land at
# --install-location. We want ide99.app to end up at /Applications, so
# --root is a dir containing only the .app and --install-location is
# /Applications.
ROOT="$STAGING/root"
SCRIPTS="$STAGING/scripts"
mkdir -p "$ROOT" "$SCRIPTS"
cp -R "$APP_PATH" "$ROOT/"

# The postinstall runs as root after the install copies files. macOS
# passes the target volume in $3; in practice it's always "/" on the
# user's startup disk. We harden by hard-coding the path we wrote.
cat > "$SCRIPTS/postinstall" <<'POSTINSTALL'
#!/bin/bash
# postinstall — finalise the install on the user's machine.
#   1. clear com.apple.quarantine so Gatekeeper doesn't gate every launch
#   2. re-apply ad-hoc signature to repair any xattr-induced seal drift
#   3. launch the app as the console user so they see immediate feedback
# All steps best-effort; postinstall must exit 0 or the installer reports
# failure to the user even though files are already in place.

set +e

APP="/Applications/ide99.app"

if [[ -d "$APP" ]]; then
  /usr/bin/xattr -rd com.apple.quarantine "$APP" 2>/dev/null
  /usr/bin/codesign --force --deep --sign - "$APP" >/dev/null 2>&1

  # Launch as the user who's currently logged into the GUI, not as root.
  GUI_USER=$(/usr/bin/stat -f "%Su" /dev/console 2>/dev/null)
  if [[ -n "$GUI_USER" && "$GUI_USER" != "root" ]]; then
    /usr/bin/sudo -u "$GUI_USER" /usr/bin/open "$APP" >/dev/null 2>&1 &
  fi
fi

exit 0
POSTINSTALL
chmod 755 "$SCRIPTS/postinstall"

echo "→ pkgbuild → $OUT_PKG"
pkgbuild \
  --root "$ROOT" \
  --identifier "$IDENT.installer" \
  --version "$VERSION" \
  --install-location "/Applications" \
  --scripts "$SCRIPTS" \
  --ownership recommended \
  "$OUT_PKG"

# Quick sanity check — installer-payload component must contain the app.
pkgutil --payload-files "$OUT_PKG" | grep -q "^./ide99.app/Contents/MacOS/ide99$" \
  || { echo "::error:: pkg payload missing ide99 binary" >&2; exit 3; }

SIZE=$(stat -f "%z" "$OUT_PKG")
echo "  size: $((SIZE / 1024 / 1024)) MB"
echo "  identifier: $IDENT.installer"
echo "  version: $VERSION"
echo "  arch: $ARCH_TAG"
echo
echo "Готово. .pkg создан, postinstall встроен."
