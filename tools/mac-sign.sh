#!/bin/bash
# Re-signs the built Mac app with a STABLE identity and rebuilds the .dmg and the updater archive.
#
# Without an Apple Developer ID the app is ad-hoc signed, and macOS then identifies it by a hash of its
# code, which changes on every build. Folder permissions (Desktop/Documents/Downloads) are remembered
# per identity, so every update looked like a brand-new app and asked again. A designated requirement
# that names the bundle id makes the identity the same across builds.
# Usage: tools/mac-sign.sh <bundle dir containing macos/Transfer.app> [sign-updater]
set -euo pipefail
B="$1"
APP="$B/macos/Transfer.app"
ID="com.nathan.transfer"
codesign --force --deep --sign - -r="designated => identifier \"$ID\"" "$APP"
codesign --verify --deep --strict "$APP"
codesign -d -r- "$APP" 2>&1 | grep -q "$ID"

V=$(node -p "require('./src-tauri/tauri.conf.json').version")
DMG="$(ls "$B"/dmg/*.dmg | head -1)"
S="$(mktemp -d)"
cp -R "$APP" "$S/"
ln -s /Applications "$S/Applications"
rm -f "$DMG"
hdiutil create -volname "Transfer" -srcfolder "$S" -ov -format UDZO "$DMG"
rm -rf "$S"

if [ "${2:-}" = "sign-updater" ]; then
  TAR="$B/macos/Transfer.app.tar.gz"
  rm -f "$TAR" "$TAR.sig"
  tar -czf "$TAR" -C "$B/macos" Transfer.app
  npx tauri signer sign "$TAR"
fi
echo "re-signed Transfer $V with stable identity $ID"
