#!/usr/bin/env bash
# Installs global hotkeys for Nova Agent on GNOME (Ubuntu default desktop).
# Uses GNOME custom keybindings, so it costs ZERO extra RAM in the agent process.
#
#   Ctrl+Alt+A  start agent      (systemd user service or nohup)
#   Ctrl+Alt+S  stop agent run   (POST /api/stop)
#   Ctrl+Alt+R  restart agent
#   Ctrl+Alt+T  open terminal attached to the agent
#   Ctrl+Alt+L  open dashboard in browser
#
# Usage: bash scripts/install-hotkeys.sh [port]

set -euo pipefail
PORT="${1:-3000}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

BASE="org.gnome.settings-daemon.plugins.media-keys"
KEYPATH="/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings"

add_binding() {
  local idx="$1" name="$2" cmd="$3" binding="$4"
  local path="$KEYPATH/nova$idx/"
  gsettings set "$BASE.custom-keybinding:$path" name "$name"
  gsettings set "$BASE.custom-keybinding:$path" command "$cmd"
  gsettings set "$BASE.custom-keybinding:$path" binding "$binding"
  echo "  $binding -> $name"
}

echo "Installing Nova Agent hotkeys (GNOME)..."

# Merge our custom binding paths into the existing list.
EXISTING=$(gsettings get "$BASE" custom-keybindings)
NEW_PATHS=""
for i in 0 1 2 3 4; do
  P="'$KEYPATH/nova$i/'"
  if [[ "$EXISTING" != *"$P"* ]]; then NEW_PATHS="$NEW_PATHS, $P"; fi
done
if [[ -n "$NEW_PATHS" ]]; then
  if [[ "$EXISTING" == "@as []" || "$EXISTING" == "[]" ]]; then
    gsettings set "$BASE" custom-keybindings "[${NEW_PATHS#, }]"
  else
    gsettings set "$BASE" custom-keybindings "${EXISTING%]}${NEW_PATHS}]"
  fi
fi

add_binding 0 "Nova: start"     "bash -c 'cd $DIR && (pgrep -f \"node.*dist/index.js\" || nohup npm start >/dev/null 2>&1 &)'" "<Ctrl><Alt>a"
add_binding 1 "Nova: stop run"  "curl -s -X POST http://localhost:$PORT/api/stop" "<Ctrl><Alt>s"
add_binding 2 "Nova: restart"   "bash -c 'pkill -f \"node.*dist/index.js\"; sleep 1; cd $DIR && nohup npm start >/dev/null 2>&1 &'" "<Ctrl><Alt>r"
add_binding 3 "Nova: terminal"  "gnome-terminal -- bash -c 'cd $DIR && npm start'" "<Ctrl><Alt>t"
add_binding 4 "Nova: dashboard" "xdg-open http://localhost:$PORT" "<Ctrl><Alt>l"

echo "Done. Hotkeys are active immediately."
