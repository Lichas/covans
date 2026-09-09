#!/bin/zsh
set -e

# Restart only Covan's local development process. This intentionally does not
# match other Electron applications running on the machine.
SCRIPT_DIR="${0:A:h}"
PROJECT_DIR="$SCRIPT_DIR/project"
VITE_PROCESS="$PROJECT_DIR/node_modules/.bin/electron-vite dev"
ELECTRON_PROCESS="$PROJECT_DIR/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron \."

if pgrep -f "$VITE_PROCESS" >/dev/null 2>&1; then
  print "正在关闭已有的 Covan…"
  pkill -TERM -f "$VITE_PROCESS" || true
fi
if pgrep -f "$ELECTRON_PROCESS" >/dev/null 2>&1; then
  pkill -TERM -f "$ELECTRON_PROCESS" || true
fi

# Give Electron a moment to release the Vite port before launching again.
sleep 1
exec "$SCRIPT_DIR/start.command"
