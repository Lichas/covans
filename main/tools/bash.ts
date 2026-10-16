import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { Type } from '@earendil-works/pi-ai'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import { ensureWorkspace, resolveWorkspaceFile } from '../workspace'
import { getBotExtensions, skillRecord } from '../extensions/store'

const DEFAULT_TIMEOUT_SECONDS = 30
const MAX_TIMEOUT_SECONDS = 120
const MAX_COMMAND_CHARS = 12_000
const MAX_STREAM_BYTES = 40 * 1024

interface CapturedStream {
  chunks: Buffer[]
  capturedBytes: number
  totalBytes: number
}

function appendCaptured(stream: CapturedStream, chunk: Buffer): void {
  stream.totalBytes += chunk.length
  const remaining = MAX_STREAM_BYTES - stream.capturedBytes
  if (remaining <= 0) return
  const kept = chunk.subarray(0, remaining)
  stream.chunks.push(kept)
  stream.capturedBytes += kept.length
}

function capturedText(stream: CapturedStream): string {
  const text = Buffer.concat(stream.chunks).toString('utf8')
  if (stream.totalBytes <= stream.capturedBytes) return text
  return `${text}\n[输出已截断：共 ${stream.totalBytes} 字节]`
}

function sandboxString(value: string): string {
  return JSON.stringify(value)
}

function macSandboxProfile(workspace: string, skillDirectories: string[]): string {
  // Bash and dynamically linked executables need broad access to system files.
  // Deny file contents in user-owned roots, with the Bot workspace as the only
  // exception besides explicitly equipped, read-only skill packages.
  const protectedRoots = new Set([
    fs.realpathSync(os.homedir()),
    '/Users',
    '/Volumes',
    '/private/var/folders',
    '/private/tmp',
  ])
  const privateDataDenials = [...protectedRoots]
    .map(
      (root) =>
        `(deny file-read-data (require-all (subpath ${sandboxString(root)}) (require-not (subpath ${sandboxString(workspace)})) ${skillDirectories.map((dir) => `(require-not (subpath ${sandboxString(dir)}))`).join(' ')}))`,
    )
    .join('\n    ')
  return `(version 1)
  (deny default)
  (allow process*)
  (allow network*)
  (allow file-read*)
  ${privateDataDenials}
  (allow file-write* (subpath ${sandboxString(workspace)}))`
}

function commandEnvironment(workspace: string): NodeJS.ProcessEnv {
  const temp = path.join(workspace, '.covan-tmp')
  fs.mkdirSync(temp, { recursive: true })
  const userHome = fs.realpathSync(os.homedir())
  const safePath = (process.env.PATH || '')
    .split(path.delimiter)
    .filter(
      (entry) =>
        entry &&
        !entry.startsWith(userHome + path.sep) &&
        !entry.startsWith('/Users/') &&
        !entry.startsWith('/Volumes/') &&
        !entry.startsWith('/private/var/folders/') &&
        !entry.startsWith('/private/tmp/'),
    )
    .join(path.delimiter)
  return {
    HOME: workspace,
    PATH:
      safePath ||
      '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
    LANG: process.env.LANG || 'en_US.UTF-8',
    LC_ALL: process.env.LC_ALL || process.env.LANG || 'en_US.UTF-8',
    TMPDIR: temp,
    COVAN_WORKSPACE: workspace,
  }
}

function stopProcessTree(
  pid: number | undefined,
  killSignal: NodeJS.Signals,
): void {
  if (!pid) return
  try {
    process.kill(-pid, killSignal)
  } catch {
    try {
      process.kill(pid, killSignal)
    } catch {
      // Process already exited.
    }
  }
}

interface BashRunResult {
  stdout: string
  stderr: string
  exitCode: number | null
  signal: NodeJS.Signals | null
  timedOut: boolean
  durationMs: number
  stdoutBytes: number
  stderrBytes: number
  truncated: boolean
}

