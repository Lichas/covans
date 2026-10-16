import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { parse } from 'yaml'
import type { InstalledSkill } from '../../shared/types'
import { getDb } from '../db'
import { observe } from '../observability'
import {
  extensionsChanged,
  installedSkillsRoot,
  listSkills,
  skillRecord,
  type SkillRecord,
} from './store'

const execFileAsync = promisify(execFile)
const MAX_TEXT = 200 * 1024
let installing = false

function within(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== '..' &&
      !path.isAbsolute(relative))
  )
}

async function readText(file: string): Promise<string> {
  const stat = await fs.stat(file)
  if (!stat.isFile() || stat.size > MAX_TEXT)
    throw new Error('Skill 文本文件不能超过 200KB')
  const bytes = await fs.readFile(file)
  if (bytes.includes(0)) throw new Error('不能将二进制文件作为 Skill 文本读取')
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error('Skill 文本必须为 UTF-8')
  }
}

function metadata(
  content: string,
): Pick<InstalledSkill, 'name' | 'description' | 'compatibility'> {
  const match = content
    .replace(/^\uFEFF/, '')
    .match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  if (!match) throw new Error('SKILL.md 缺少 YAML frontmatter')
  let data: Record<string, unknown>
  try {
    data = parse(match[1], { maxAliasCount: 0, uniqueKeys: true })
  } catch {
    throw new Error('SKILL.md 的 YAML frontmatter 无效')
  }
  if (
    !data ||
    typeof data.name !== 'string' ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(data.name) ||
    data.name.length > 64
  )
    throw new Error('Skill name 必须为 1–64 位小写字母、数字与单连字符')
  if (
    typeof data.description !== 'string' ||
    !data.description.trim() ||
    data.description.length > 1024
  )
    throw new Error('Skill description 必须为 1–1024 字符')
  if (
    data.compatibility !== undefined &&
    (typeof data.compatibility !== 'string' || data.compatibility.length > 500)
  )
    throw new Error('Skill compatibility 最多 500 字符')
  return {
    name: data.name,
    description: data.description.trim(),
    compatibility: (data.compatibility as string | undefined) ?? '',
  }
}

async function packageFiles(root: string): Promise<string[]> {
  const files: string[] = []
  let total = 0
  let entriesSeen = 0
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 16) throw new Error('Skill 目录层级过深')
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (['.git', 'node_modules', '.DS_Store'].includes(entry.name)) continue
      if (++entriesSeen > 2000) throw new Error('Skill 目录项过多')
      const file = path.join(dir, entry.name)
      const stat = await fs.lstat(file)
      if (stat.isSymbolicLink()) throw new Error('Skill 安装不接受符号链接')
      if (stat.isDirectory()) await walk(file, depth + 1)
      else if (stat.isFile()) {
        total += stat.size
        if (
          stat.size > 10 * 1024 * 1024 ||
          total > 50 * 1024 * 1024 ||
          files.length >= 1000
        )
          throw new Error(
            'Skill 超过文件数量或大小限制（1000 文件 / 单文件 10MB / 总 50MB）',
          )
        files.push(path.relative(root, file))
      } else throw new Error('Skill 包含不支持的文件类型')
    }
  }
  await walk(root, 0)
  return files.sort()
}

async function findSkills(root: string): Promise<string[]> {
  const found: string[] = []
  let visited = 0
  async function walk(dir: string, depth: number): Promise<void> {
    if (++visited > 2000)
      throw new Error('导入目录过大，请选择具体 Skills 子目录')
    const entries = await fs.readdir(dir, { withFileTypes: true })
    if (entries.some((e) => e.name === 'SKILL.md')) {
      found.push(dir)
      if (found.length > 64) throw new Error('每次最多导入 64 个 Skills')
      return
    }
    if (depth >= 5) return
    for (const entry of entries) {
      if (entry.isDirectory() && !['.git', 'node_modules'].includes(entry.name))
        await walk(path.join(dir, entry.name), depth + 1)
    }
  }
  await walk(root, 0)
  if (!found.length)
    throw new Error('未找到 SKILL.md，请选择技能目录或其父目录')
  return found
}

