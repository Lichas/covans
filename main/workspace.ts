// main/workspace.ts — 每 Bot 工作区目录管理 + pi AgentTool（SPEC §7 §8）
// 不 import electron；根目录由 index.ts 通过 initWorkspace(userData) 注入。
import fs from 'node:fs'
import path from 'node:path'
import { Type } from '@earendil-works/pi-ai'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import type { WorkspaceArtifact, WorkspaceFile } from '../shared/types'

const MAX_READ_BYTES = 200 * 1024
const MAX_TOOL_READ_BYTES = 80 * 1024
const MAX_TOOL_READ_LINES = 400
const MAX_TOOL_WRITE_BYTES = 1024 * 1024
const MAX_TOOL_LIST_ENTRIES = 500

let workspaceRoot = ''

/** 初始化工作区根目录（userData/workspaces） */
export function initWorkspace(userDataDir: string): string {
  workspaceRoot = path.join(userDataDir, 'workspaces')
  fs.mkdirSync(workspaceRoot, { recursive: true })
  return workspaceRoot
}

export function getWorkspaceRoot(): string {
  if (!workspaceRoot) throw new Error('工作区未初始化（initWorkspace 未调用）')
  return workspaceRoot
}

export function botWorkspaceDir(botId: string): string {
  return path.join(getWorkspaceRoot(), botId)
}

/** 创建 bot 工作区目录（建 bot 时调用） */
export function ensureWorkspace(botId: string): string {
  const dir = botWorkspaceDir(botId)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/** resolve 后校验不逃逸 bot 目录；返回绝对路径 */
export function resolveSafe(botId: string, relPath: string): string {
  if (path.isAbsolute(relPath)) {
    throw new Error('路径越界：必须使用工作区内的相对路径')
  }
  const root = botWorkspaceDir(botId)
  const abs = path.resolve(root, relPath)
  const rel = path.relative(root, abs)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('路径越界：不允许访问工作区之外的文件')
  }
  return abs
}

function isWithin(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/**
 * Lexical path checks do not stop a symlink inside a workspace from pointing
 * outside it. Resolve the target (or its nearest existing ancestor for a new
 * file) before every tool read/write.
 */
function assertRealPathWithinWorkspace(botId: string, abs: string): void {
  const root = fs.realpathSync(ensureWorkspace(botId))
  let existing = abs
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing)
    if (parent === existing) break
    existing = parent
  }
  const real = fs.realpathSync(existing)
  if (!isWithin(root, real)) {
    throw new Error('路径越界：符号链接指向了工作区之外')
  }
}

/** 供主进程打开/定位工作区文件；同时执行词法与 realpath 边界校验。 */
export function resolveWorkspaceFile(botId: string, relPath: string): string {
  const abs = resolveSafe(botId, relPath)
  assertRealPathWithinWorkspace(botId, abs)
  return abs
}

export function describeWorkspaceArtifact(
  botId: string,
  relPath: string,
  operation: WorkspaceArtifact['operation'],
): WorkspaceArtifact {
  const abs = resolveWorkspaceFile(botId, relPath)
  const stat = fs.statSync(abs)
  if (!stat.isFile()) throw new Error('交付产物不是文件')
  return {
    relPath: path.relative(ensureWorkspace(botId), abs).split(path.sep).join('/'),
    name: path.basename(abs),
    size: stat.size,
    mtime: stat.mtimeMs,
    operation,
  }
}

/** 列文件（深度 2） */
export function listWorkspaceFiles(botId: string): WorkspaceFile[] {
  const root = ensureWorkspace(botId)
  const out: WorkspaceFile[] = []
  const walk = (dir: string, depth: number) => {
    if (depth > 2) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue
      const abs = path.join(dir, e.name)
      const relPath = path.relative(root, abs).split(path.sep).join('/')
      let size = 0
      let mtime = 0
      try {
        const st = fs.statSync(abs)
        size = st.size
        mtime = st.mtimeMs
      } catch {
        continue
      }
      out.push({ name: e.name, relPath, isDir: e.isDirectory(), size, mtime })
      if (e.isDirectory()) walk(abs, depth + 1)
    }
  }
  walk(root, 1)
  return out.sort((a, b) => a.relPath.localeCompare(b.relPath))
}

