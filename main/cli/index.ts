// main/cli/index.ts — 本地 CLI 运行后端：可执行文件解析、探测、会话续接与流式运行
//
// 设计要点（SPEC §5.8）：
// - Covan 数据库仍是聊天记录的唯一事实来源；CLI 只持有自己那一份会话上下文。
// - 首次发言建立 CLI 会话并附带人设/记忆/转录；之后按会话续接，只发送新的用户消息。
// - 清空聊天记录、开始新话题或修改运行方式/工作区后，指纹变化即重新建立会话。
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { contentText, type Message as PiMessage } from '@earendil-works/pi-ai'
import type {
  Bot,
  LocalCliKind,
  LocalCliProbe,
  WorkspaceArtifact,
} from '../../shared/types'
import type { AgentCallbacks, RunAgentOptions } from '../agentRuntime'
import * as db from '../db'
import { observe } from '../observability'
import { describeWorkspaceArtifact, ensureWorkspace } from '../workspace'
import { claudeAdapter } from './claude'
import { codexAdapter } from './codex'
import type { CliAdapter, CliInvocation, CliTurnHandlers, CliTurnOutcome } from './types'

const PROBE_TIMEOUT_MS = 10_000
const MAX_STDERR_CHARS = 4_000
const VERSION_PATTERN = /\d+\.\d+\.\d+(?:[-+][\w.]+)?/

const ADAPTERS: Record<LocalCliKind, CliAdapter> = {
  'codex-cli': codexAdapter,
  'claude-cli': claudeAdapter,
}

export function isCliBot(bot: Bot): boolean {
  return bot.backend === 'codex-cli' || bot.backend === 'claude-cli'
}

function cliKindOf(bot: Bot): LocalCliKind {
  if (!isCliBot(bot)) throw new Error('该 Bot 不是本地 CLI 运行方式')
  return bot.backend as LocalCliKind
}

/** 运行方式、可执行文件、权限或工作区任一变化都需要重建 CLI 会话。 */
export function cliFingerprint(bot: Bot): string {
  return [bot.backend, bot.cli_path.trim(), bot.cli_access, bot.workspace_dir].join('|')
}

/**
 * CLI 需要用户真实的 HOME（登录态与配置都在那里），
 * 但 GUI 启动的 Electron 往往拿不到完整 PATH，因此补齐常见安装目录。
 */
function cliEnvironment(): NodeJS.ProcessEnv {
  const home = os.homedir()
  const entries = (process.env.PATH || '').split(path.delimiter).filter(Boolean)
  for (const extra of [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    path.join(home, '.local', 'bin'),
    path.join(home, '.bun', 'bin'),
    path.join(home, '.cargo', 'bin'),
    path.join(home, '.npm-global', 'bin'),
  ]) {
    if (!entries.includes(extra)) entries.push(extra)
  }
  return { ...process.env, HOME: home, PATH: entries.join(path.delimiter) }
}

function expandHome(value: string): string {
  if (value === '~') return os.homedir()
  if (value.startsWith('~/')) return path.join(os.homedir(), value.slice(2))
  return value
}

/** 在补齐后的 PATH 中查找可执行文件；显式路径优先且必须存在。 */
function resolveExecutable(
  command: string,
  explicitPath: string,
  env: NodeJS.ProcessEnv,
): string {
  if (explicitPath.trim()) {
    const candidate = expandHome(explicitPath.trim())
    let stat: fs.Stats
    try {
      stat = fs.statSync(candidate)
    } catch {
      throw new Error(`找不到 CLI 可执行文件：${candidate}`)
    }
    if (!stat.isFile()) throw new Error(`CLI 路径不是文件：${candidate}`)
    return candidate
  }
  const suffixes = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : ['']
  for (const dir of (env.PATH || '').split(path.delimiter)) {
    if (!dir) continue
    for (const suffix of suffixes) {
      const candidate = path.join(dir, command + suffix)
      try {
        if (fs.statSync(candidate).isFile()) return candidate
      } catch {
        /* 继续查找 */
      }
    }
  }
  throw new Error(
    `未找到 ${command} 命令。请先安装并确认已登录，或在 Bot 设置中填写完整路径。`,
  )
}