/** Copies packages into versioned managed directories before atomically updating bindings. */
export async function installSkills(
  source: string,
  subdirectory = '',
): Promise<InstalledSkill[]> {
  if (installing) throw new Error('已有 Skill 安装正在进行')
  if (
    typeof source !== 'string' ||
    !source.trim() ||
    source.length > 4096 ||
    typeof subdirectory !== 'string' ||
    subdirectory.length > 1024
  )
    throw new Error('安装来源无效')
  installing = true
  let cloneDir = ''
  const staged: string[] = []
  let committed = false
  try {
    let root = source.trim()
    if (/^https?:\/\//i.test(root)) {
      let url: URL
      try {
        url = new URL(root)
      } catch {
        throw new Error('Git URL 无效')
      }
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      )
        throw new Error('Git 安装仅支持不含凭据的 HTTPS 仓库地址')
      cloneDir = await fs.mkdtemp(path.join(os.tmpdir(), 'covan-skills-'))
      root = path.join(cloneDir, 'repo')
      try {
        await execFileAsync(
          'git',
          [
            '-c',
            'core.hooksPath=/dev/null',
            '-c',
            'protocol.file.allow=never',
            '-c',
            'protocol.ext.allow=never',
            'clone',
            '--depth',
            '1',
            '--',
            url.href,
            root,
          ],
          {
            timeout: 60000,
            maxBuffer: 1024 * 1024,
            env: {
              ...process.env,
              GIT_TERMINAL_PROMPT: '0',
              GIT_ASKPASS: '/usr/bin/false',
            },
          },
        )
      } catch {
        throw new Error(
          'Git 克隆失败，请检查仓库地址、Git 安装和网络（60 秒超时）',
        )
      }
    } else if (!path.isAbsolute(root))
      throw new Error('本地 Skill 来源必须为绝对目录路径')
    if ((await fs.lstat(root)).isSymbolicLink())
      throw new Error('Skill 安装不接受符号链接')
    root = await fs.realpath(root)
    if (subdirectory) {
      const selected = await fs.realpath(path.resolve(root, subdirectory))
      if (!within(root, selected))
        throw new Error('Skill 子目录不能超出安装来源')
      root = selected
    }
    const directories = await findSkills(root)
    const prepared: SkillRecord[] = []
    const oldDirectories: string[] = []
    const names = new Set<string>()
    await fs.mkdir(installedSkillsRoot(), { recursive: true })
    for (const dir of directories) {
      const files = await packageFiles(dir)
      const info = metadata(await readText(path.join(dir, 'SKILL.md')))
      if (names.has(info.name))
        throw new Error(`导入来源包含重名 Skill：${info.name}`)
      names.add(info.name)
      const existing = getDb()
        .prepare('SELECT * FROM installed_skills WHERE name=?')
        .get(info.name) as SkillRecord | undefined
      const destination = path.join(installedSkillsRoot(), randomUUID())
      staged.push(destination)
      await fs.mkdir(destination)
      for (const file of files) {
        const target = path.join(destination, file)
        await fs.mkdir(path.dirname(target), { recursive: true })
        await fs.copyFile(path.join(dir, file), target)
      }
      // Validate the copy too, so a changed source cannot install dangling links.
      await packageFiles(destination)
      if (existing) oldDirectories.push(existing.directory)
      prepared.push({
        ...info,
        id: existing?.id ?? randomUUID(),
        directory: destination,
        source: source.trim() + (subdirectory ? ` # ${subdirectory}` : ''),
        enabled: existing ? Boolean(existing.enabled) : true,
        file_count: files.length,
        updated_at: Date.now(),
      })
    }
    getDb().transaction(() => {
      for (const skill of prepared)
        getDb()
          .prepare(
            `INSERT INTO installed_skills
        (id,name,description,compatibility,source,directory,enabled,file_count,updated_at) VALUES (?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET description=excluded.description,compatibility=excluded.compatibility,
        source=excluded.source,directory=excluded.directory,file_count=excluded.file_count,updated_at=excluded.updated_at`,
          )
          .run(
            skill.id,
            skill.name,
            skill.description,
            skill.compatibility,
            skill.source,
            skill.directory,
            +skill.enabled,
            skill.file_count,
            skill.updated_at,
          )
    })()
    committed = true
    for (const dir of oldDirectories) await removeManagedDirectory(dir)
    for (const skill of prepared)
      observe('skill.installed', {
        skill_id: skill.id,
        file_count: skill.file_count,
      })
    extensionsChanged()
    return listSkills().filter((s) => prepared.some((p) => p.id === s.id))
  } finally {
    if (!committed) for (const dir of staged) await removeManagedDirectory(dir)
    if (cloneDir)
      await fs.rm(cloneDir, { recursive: true, force: true }).catch(() => {})
    installing = false
  }
}

async function removeManagedDirectory(dir: string): Promise<void> {
  if (path.dirname(dir) === installedSkillsRoot())
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
}

export async function deleteSkill(id: string): Promise<void> {
  const skill = skillRecord(id)
  if (!skill) throw new Error('Skill 不存在')
  getDb().prepare('DELETE FROM installed_skills WHERE id=?').run(id)
  await removeManagedDirectory(skill.directory)
  observe('skill.uninstalled', { skill_id: id })
  extensionsChanged()
}

export async function readSkillFile(
  id: string,
  relative = 'SKILL.md',
): Promise<{ content: string; files: string[]; directory: string }> {
  const skill = skillRecord(id)
  if (!skill) throw new Error('Skill 不存在')
  if (
    typeof relative !== 'string' ||
    relative.length > 1024 ||
    path.isAbsolute(relative)
  )
    throw new Error('Skill 文件路径无效')
  const root = await fs.realpath(skill.directory)
  const file = await fs.realpath(path.resolve(root, relative))
  if (!within(root, file)) throw new Error('Skill 文件不能超出安装目录')
  return {
    content: await readText(file),
    files: relative === 'SKILL.md' ? await packageFiles(root) : [],
    directory: root,
  }
}
