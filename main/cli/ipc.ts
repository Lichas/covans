// main/cli/ipc.ts — 本地 CLI 探测通道
import { ipcMain } from 'electron'
import { CH } from '../../shared/ipcChannels'
import type { LocalCliKind, LocalCliProbe } from '../../shared/types'
import { probeLocalCli } from './index'

const KINDS: LocalCliKind[] = ['codex-cli', 'claude-cli']

export function registerCliIpc(): void {
  ipcMain.handle(
    CH.probeLocalCli,
    (_event, kind: LocalCliKind, executablePath?: string): Promise<LocalCliProbe> => {
      if (!KINDS.includes(kind)) throw new Error('不支持的本地 CLI 类型')
      if (executablePath !== undefined && typeof executablePath !== 'string')
        throw new Error('CLI 路径必须是字符串')
      if (executablePath && (executablePath.length > 4096 || /[\r\n\0]/.test(executablePath)))
        throw new Error('CLI 路径不能包含换行或空字符')
      return probeLocalCli(kind, executablePath ?? '')
    },
  )
}