function runVersion(
  executable: string,
  env: NodeJS.ProcessEnv,
): Promise<{ ok: boolean; output: string; error: string }> {
  return new Promise((resolve) => {
    const child = spawn(executable, ['--version'], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      resolve({ ok: false, output: '', error: '探测版本超时' })
    }, PROBE_TIMEOUT_MS)
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    child.on('error', (error: Error) => {
      clearTimeout(timer)
      resolve({ ok: false, output: '', error: error.message })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({
        ok: code === 0,
        output: stdout.trim(),
        error: code === 0 ? '' : stderr.trim() || `退出码 ${code}`,
      })
    })
  })
}

/** 探测本地 CLI：是否安装、实际路径与版本。不读取登录凭据。 */
export async function probeLocalCli(
  kind: LocalCliKind,
  executablePath = '',
): Promise<LocalCliProbe> {
  const adapter = ADAPTERS[kind]
  if (!adapter) return { kind, available: false, path: '', version: '', error: '不支持的 CLI 类型' }
  const env = cliEnvironment()
  let executable = ''
  try {
    executable = resolveExecutable(adapter.defaultCommand, executablePath, env)
  } catch (error) {
    return {
      kind,
      available: false,
      path: '',
      version: '',
      error: error instanceof Error ? error.message : String(error),
    }
  }
  const result = await runVersion(executable, env)
  const version = (result.output.match(VERSION_PATTERN) || [''])[0]
  if (!result.ok && !result.output)
    return { kind, available: false, path: executable, version, error: result.error }
  return { kind, available: true, path: executable, version, error: '' }
}

// ---------- 提示词构建 ----------

function transcriptText(messages: PiMessage[]): string {
  return messages
    .map((message) => {
      const text = contentText(message.content).trim()
      const who = message.role === 'assistant' ? '我' : '用户'
      return text ? `[${who}]: ${text}` : ''
    })
    .filter(Boolean)
    .join('\n')
}

function latestUserText(messages: PiMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') return contentText(messages[i].content).trim()
  }
  return ''
}

/** 首次发言：人设 + 记忆 + 既有转录一并交给 CLI，作为它这一会话的起点。 */
function bootstrapPrompt(systemPrompt: string, messages: PiMessage[]): string {
  const parts = [
    systemPrompt.trim(),
    transcriptText(messages) ? `## 已发生的对话\n${transcriptText(messages)}` : '',
    '以上是同一会话此前的对话。请以「我」的身份继续，直接回复最新一条用户消息，不要复述整段历史。',
  ]
  return parts.filter(Boolean).join('\n\n')
}

function imageExtension(mime: string): string {
  switch (mime) {
    case 'image/jpeg':
      return 'jpg'
    case 'image/webp':
      return 'webp'
    case 'image/gif':
      return 'gif'
    default:
      return 'png'
  }
}

/** 取最新一条用户消息里的图片，落成临时文件供 CLI 读取。 */
function writePromptImages(
  messages: PiMessage[],
): { files: string[]; cleanup: () => void } {
  const parts: { data: string; mimeType: string }[] = []
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== 'user') continue
    const content = messages[i].content
    if (Array.isArray(content)) {
      for (const part of content) {
        if (part.type === 'image')
          parts.push({ data: part.data, mimeType: part.mimeType })
      }
    }
    break
  }
  if (!parts.length) return { files: [], cleanup: () => {} }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'covan-cli-'))
  const files: string[] = []
  for (const part of parts) {
    const file = path.join(dir, `${randomUUID()}.${imageExtension(part.mimeType)}`)
    try {
      fs.writeFileSync(file, Buffer.from(part.data, 'base64'))
      files.push(file)
    } catch {
      /* 单张图片写入失败不影响文本回复 */
    }
  }
  return {
    files,
    cleanup: () => {
      try {
        fs.rmSync(dir, { recursive: true, force: true })
      } catch {
        /* 临时目录清理失败不影响结果 */
      }
    },
  }
}