/** 读文本文件（<=200KB） */
export function readWorkspaceFile(botId: string, relPath: string): string {
  const abs = resolveSafe(botId, relPath)
  const st = fs.statSync(abs)
  if (st.isDirectory()) throw new Error('目标是目录，无法读取')
  if (st.size > MAX_READ_BYTES) throw new Error('文件超过 200KB，不支持预览')
  const buf = fs.readFileSync(abs)
  if (buf.includes(0)) throw new Error('二进制文件不支持预览')
  return buf.toString('utf8')
}

// ---------- pi AgentTool（自研 4 个，SPEC §8） ----------

function textResult(text: string, details: unknown = {}) {
  return { content: [{ type: 'text' as const, text }], details }
}

function readToolSlice(
  botId: string,
  relPath: string,
  offset = 1,
  limit = MAX_TOOL_READ_LINES,
) {
  const abs = resolveSafe(botId, relPath)
  assertRealPathWithinWorkspace(botId, abs)
  const st = fs.statSync(abs)
  if (!st.isFile()) throw new Error('目标不是可读文件')
  if (st.size > MAX_READ_BYTES)
    throw new Error('文件超过 200KB，请先缩小文件或分拆后再读取')
  const buf = fs.readFileSync(abs)
  if (buf.includes(0)) throw new Error('二进制文件不支持读取')
  const lines = buf.toString('utf8').split('\n')
  if (offset > lines.length)
    throw new Error(`offset ${offset} 超过文件总行数 ${lines.length}`)
  const start = Math.max(0, offset - 1)
  const requestedEnd = Math.min(lines.length, start + limit)
  let selected = lines.slice(start, requestedEnd)
  let text = selected.join('\n')
  while (
    selected.length > 1 &&
    Buffer.byteLength(text, 'utf8') > MAX_TOOL_READ_BYTES
  ) {
    selected = selected.slice(0, Math.ceil(selected.length / 2))
    text = selected.join('\n')
  }
  if (Buffer.byteLength(text, 'utf8') > MAX_TOOL_READ_BYTES) {
    text = Buffer.from(text, 'utf8').subarray(0, MAX_TOOL_READ_BYTES).toString('utf8')
  }
  const endLine = start + selected.length
  const hasMore = endLine < lines.length
  const suffix = hasMore
    ? `\n\n[显示第 ${offset}-${endLine} 行，共 ${lines.length} 行；继续读取请使用 offset=${endLine + 1}]`
    : `\n\n[文件结束，共 ${lines.length} 行]`
  return {
    text: text + suffix,
    details: { path: relPath, offset, endLine, totalLines: lines.length, hasMore },
  }
}

