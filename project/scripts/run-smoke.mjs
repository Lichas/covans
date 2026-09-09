// Match Electron's native-module ABI without rebuilding better-sqlite3 for the system Node.
import electron from 'electron'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const result = spawnSync(
  electron,
  [fileURLToPath(new URL('./smoke.mjs', import.meta.url))],
  {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'inherit',
  },
)
if (result.error) throw result.error
process.exit(result.status ?? 1)