// ---------- 运行 ----------

interface CliRunResult {
  outcome: CliTurnOutcome
  exitCode: number | null
  stderr: string
  aborted: boolean
}

function spawnCli(
  executable: string,
  args: string[],
  workspace: string,
  env: NodeJS.ProcessEnv,
  handlers: CliTurnHandlers,
  adapter: CliAdapter,
  signal: AbortSignal,
): Promise<CliRunResult> {
  return new Promise((resolve) => {
    const parser = adapter.createParser(handlers)
    const child = spawn(executable, args, {
      cwd: workspace,
      env,
      // 独立进程组，便于停止时连同 CLI 派生的子进程一起终止。
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stderr = ''
    let aborted = false
    const onAbort = (): void => {
      aborted = true
      // CLI 会派生子进程；先终止进程组，再兜底杀主进程。
      try {
        if (child.pid) process.kill(-child.pid, 'SIGTERM')
      } catch {
        try {
          child.kill('SIGTERM')
        } catch {
          /* 已退出 */
        }
      }
    }
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()

    child.stdout.on('data', (chunk: Buffer) => parser.push(chunk.toString('utf8')))
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < MAX_STDERR_CHARS) stderr += chunk.toString('utf8')
    })
    child.on('error', (error: Error) => {
      stderr = `${stderr}\n${error.message}`.trim()
    })
    child.on('close', (code) => {
      signal.removeEventListener('abort', onAbort)
      resolve({ outcome: parser.finish(), exitCode: code, stderr: stderr.trim(), aborted })
    })
  })
}

function friendlyCliError(outcome: { errorMessage: string }, stderr: string, exitCode: number | null): string {
  const raw = (outcome.errorMessage || stderr || '').trim()
  const lower = raw.toLowerCase()
  if (lower.includes('not logged in') || lower.includes('login') || lower.includes('authentication') || lower.includes('401') || lower.includes('unauthorized'))
    return `CLI 尚未登录或凭据已失效，请先在终端完成登录后重试。原始信息：${raw.slice(0, 300)}`
  if (lower.includes('usage limit') || lower.includes('quota'))
    return `CLI 用量额度已用尽。原始信息：${raw.slice(0, 300)}`
  if (raw) return raw.slice(0, 600)
  return `CLI 运行失败（退出码 ${exitCode ?? '未知'}）`
}