export function createWorkspaceTools(botId: string): AgentTool[] {
  const readTool: AgentTool = {
    name: 'workspace_read',
    label: '读取工作区文件',
    description:
      '读取当前 Bot 工作区内的文本文件。大文件使用 offset/limit 分页读取；只能使用相对路径。',
    parameters: Type.Object({
      path: Type.String({ description: '相对工作区根目录的文件路径' }),
      offset: Type.Optional(
        Type.Integer({ minimum: 1, description: '起始行（1 开始）' }),
      ),
      limit: Type.Optional(
        Type.Integer({
          minimum: 1,
          maximum: MAX_TOOL_READ_LINES,
          description: `最多读取行数，默认 ${MAX_TOOL_READ_LINES}`,
        }),
      ),
    }),
    execute: async (_id, params, signal) => {
      signal?.throwIfAborted()
      const p = params as { path: string; offset?: number; limit?: number }
      const output = readToolSlice(botId, p.path, p.offset, p.limit)
      signal?.throwIfAborted()
      return textResult(output.text, output.details)
    },
  }

  const writeTool: AgentTool = {
    name: 'workspace_write',
    label: '写入工作区文件',
    description:
      '把文本写入当前 Bot 工作区（自动创建父目录，整个覆盖）。修改已有文件时优先使用 workspace_edit；只能使用相对路径。',
    parameters: Type.Object({
      path: Type.String({ description: '相对工作区根目录的文件路径' }),
      content: Type.String({
        maxLength: MAX_TOOL_WRITE_BYTES,
        description: '要写入的文本内容',
      }),
    }),
    execute: async (_id, params, signal) => {
      signal?.throwIfAborted()
      const p = params as { path: string; content: string }
      if (Buffer.byteLength(p.content, 'utf8') > MAX_TOOL_WRITE_BYTES)
        throw new Error('单次写入不能超过 1MB')
      const abs = resolveSafe(botId, p.path)
      assertRealPathWithinWorkspace(botId, abs)
      fs.mkdirSync(path.dirname(abs), { recursive: true })
      fs.writeFileSync(abs, p.content, 'utf8')
      signal?.throwIfAborted()
      return textResult(`已写入 ${p.path}（${Buffer.byteLength(p.content, 'utf8')} 字节）`, {
        path: p.path,
      })
    },
    executionMode: 'sequential',
  }

  const editTool: AgentTool = {
    name: 'workspace_edit',
    label: '编辑工作区文件',
    description:
      '在已有文本文件中做一次精确替换。old_text 必须恰好出现一次，避免意外改到多处；只能使用相对路径。',
    parameters: Type.Object({
      path: Type.String({ description: '相对工作区根目录的文件路径' }),
      old_text: Type.String({ minLength: 1, maxLength: MAX_TOOL_WRITE_BYTES }),
      new_text: Type.String({ maxLength: MAX_TOOL_WRITE_BYTES }),
    }),
    execute: async (_id, params, signal) => {
      signal?.throwIfAborted()
      const p = params as { path: string; old_text: string; new_text: string }
      const abs = resolveSafe(botId, p.path)
      assertRealPathWithinWorkspace(botId, abs)
      const st = fs.statSync(abs)
      if (!st.isFile()) throw new Error('目标不是可编辑文件')
      if (st.size > MAX_READ_BYTES) throw new Error('文件超过 200KB，不支持精确编辑')
      const original = fs.readFileSync(abs, 'utf8')
      const first = original.indexOf(p.old_text)
      if (first < 0) throw new Error('old_text 在文件中不存在')
      if (original.indexOf(p.old_text, first + p.old_text.length) >= 0)
        throw new Error('old_text 在文件中不唯一，请提供更多上下文')
      const updated =
        original.slice(0, first) + p.new_text + original.slice(first + p.old_text.length)
      if (Buffer.byteLength(updated, 'utf8') > MAX_TOOL_WRITE_BYTES)
        throw new Error('编辑后文件不能超过 1MB')
      fs.writeFileSync(abs, updated, 'utf8')
      signal?.throwIfAborted()
      return textResult(`已更新 ${p.path}（精确替换 1 处）`, {
        path: p.path,
        replacements: 1,
      })
    },
    executionMode: 'sequential',
  }

  const listTool: AgentTool = {
    name: 'workspace_list',
    label: '列出工作区文件',
    description:
      '列出当前 Bot 工作区内的文件与目录（最多 500 项）。读取前可先用此工具确认路径。',
    parameters: Type.Object({}),
    execute: async (_id, _params, signal) => {
      signal?.throwIfAborted()
      const allFiles = listWorkspaceFiles(botId)
      const files = allFiles.slice(0, MAX_TOOL_LIST_ENTRIES)
      const text = files.length
        ? files.map((f) => `${f.isDir ? '[目录]' : '[文件]'} ${f.relPath}${f.isDir ? '' : ` (${f.size}B)`}`).join('\n')
        : '（工作区为空）'
      const suffix =
        allFiles.length > files.length
          ? `\n…已截断，共 ${allFiles.length} 项`
          : ''
      return textResult(text + suffix, {
        files,
        total: allFiles.length,
        truncated: allFiles.length > files.length,
      })
    },
  }

  return [readTool, writeTool, editTool, listTool]
}
