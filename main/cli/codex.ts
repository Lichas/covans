// main/cli/codex.ts — Codex CLI 适配器（codex exec --json）
//
// 事件词表取自 codex-cli 0.149.0 的真实输出与原生二进制内的标识符：
//   thread.started / turn.started / item.started|item.updated|item.completed /
//   turn.completed / turn.failed / error
// item.type ∈ agent_message | reasoning | command_execution | file_change | mcp_tool_call | ...
import type { CliAdapter, CliInvocation, CliParser, CliTurnHandlers, CliTurnOutcome } from './types'
import { asNumber, asRecord, asString, createLineReader, extractText, parseJsonLine } from './types'

const SANDBOX_FLAG: Record<CliInvocation['cliAccess'], string> = {
  'read-only': 'read-only',
  'workspace-write': 'workspace-write',
}

function fileChangePaths(item: Record<string, unknown>): string[] {
  const paths: string[] = []
  const changes = item.changes
  if (Array.isArray(changes)) {
    for (const change of changes) {
      const record = asRecord(change)
      const path = record ? asString(record.path) : ''
      if (path) paths.push(path)
    }
  }
  const single = asString(item.path)
  if (single) paths.push(single)
  return paths
}

export const codexAdapter: CliAdapter = {
  kind: 'codex-cli',
  defaultCommand: 'codex',
  acceptsImageArgs: true,

  buildArgs(invocation: CliInvocation): string[] {
    const imageArgs = invocation.imagePaths.flatMap((file) => ['-i', file])
    // 模型必须同时出现在新建与续接调用上：resume 不带 -m 会回退 CLI 默认模型，
    // 当账号的默认模型不可用或与建会话时不同，整轮会直接失败。
    const modelArgs = invocation.model.trim()
      ? ['-m', invocation.model.trim()]
      : []
    // resume 不支持 --sandbox / -C：沙箱与工作目录在首次会话建立时确定，
    // 之后由 codex 会话自身继承，因此这里只在新建会话时下发。
    if (invocation.sessionId)
      return [
        'exec',
        'resume',
        invocation.sessionId,
        '--json',
        '--skip-git-repo-check',
        ...modelArgs,
        ...imageArgs,
        invocation.prompt,
      ]
    return [
      'exec',
      '--json',
      '--sandbox',
      SANDBOX_FLAG[invocation.cliAccess],
      '-C',
      invocation.workspace,
      '--skip-git-repo-check',
      ...modelArgs,
      ...imageArgs,
      invocation.prompt,
    ]
  },

  createParser(handlers: CliTurnHandlers): CliParser {
    const itemText = new Map<string, string>()
    const seen = new Set<string>()
    let sessionId = ''
    let failed = false
    let errorMessage = ''
    let inputTokens: number | null = null
    let outputTokens: number | null = null
    let text = ''

    const handleItem = (item: Record<string, unknown>): void => {
      const type = asString(item.type) || 'unknown'
      seen.add(type)
      const id = asString(item.id) || `${type}:${itemText.size}`
      switch (type) {
        case 'agent_message': {
          const full = extractText(item)
          if (!full) return
          const previous = itemText.get(id) ?? ''
          // item.updated 可能持续追加；只把新增部分作为增量发出。
          const delta = full.startsWith(previous) ? full.slice(previous.length) : full
          itemText.set(id, full.startsWith(previous) ? full : previous + full)
          if (delta) {
            text += delta
            handlers.onDelta(delta)
          }
          return
        }
        case 'reasoning':
          handlers.onActivity('reasoning', '')
          return
        case 'command_execution': {
          const command = asString(item.command)
          handlers.onActivity('command', command.slice(0, 200))
          return
        }
        case 'file_change': {
          for (const path of fileChangePaths(item)) {
            handlers.onArtifact(path)
          }
          handlers.onActivity('file_change', '')
          return
        }
        case 'mcp_tool_call':
          handlers.onActivity('mcp_tool_call', asString(item.tool) || asString(item.name))
          return
        case 'error': {
          // 单条 item 级错误多为告警（例如服务档位、模型元数据），不直接判定失败。
          const message = asString(item.message)
          if (message && !errorMessage) errorMessage = message
          return
        }
        default:
          handlers.onActivity(type, '')
      }
    }

    const handleLine = (line: string): void => {
      const event = parseJsonLine(line)
      if (!event) return
      const type = asString(event.type)
      if (!type) return
      seen.add(type)
      switch (type) {
        case 'thread.started': {
          const id = asString(event.thread_id)
          if (id) {
            sessionId = id
            handlers.onSessionId(id)
          }
          return
        }
        case 'item.started':
        case 'item.updated':
        case 'item.completed': {
          const item = asRecord(event.item)
          if (item) handleItem(item)
          return
        }
        case 'turn.completed': {
          const usage = asRecord(event.usage)
          if (usage) {
            inputTokens = asNumber(usage.input_tokens) ?? inputTokens
            outputTokens = asNumber(usage.output_tokens) ?? outputTokens
          }
          return
        }
        case 'turn.failed': {
          failed = true
          const error = asRecord(event.error)
          const message = error ? asString(error.message) : ''
          errorMessage = message || errorMessage || 'Codex 运行失败'
          return
        }
        case 'error': {
          const message = asString(event.message)
          if (message) errorMessage = message
          return
        }
        default:
          return
      }
    }

    const reader = createLineReader(handleLine)
    return {
      push(chunk) {
        reader.push(chunk)
      },
      finish(): CliTurnOutcome {
        reader.flush()
        return {
          sessionId,
          text,
          failed,
          errorMessage,
          inputTokens,
          outputTokens,
          seenEventTypes: [...seen].sort(),
        }
      },
    }
  },
}
