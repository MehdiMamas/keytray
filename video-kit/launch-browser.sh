#!/bin/bash
# Starts Chrome for Testing with the Keytray build, a fresh profile and the demo page.
# No automation flags. Usage: launch-browser.sh [url]   (set KEEP_PROFILE=1 to reuse the profile)
KIT="$(cd "$(dirname "$0")" && pwd)"
APP="$(ls -d "$KIT"/browsers/chrome/*/chrome-mac-arm64/"Google Chrome for Testing.app" | tail -1)"
BUILD="$(cd "$KIT/.." && pwd)/.output/chrome-mv3"
PROFILE="$KIT/profile"
URL="${1:-http://127.0.0.1:8765/}"
[ -f "$BUILD/manifest.json" ] || { echo "build missing: run npm run build"; exit 1; }
[ "$KEEP_PROFILE" = 1 ] || rm -rf "$PROFILE"
mkdir -p "$PROFILE/Default"
# Pin Keytray to the toolbar so the popup is one click away.
[ -f "$PROFILE/Default/Preferences" ] || echo '{"extensions":{"pinned_extensions":["kfkmcgkbicdmgdodjjindmnpofbcmoji"]}}' > "$PROFILE/Default/Preferences"
exec "$APP/Contents/MacOS/Google Chrome for Testing" \
  --user-data-dir="$PROFILE" \
  --load-extension="$BUILD" \
  --lang=en-US \
  --window-position=0,0 --window-size=1280,800 \
  --no-first-run --no-default-browser-check --test-type --disable-sync \
  --disable-features=SigninInterceptBubble,ChromeLabs \
  "$URL"
