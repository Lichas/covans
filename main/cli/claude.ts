// main/cli/claude.ts — Claude Code CLI 适配器（claude -p --output-format stream-json）
//
// 注意：本机没有安装 claude CLI，此适配器按 Claude Code 的文档化非交互契约实现，
// 仅通过 scripts/fixtures/fake-cli.mjs 的假 CLI 做回归，尚未在真机验证。
// 事件词表：system(init) / assistant / user / result / stream_event。
import type { CliAdapter, CliInvocation, CliParser, CliTurnHandlers, CliTurnOutcome } from './types'
import { asNumber, asRecord, asString, createLineReader, extractText, parseJsonLine } from './types'

/** Claude 没有操作系统级沙箱，只能表达为权限模式。 */
const PERMISSION_MODE: Record<CliInvocation['cliAccess'], string> = {
  'read-only': 'plan',
  'workspace-write': 'acceptEdits',
}

function assistantText(message: Record<string, unknown>): string {
  const content = message.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return extractText(message)
  return content
    .map((part) => {
      const record = asRecord(part)
      if (!record) return typeof part === 'string' ? part : ''
      // 工具调用与思考不进入聊天正文。
      if (asString(record.type) !== 'text') return ''
      return asString(record.text)
    })
    .join('')
}

export const claudeAdapter: CliAdapter = {
  kind: 'claude-cli',
  defaultCommand: 'claude',
  // claude -p 没有附图参数，图片路径改写进提示词，由它自己的文件工具读取。
  acceptsImageArgs: false,

  buildArgs(invocation: CliInvocation): string[] {
    const args = ['-p', invocation.prompt, '--output-format', 'stream-json', '--verbose']
    if (invocation.sessionId) args.push('--resume', invocation.sessionId)
    args.push('--permission-mode', PERMISSION_MODE[invocation.cliAccess])
    return args
  },

  createParser(handlers: CliTurnHandlers): CliParser {
    const seen = new Set<string>()
    let sessionId = ''
    let failed = false
    let errorMessage = ''
    let inputTokens: number | null = null
    let outputTokens: number | null = null
    let text = ''

    const handleLine = (line: string): void => {
      const event = parseJsonLine(line)
      if (!event) return
      const type = asString(event.type)
      if (!type) return
      seen.add(type)

      const reported = asString(event.session_id)
      if (reported && reported !== sessionId) {
        sessionId = reported
        handlers.onSessionId(reported)
      }

      switch (type) {
        case 'system':
          // subtype=init 时携带会话信息；其余 system 事件仅记录。
          return
        case 'assistant': {
          const message = asRecord(event.message)
          const part = message ? assistantText(message) : extractText(event)
          if (part) {
            text += part
            handlers.onDelta(part)
          }
          handlers.onActivity('assistant', '')
          return
        }
        case 'user':
          // 工具结果回灌，不进入聊天正文。
          handlers.onActivity('tool_result', '')
          return
        case 'result': {
          const subtype = asString(event.subtype)
          const usage = asRecord(event.usage)
          if (usage) {
            inputTokens = asNumber(usage.input_tokens) ?? inputTokens
            outputTokens = asNumber(usage.output_tokens) ?? outputTokens
          }
          const finalText = asString(event.result)
          // 正文可能只出现在最终结果里（例如仅返回汇总文本时）。
          if (finalText && !text) {
            text = finalText
            handlers.onDelta(finalText)
          }
          if (event.is_error === true || (subtype && subtype !== 'success')) {
            failed = true
            errorMessage =
              asString(event.result) ||
              (subtype === 'error_max_turns'
                ? 'Claude 达到最大轮次限制'
                : 'Claude 运行失败')
          }
          return
        }
        default:
          handlers.onActivity(type, '')
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