/** 按 Bot 的本地 CLI 运行方式执行一轮，并把结果转发给聊天回调。 */
export async function runCliAgent(
  chatId: string,
  bot: Bot,
  history: PiMessage[],
  callbacks: AgentCallbacks,
  opts: RunAgentOptions,
  signal: AbortSignal,
): Promise<void> {
  const kind = cliKindOf(bot)
  const adapter = ADAPTERS[kind]
  const workspace = ensureWorkspace(bot.id)
  const env = cliEnvironment()
  const startedAt = Date.now()
  const scope = {
    chat_id: chatId,
    bot_id: bot.id,
    message_id: opts.messageId ?? '',
    ...(opts.traceId ? { trace_id: opts.traceId } : {}),
    ...(opts.taskId ? { scheduled_task_id: opts.taskId } : {}),
    cli_kind: kind,
    cli_access: bot.cli_access,
  }

  let executable = ''
  try {
    executable = resolveExecutable(adapter.defaultCommand, bot.cli_path, env)
  } catch (error) {
    observe('cli.dispatch.failed', { ...scope, error_code: 'cli_missing', duration_ms: Date.now() - startedAt })
    callbacks.onError(error instanceof Error ? error.message : String(error))
    return
  }

  const fingerprint = cliFingerprint(bot)
  const existingSession = db.getCliSession(bot.id, chatId, fingerprint)
  const prompt = existingSession
    ? latestUserText(history)
    : bootstrapPrompt(opts.systemPrompt ?? bot.system_prompt, history)
  if (!prompt.trim()) {
    callbacks.onError('没有可发送给本地 CLI 的内容')
    return
  }
  const images = writePromptImages(history)
  const invocation: CliInvocation = {
    prompt: adapter.acceptsImageArgs && images.files.length
      ? prompt
      : images.files.length
        ? `${prompt}\n\n（用户附带了 ${images.files.length} 张图片，可用文件工具读取：${images.files.join('、')}）`
        : prompt,
    sessionId: existingSession,
    cliAccess: bot.cli_access,
    workspace,
    imagePaths: adapter.acceptsImageArgs ? images.files : [],
  }

  observe('cli.dispatch.started', {
    ...scope,
    resumed: existingSession ? 1 : 0,
    image_count: images.files.length,
  })

  const artifacts = new Map<string, WorkspaceArtifact>()
  const activity = new Map<string, number>()
  const emitArtifact = (absPath: string): void => {
    try {
      const absolute = path.isAbsolute(absPath)
        ? absPath
        : path.resolve(workspace, absPath)
      // macOS 下 /var 与 /private/var 互为符号链接，直接比较会让合法产物被判为越界。
      let realRoot = workspace
      let realFile = absolute
      try {
        realRoot = fs.realpathSync(workspace)
      } catch {
        /* 工作区必然存在，取不到时退回原值 */
      }
      try {
        realFile = fs.realpathSync(absolute)
      } catch {
        /* 文件可能已被移动或删除，交由 describeWorkspaceArtifact 判定 */
      }
      const rel = path.relative(realRoot, realFile).split(path.sep).join('/')
      if (!rel || rel.startsWith('..')) return
      const artifact = describeWorkspaceArtifact(bot.id, rel, 'write')
      artifacts.set(artifact.relPath, artifact)
      callbacks.onArtifact?.(artifact)
    } catch {
      /* 变更的文件可能已被移动或删除，忽略 */
    }
  }

  let result: CliRunResult
  try {
    result = await spawnCli(
      executable,
      adapter.buildArgs(invocation),
      workspace,
      env,
      {
        onDelta: callbacks.onDelta,
        onSessionId: (id) => {
          db.saveCliSession(bot.id, chatId, bot.backend, fingerprint, id)
        },
        onArtifact: emitArtifact,
        onActivity: (activityKind, label) => {
          activity.set(activityKind, (activity.get(activityKind) ?? 0) + 1)
          if (label) observe('cli.activity', { ...scope, activity_kind: activityKind })
        },
      },
      adapter,
      signal,
    )
  } finally {
    images.cleanup()
  }

  const { outcome } = result
  const observation = {
    ...scope,
    duration_ms: Date.now() - startedAt,
    session_resumed: existingSession ? 1 : 0,
    session_created: outcome.sessionId ? 1 : 0,
    visible_output_chars: outcome.text.length,
    input_tokens: outcome.inputTokens,
    output_tokens: outcome.outputTokens,
    event_types: outcome.seenEventTypes.join(','),
    artifact_count: artifacts.size,
  }

  if (result.aborted || signal.aborted) {
    observe('cli.dispatch.aborted', observation)
    if (outcome.text.trim()) callbacks.onDone(outcome.text)
    else callbacks.onError('已停止')
    return
  }

  const failed = outcome.failed || (result.exitCode !== 0 && !outcome.text.trim())
  if (failed) {
    observe('cli.dispatch.failed', {
      ...observation,
      error_code: 'cli_failed',
      exit_code: result.exitCode,
    })
    callbacks.onError(friendlyCliError(outcome, result.stderr, result.exitCode))
    return
  }
  if (!outcome.text.trim()) {
    observe('cli.dispatch.failed', { ...observation, error_code: 'cli_empty_output', exit_code: result.exitCode })
    callbacks.onError(
      `本地 CLI 没有返回可显示正文${result.stderr ? `：${result.stderr.slice(0, 300)}` : ''}`,
    )
    return
  }

  observe('cli.dispatch.ended', { ...observation, exit_code: result.exitCode })
  if (artifacts.size) callbacks.onWorkspaceChanged?.()
  callbacks.onDone(outcome.text)
}
