// Read only the CLI model catalog: never start a thread/turn or retrieve credentials.
import { spawn } from 'node:child_process'
import os from 'node:os'
import type { LocalCliModel, LocalCliModelCatalog } from '../../shared/types'
import { asRecord, asString, createLineReader, parseJsonLine } from './types'

export function readCodexModels(
  executable: string,
  env: NodeJS.ProcessEnv,
): Promise<LocalCliModelCatalog> {
  return new Promise((resolve) => {
    const child = spawn(executable, ['app-server', '--listen', 'stdio://'], {
      cwd: os.tmpdir(), env, stdio: ['pipe', 'pipe', 'ignore'],
    })
    const models = new Map<string, LocalCliModel>()
    const cursors = new Set<string>()
    let settled = false
    let bytes = 0
    let requestId = 1
    let pages = 0
    const timer = setTimeout(() => finish('读取 CLI 模型超时，请刷新重试。'), 15_000)
    const finish = (error?: string) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.stdin.end()
      child.kill('SIGTERM')
      // A broken CLI must not leave an app-server behind after the UI closes.
      const killTimer = setTimeout(() => child.kill('SIGKILL'), 1000)
      killTimer.unref()
      child.once('close', () => clearTimeout(killTimer))
      resolve({ source: 'cli', models: error ? [] : [...models.values()], ...(error ? { error } : {}) })
    }
    const send = (message: unknown) => {
      if (!settled) child.stdin.write(JSON.stringify(message) + '\n')
    }
    const readPage = (cursor?: string) => {
      pages++
      send({ id: ++requestId, method: 'model/list', params: {
        limit: 100, includeHidden: false, ...(cursor ? { cursor } : {}),
      } })
    }
    const reader = createLineReader((line) => {
      if (settled) return
      const message = parseJsonLine(line)
      if (!message || message.id !== requestId) return
      if (message.error) {
        finish('当前 CLI 无法读取模型目录，请确认版本和登录状态后重试。')
        return
      }
      const result = asRecord(message.result)
      if (!result) {
        finish('CLI 返回了无效的模型目录。')
        return
      }
      if (requestId === 1) {
        send({ method: 'initialized' })
        readPage()
        return
      }
      if (!Array.isArray(result.data)) {
        finish('CLI 返回了无效的模型目录。')
        return
      }
      for (const item of result.data) {
        const model = asRecord(item)
        if (!model || model.hidden === true) continue
        const id = asString(model.model).trim()
        if (!id || id.length > 256 || /[\r\n\0]/.test(id)) continue
        models.set(id, {
          id,
          name: (asString(model.displayName) || id).replace(/[\r\n\0]/g, '').slice(0, 160),
          recommended: model.isDefault === true,
        })
      }
      const cursor = asString(result.nextCursor)
      if (cursor) {
        if (pages >= 10 || cursors.has(cursor)) {
          finish('CLI 模型目录分页异常，请刷新重试。')
          return
        }
        cursors.add(cursor)
        readPage(cursor)
      } else {
        finish(models.size ? undefined : 'CLI 未返回可选模型，请确认已登录。')
      }
    })
    child.stdout.on('data', (chunk: Buffer) => {
      bytes += chunk.length
      if (bytes > 2_000_000) finish('CLI 模型目录响应过大。')
      else reader.push(chunk.toString('utf8'))
    })
    child.stdin.on('error', () => finish('无法连接 CLI 模型目录。'))
    child.on('error', () => finish('无法启动 CLI 读取模型目录。'))
    child.on('close', () => {
      reader.flush()
      finish('CLI 在返回模型目录前退出。')
    })
    send({ id: 1, method: 'initialize', params: {
      clientInfo: { name: 'covan', title: 'Covan', version: '0.1.0' },
    } })
  })
}
