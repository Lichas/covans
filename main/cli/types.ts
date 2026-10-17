// main/cli/types.ts — 本地 CLI 运行后端的共享契约（仅主进程使用）
import type { CliAccess, LocalCliKind } from '../../shared/types'

/** 一次 CLI 运行需要的输入。sessionId 为空表示新建会话。 */
export interface CliInvocation {
  prompt: string
  sessionId: string
  cliAccess: CliAccess
  workspace: string
  imagePaths: string[]
  /** Bot 指定的模型；为空时使用 CLI 自己的默认模型。 */
  model: string
}

/** 解析过程中向运行时转发的增量信息。 */
export interface CliTurnHandlers {
  /** 新增的可见正文（增量，不是全量）。 */
  onDelta(text: string): void
  /** CLI 报告的会话 ID，用于后续续接。 */
  onSessionId(id: string): void
  /** CLI 本轮真实写入或修改的工作区文件（相对工作区根目录）。 */
  onArtifact(relPath: string): void
  /** 供观测记录的活动类别，不进入聊天正文。 */
  onActivity(kind: string, label: string): void
}

export interface CliTurnOutcome {
  sessionId: string
  text: string
  failed: boolean
  errorMessage: string
  inputTokens: number | null
  outputTokens: number | null
  /** 观测用：本轮实际收到的事件类型集合，不含内容。 */
  seenEventTypes: string[]
}

export interface CliParser {
  /** 送入一段 stdout 文本（内部按行缓冲）。 */
  push(chunk: string): void
  /** stdout 结束后收尾，返回本轮结果。 */
  finish(): CliTurnOutcome
}

export interface CliAdapter {
  readonly kind: LocalCliKind
  /** 默认可执行文件名（PATH 中查找）。 */
  readonly defaultCommand: string
  /** 是否支持通过命令行参数附图；不支持时图片路径改写进提示词。 */
  readonly acceptsImageArgs: boolean
  buildArgs(invocation: CliInvocation): string[]
  createParser(handlers: CliTurnHandlers): CliParser
}

/** 按行切分流式 stdout，避免半行被当作完整 JSON。 */
export function createLineReader(onLine: (line: string) => void): {
  push(chunk: string): void
  flush(): void
} {
  let buffer = ''
  return {
    push(chunk) {
      buffer += chunk
      let index = buffer.indexOf('\n')
      while (index >= 0) {
        const line = buffer.slice(0, index).trim()
        buffer = buffer.slice(index + 1)
        if (line) onLine(line)
        index = buffer.indexOf('\n')
      }
    },
    flush() {
      const line = buffer.trim()
      buffer = ''
      if (line) onLine(line)
    },
  }
}

export function parseJsonLine(line: string): Record<string, unknown> | null {
  if (!line.startsWith('{') && !line.startsWith('[')) return null
  try {
    const value = JSON.parse(line)
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

export function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/**
 * 从不同版本的 CLI 事件里提取正文。
 * Codex/Claude 的历史版本用过 text / content / content_items / message 等字段，
 * 这里按优先级兼容，避免只认一种写法时静默产出空回复。
 */
export function extractText(item: Record<string, unknown>): string {
  const direct = asString(item.text)
  if (direct) return direct
  const content = item.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const text = content
      .map((part) => {
        if (typeof part === 'string') return part
        const record = asRecord(part)
        return record ? asString(record.text) : ''
      })
      .join('')
    if (text) return text
  }
  const items = item.content_items
  if (Array.isArray(items)) {
    const text = items
      .map((part) => {
        if (typeof part === 'string') return part
        const record = asRecord(part)
        if (!record) return ''
        return asString(record.text) || asString(record.delta)
      })
      .join('')
    if (text) return text
  }
  return asString(item.message)
}
