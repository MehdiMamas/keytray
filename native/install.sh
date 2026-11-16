#!/usr/bin/env bash
# Registers the Keytray native messaging host with Chrome, Edge and Brave.
# Usage: native/install.sh [--enable | --allow-all] [extra-extension-id ...]
#   --enable     also write config.json with agentSignIn on (no site list)
#   --allow-all  like --enable, and allow all https sites
set -euo pipefail

CONFIG_MODE=""
IDS=()
for arg in "$@"; do
  case "$arg" in
    --enable) [ "$CONFIG_MODE" = allow-all ] || CONFIG_MODE=enable ;;
    --allow-all) CONFIG_MODE=allow-all ;;
    *) IDS+=("$arg") ;;
  esac
done

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOST_PATH="$HERE/keytray-agent.py"
CONFIG="$HERE/../wxt.config.ts"
STORE_ID="kfkmcgkbicdmgdodjjindmnpofbcmoji"

chmod +x "$HERE/keytray-agent.py" "$HERE/keytray-agent-cli.py"

# Dev id: sha256 of the DER public key, first 32 hex chars mapped 0-f to a-p.
DEV_ID="$(python3 - "$CONFIG" <<'PY'
import base64, hashlib, re, sys
text = open(sys.argv[1]).read()
key = re.search(r"EXTENSION_KEY\s*=\s*'([^']+)'", text).group(1)
digest = hashlib.sha256(base64.b64decode(key)).hexdigest()[:32]
print("".join(chr(ord("a") + int(c, 16)) for c in digest))
PY
)"

ORIGINS=""
for id in "$STORE_ID" "$DEV_ID" ${IDS[@]+"${IDS[@]}"}; do
  case "$ORIGINS" in *"chrome-extension://$id/"*) continue ;; esac
  ORIGINS="$ORIGINS\"chrome-extension://$id/\", "
done
ORIGINS="${ORIGINS%, }"

MANIFEST="{
  \"name\": \"com.keytray.agent\",
  \"description\": \"Keytray agent sign-in bridge\",
  \"path\": \"$HOST_PATH\",
  \"type\": \"stdio\",
  \"allowed_origins\": [$ORIGINS]
}"

case "$(uname -s)" in
  Darwin)
    DIRS=(
      "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
      "$HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts"
      "$HOME/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts"
    ) ;;
  *)
    DIRS=(
      "$HOME/.config/google-chrome/NativeMessagingHosts"
      "$HOME/.config/microsoft-edge/NativeMessagingHosts"
      "$HOME/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts"
    ) ;;
esac

for dir in "${DIRS[@]}"; do
  mkdir -p "$dir"
  printf '%s\n' "$MANIFEST" > "$dir/com.keytray.agent.json"
  echo "wrote $dir/com.keytray.agent.json"
done

if [ -n "$CONFIG_MODE" ]; then
  case "$(uname -s)" in
    Darwin) APPDIR="$HOME/Library/Application Support/Keytray" ;;
    *) APPDIR="${XDG_DATA_HOME:-$HOME/.local/share}/Keytray" ;;
  esac
  mkdir -p "$APPDIR"
  if [ "$CONFIG_MODE" = allow-all ]; then ALL=true; else ALL=false; fi
  TMP="$APPDIR/config.json.$$.tmp"
  printf '{"agentSignIn": true, "allowAll": %s}\n' "$ALL" > "$TMP"
  mv -f "$TMP" "$APPDIR/config.json"
  echo "wrote $APPDIR/config.json (agentSignIn on, allowAll $ALL)"
fi

echo "Store extension id: $STORE_ID"
echo "Dev (key) extension id: $DEV_ID"
echo "Host: $HOST_PATH"
if [ -z "$CONFIG_MODE" ]; then echo "Next: open Keytray Options and turn on Agent sign-in."; fi
