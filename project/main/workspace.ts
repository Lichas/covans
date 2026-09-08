// main/workspace.ts — 每 Bot 工作区目录管理 + pi AgentTool（SPEC §7 §8）
// 不 import electron；根目录由 index.ts 通过 initWorkspace(userData) 注入。
import fs from 'node:fs'
import path from 'node:path'
import { Type } from '@earendil-works/pi-ai'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import type { WorkspaceFile } from '../shared/types'

const MAX_READ_BYTES = 200 * 1024

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
  const root = botWorkspaceDir(botId)
  const abs = path.resolve(root, relPath)
  const rel = path.relative(root, abs)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('路径越界：不允许访问工作区之外的文件')
  }
  return abs
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

// ---------- pi AgentTool（自研 3 个，SPEC §8） ----------

function textResult(text: string, details: unknown = {}) {
  return { content: [{ type: 'text' as const, text }], details }
}

export function createWorkspaceTools(botId: string): AgentTool[] {
  const readTool: AgentTool = {
    name: 'workspace_read',
    label: '读取工作区文件',
    description: '读取当前 Bot 工作区内的一个文本文件内容',
    parameters: Type.Object({
      path: Type.String({ description: '相对工作区根目录的文件路径' }),
    }),
    execute: async (_id, params) => {
      const p = params as { path: string }
      const content = readWorkspaceFile(botId, p.path)
      return textResult(content)
    },
  }

  const writeTool: AgentTool = {
    name: 'workspace_write',
    label: '写入工作区文件',
    description: '把文本内容写入当前 Bot 工作区内的文件（自动创建父目录，覆盖写）',
    parameters: Type.Object({
      path: Type.String({ description: '相对工作区根目录的文件路径' }),
      content: Type.String({ description: '要写入的文本内容' }),
    }),
    execute: async (_id, params) => {
      const p = params as { path: string; content: string }
      const abs = resolveSafe(botId, p.path)
      fs.mkdirSync(path.dirname(abs), { recursive: true })
      fs.writeFileSync(abs, p.content, 'utf8')
      return textResult(`已写入 ${p.path}（${Buffer.byteLength(p.content, 'utf8')} 字节）`)
    },
  }

  const listTool: AgentTool = {
    name: 'workspace_list',
    label: '列出工作区文件',
    description: '列出当前 Bot 工作区内的文件与目录（深度 2）',
    parameters: Type.Object({}),
    execute: async () => {
      const files = listWorkspaceFiles(botId)
      const text = files.length
        ? files.map((f) => `${f.isDir ? '[目录]' : '[文件]'} ${f.relPath}${f.isDir ? '' : ` (${f.size}B)`}`).join('\n')
        : '（工作区为空）'
      return textResult(text, { files })
    },
  }

  return [readTool, writeTool, listTool]
}
