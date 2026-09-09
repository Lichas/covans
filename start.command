#!/bin/zsh
set -e

# Double-click in Finder, or run ./start.command from any working directory.
SCRIPT_DIR="${0:A:h}"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
cd "$SCRIPT_DIR"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  print "请先安装 Node.js 22.19 或更高版本，然后重新运行。"
  read "?按回车关闭…"
  exit 1
fi

node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 22 || (major === 22 && minor < 19)) { console.error("需要 Node.js >= 22.19"); process.exit(1); }'

if [[ ! -d node_modules ]]; then
  npm ci --ignore-scripts --registry=https://registry.npmjs.org
  npx --no-install electron-builder install-app-deps
fi

# npm --ignore-scripts skips Electron's binary download on a fresh checkout.
if [[ ! -f node_modules/electron/path.txt ]]; then
  node node_modules/electron/install.js
fi

# Use Electron's embedded Node to check native ABI, independent of system Node.
ELECTRON_BIN="$(node -p 'require("electron")')"
if ! ELECTRON_RUN_AS_NODE=1 "$ELECTRON_BIN" -e 'const Database = require("better-sqlite3"); new Database(":memory:").close()' >/dev/null 2>&1; then
  print "正在修复 Electron 原生依赖…"
  npx --no-install electron-builder install-app-deps
fi

print "启动 Covan… 关闭此终端或按 Ctrl+C 可结束开发服务。"
exec npm run dev