async function runBash(
  command: string,
  cwd: string,
  workspace: string,
  timeoutSeconds: number,
  skillDirectories: string[],
  signal?: AbortSignal,
): Promise<BashRunResult> {
  if (process.platform !== 'darwin') {
    throw new Error('Bash 工作区沙箱目前仅支持 macOS')
  }
  signal?.throwIfAborted()
  const args = [
    '-p',
    macSandboxProfile(workspace, skillDirectories),
    '/bin/bash',
    '--noprofile',
    '--norc',
    '-c',
    command,
  ]
  const startedAt = Date.now()
  const stdout: CapturedStream = { chunks: [], capturedBytes: 0, totalBytes: 0 }
  const stderr: CapturedStream = { chunks: [], capturedBytes: 0, totalBytes: 0 }
  let timedOut = false

  const result = await new Promise<{
    exitCode: number | null
    signal: NodeJS.Signals | null
  }>((resolve, reject) => {
    const child = spawn('/usr/bin/sandbox-exec', args, {
      cwd,
      env: commandEnvironment(workspace),
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let forceKill: NodeJS.Timeout | undefined
    const terminate = () => {
      stopProcessTree(child.pid, 'SIGTERM')
      forceKill = setTimeout(
        () => stopProcessTree(child.pid, 'SIGKILL'),
        500,
      )
      forceKill.unref()
    }
    const timeout = setTimeout(() => {
      timedOut = true
      terminate()
    }, timeoutSeconds * 1000)
    timeout.unref()
    const onAbort = () => terminate()
    signal?.addEventListener('abort', onAbort, { once: true })
    child.stdout.on('data', (chunk: Buffer) => appendCaptured(stdout, chunk))
    child.stderr.on('data', (chunk: Buffer) => appendCaptured(stderr, chunk))
    child.once('error', (error) => {
      clearTimeout(timeout)
      if (forceKill) clearTimeout(forceKill)
      signal?.removeEventListener('abort', onAbort)
      reject(error)
    })
    child.once('close', (exitCode, exitSignal) => {
      clearTimeout(timeout)
      if (forceKill) clearTimeout(forceKill)
      signal?.removeEventListener('abort', onAbort)
      resolve({ exitCode, signal: exitSignal })
    })
  })
  signal?.throwIfAborted()
  return {
    stdout: capturedText(stdout),
    stderr: capturedText(stderr),
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut,
    durationMs: Date.now() - startedAt,
    stdoutBytes: stdout.totalBytes,
    stderrBytes: stderr.totalBytes,
    truncated:
      stdout.totalBytes > stdout.capturedBytes ||
      stderr.totalBytes > stderr.capturedBytes,
  }
}

function toolText(result: BashRunResult, relCwd: string): string {
  const status = result.timedOut
    ? `超时（${result.signal || 'terminated'}）`
    : result.exitCode === 0
      ? '成功（exit 0）'
      : `失败（exit ${result.exitCode ?? result.signal ?? 'unknown'}）`
  return [
    `状态：${status}`,
    `工作目录：${relCwd || '.'}`,
    '',
    '[stdout]',
    result.stdout || '（无输出）',
    '',
    '[stderr]',
    result.stderr || '（无输出）',
  ].join('\n')
}

export function createBashTools(botId: string): AgentTool[] {
  const workspace = fs.realpathSync(ensureWorkspace(botId))
  return [
    {
      name: 'bash',
      label: '运行 Bash 命令',
      description:
        '在当前 Bot 的 macOS 工作区沙箱内运行非交互 Bash 命令。文件只能写入工作区，可只读访问当前启用的 Skill 包以执行其脚本。命令默认超时30秒，最长120秒，stdout/stderr各最多返回40KB。',
      parameters: Type.Object({
        command: Type.String({
          minLength: 1,
          maxLength: MAX_COMMAND_CHARS,
          description: '要执行的非交互 Bash 命令',
        }),
        cwd: Type.Optional(
          Type.String({
            maxLength: 1000,
            description: '相对工作区根目录的已有子目录，默认工作区根目录',
          }),
        ),
        timeout_seconds: Type.Optional(
          Type.Integer({
            minimum: 1,
            maximum: MAX_TIMEOUT_SECONDS,
            description: `超时秒数，默认 ${DEFAULT_TIMEOUT_SECONDS}，最大 ${MAX_TIMEOUT_SECONDS}`,
          }),
        ),
      }),
      execute: async (_id, params, signal) => {
        const p = params as {
          command: string
          cwd?: string
          timeout_seconds?: number
        }
        const cwd = fs.realpathSync(resolveWorkspaceFile(botId, p.cwd || '.'))
        if (!fs.statSync(cwd).isDirectory()) throw new Error('cwd 必须是已有目录')
        const relCwd = path.relative(workspace, cwd).split(path.sep).join('/')
        const skillDirectories = getBotExtensions(botId).skillIds.flatMap((id) => {
          const skill = skillRecord(id)
          if (!skill?.enabled) return []
          try { return [fs.realpathSync(skill.directory)] } catch { return [] }
        })
        const output = await runBash(
          p.command,
          cwd,
          workspace,
          p.timeout_seconds || DEFAULT_TIMEOUT_SECONDS,
          skillDirectories,
          signal,
        )
        return {
          content: [{ type: 'text' as const, text: toolText(output, relCwd) }],
          details: { ...output, cwd: relCwd || '.' },
        }
      },
      executionMode: 'sequential',
    },
  ]
}
