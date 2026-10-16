import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type {
  BotExtensions,
  InstalledSkill,
  McpServer,
  McpServerInput,
  McpToolInfo,
} from '../../shared/types'
import { getBot, getDb } from '../db'
import { emitEvent } from '../events'
import { observe } from '../observability'

type Secrets = { env: Record<string, string>; headers: Record<string, string> }
type SecretCodec = {
  seal(value: string): string
  unseal(value: string): string
}
let codec: SecretCodec | undefined
let skillsRoot = ''

export function initExtensions(
  userData: string,
  secretCodec: SecretCodec,
): void {
  skillsRoot = path.join(userData, 'skills')
  codec = secretCodec
}

export function installedSkillsRoot(): string {
  if (!skillsRoot) throw new Error('扩展目录尚未初始化')
  return skillsRoot
}

export function extensionsChanged(botId?: string): void {
  emitEvent({ type: 'extensions-updated', ...(botId ? { botId } : {}) })
}

function text(
  value: unknown,
  label: string,
  max = 4096,
  optional = false,
): string {
  if (value === undefined && optional) return ''
  if (
    typeof value !== 'string' ||
    value.length > max ||
    value.includes('\0') ||
    (!optional && !value.trim())
  )
    throw new Error(`${label}格式无效`)
  return value.trim()
}

function stringMap(value: unknown, label: string): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label}必须是 JSON 对象`)
  const entries = Object.entries(value)
  if (
    entries.length > 100 ||
    entries.some(
      ([key, val]) =>
        !/^[A-Za-z_][A-Za-z0-9_-]{0,127}$/.test(key) ||
        typeof val !== 'string' ||
        val.length > 8192 ||
        /[\0\r\n]/.test(val),
    )
  )
    throw new Error(`${label}必须为有效的字符串键值对`)
  return Object.fromEntries(entries)
}

type ServerRow = Omit<
  McpServer,
  'args' | 'enabled' | 'env_keys' | 'header_keys' | 'tools'
> & {
  args: string
  enabled: number
  secrets: string
  env_keys: string
  header_keys: string
  tools: string
}

function publicServer(row: ServerRow): McpServer {
  const { secrets: _secrets, ...server } = row
  return {
    ...server,
    args: JSON.parse(row.args),
    enabled: Boolean(row.enabled),
    env_keys: JSON.parse(row.env_keys),
    header_keys: JSON.parse(row.header_keys),
    tools: JSON.parse(row.tools),
  }
}

export function listMcpServers(): McpServer[] {
  return (
    getDb()
      .prepare('SELECT * FROM mcp_servers ORDER BY rowid')
      .all() as ServerRow[]
  ).map(publicServer)
}

export function getMcpServer(id: string): McpServer | undefined {
  const row = getDb()
    .prepare('SELECT * FROM mcp_servers WHERE id=?')
    .get(id) as ServerRow | undefined
  return row ? publicServer(row) : undefined
}

export function getMcpSecrets(id: string): Secrets {
  const row = getDb()
    .prepare('SELECT secrets FROM mcp_servers WHERE id=?')
    .get(id) as { secrets: string } | undefined
  if (!row) throw new Error('MCP 服务不存在')
  if (!row.secrets) return { env: {}, headers: {} }
  if (!codec) throw new Error('系统凭据存储不可用')
  try {
    return JSON.parse(codec.unseal(row.secrets)) as Secrets
  } catch {
    throw new Error('无法读取 MCP 凭据，请重新配置')
  }
}

export function saveMcpServer(input: McpServerInput): McpServer {
  if (!input || typeof input !== 'object') throw new Error('MCP 配置无效')
  const existing = input.id ? getMcpServer(text(input.id, 'ID', 80)) : undefined
  if (input.id && !existing) throw new Error('MCP 服务不存在')
  const id = existing?.id ?? randomUUID()
  const name = text(input.name, '名称', 80)
  if (!['stdio', 'http', 'sse'].includes(input.transport))
    throw new Error('不支持的 MCP 传输类型')
  if (input.enabled !== undefined && typeof input.enabled !== 'boolean')
    throw new Error('启用状态无效')
  const enabled = input.enabled ?? existing?.enabled ?? true
  const command = text(input.command, '命令', 4096, input.transport !== 'stdio')
  const cwd = text(input.cwd, '工作目录', 4096, true)
  if (cwd && !path.isAbsolute(cwd)) throw new Error('工作目录必须为绝对路径')
  const args = input.args ?? []
  if (
    !Array.isArray(args) ||
    args.length > 100 ||
    args.some(
      (arg) =>
        typeof arg !== 'string' || arg.length > 8192 || arg.includes('\0'),
    )
  )
    throw new Error('参数必须是字符串数组')
  let url = ''
  if (input.transport !== 'stdio') {
    try {
      const parsed = new URL(text(input.url, 'URL'))
      if (
        !['https:', 'http:'].includes(parsed.protocol) ||
        parsed.username ||
        parsed.password ||
        parsed.search ||
        parsed.hash
      )
        throw new Error()
      url = parsed.href
    } catch {
      throw new Error(
        'MCP URL 必须为 HTTP(S) 地址；认证请使用请求头，URL 不含查询参数或凭据',
      )
    }
  }
  let sealed =
    (existing
      ? (getDb()
          .prepare('SELECT secrets FROM mcp_servers WHERE id=?')
          .get(id) as { secrets: string })
      : undefined
    )?.secrets ?? ''
  let envKeys = existing?.env_keys ?? []
  let headerKeys = existing?.header_keys ?? []
  if (input.env !== undefined || input.headers !== undefined) {
    const old = existing ? getMcpSecrets(id) : { env: {}, headers: {} }
    const secrets = {
      env: input.env === undefined ? old.env : stringMap(input.env, '环境变量'),
      headers:
        input.headers === undefined
          ? old.headers
          : stringMap(input.headers, '请求头'),
    }
    envKeys = Object.keys(secrets.env)
    headerKeys = Object.keys(secrets.headers)
    if (envKeys.length || headerKeys.length) {
      if (!codec) throw new Error('系统凭据存储不可用')
      sealed = codec.seal(JSON.stringify(secrets))
    } else sealed = ''
  }
  getDb()
    .prepare(
      `INSERT INTO mcp_servers (id,name,transport,command,args,cwd,url,enabled,secrets,env_keys,header_keys)
    VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
    name=excluded.name,transport=excluded.transport,command=excluded.command,args=excluded.args,cwd=excluded.cwd,
    url=excluded.url,enabled=excluded.enabled,secrets=excluded.secrets,env_keys=excluded.env_keys,header_keys=excluded.header_keys,
    tools='[]',last_checked_at=NULL,last_error=''`,
    )
    .run(
      id,
      name,
      input.transport,
      command,
      JSON.stringify(args),
      cwd,
      url,
      +enabled,
      sealed,
      JSON.stringify(envKeys),
      JSON.stringify(headerKeys),
    )
  observe(existing ? 'mcp.updated' : 'mcp.installed', {
    server_id: id,
    transport: input.transport,
    enabled,
  })
  extensionsChanged()
  return getMcpServer(id)!
}

export function recordMcpCheck(
  id: string,
  tools: McpToolInfo[],
  error = '',
): void {
  getDb()
    .prepare(
      'UPDATE mcp_servers SET tools=?,last_checked_at=?,last_error=? WHERE id=?',
    )
    .run(JSON.stringify(tools), Date.now(), error, id)
  extensionsChanged()
}

export function deleteMcpServer(id: string): void {
  getDb()
    .prepare('DELETE FROM mcp_servers WHERE id=?')
    .run(text(id, 'ID', 80))
  observe('mcp.uninstalled', { server_id: id })
  extensionsChanged()
}

export interface SkillRecord extends InstalledSkill {
  directory: string
}
export function skillRecord(id: string): SkillRecord | undefined {
  const row = getDb()
    .prepare('SELECT * FROM installed_skills WHERE id=?')
    .get(id) as SkillRecord | undefined
  return row ? { ...row, enabled: Boolean(row.enabled) } : undefined
}
export function listSkills(): InstalledSkill[] {
  return (
    getDb()
      .prepare('SELECT * FROM installed_skills ORDER BY name')
      .all() as SkillRecord[]
  ).map(({ directory: _directory, ...row }) => ({
    ...row,
    enabled: Boolean(row.enabled),
  }))
}
export function setSkillEnabled(id: string, enabled: boolean): void {
  if (typeof enabled !== 'boolean' || !skillRecord(id))
    throw new Error('Skill 或启用状态无效')
  getDb()
    .prepare('UPDATE installed_skills SET enabled=? WHERE id=?')
    .run(+enabled, id)
  observe('skill.updated', { skill_id: id, enabled })
  extensionsChanged()
}

export function getBotExtensions(botId: string): BotExtensions {
  if (!getBot(botId)) throw new Error('Bot 不存在')
  return {
    mcpServerIds: (
      getDb()
        .prepare(
          'SELECT server_id FROM bot_mcp_servers WHERE bot_id=? ORDER BY rowid',
        )
        .all(botId) as { server_id: string }[]
    ).map((r) => r.server_id),
    skillIds: (
      getDb()
        .prepare(
          'SELECT skill_id FROM bot_skills WHERE bot_id=? ORDER BY rowid',
        )
        .all(botId) as { skill_id: string }[]
    ).map((r) => r.skill_id),
  }
}

export function setBotExtensions(
  botId: string,
  config: BotExtensions,
): BotExtensions {
  if (!getBot(botId)) throw new Error('Bot 不存在')
  if (
    !config ||
    !Array.isArray(config.mcpServerIds) ||
    !Array.isArray(config.skillIds) ||
    config.mcpServerIds.length > 8 ||
    config.skillIds.length > 32 ||
    [...config.mcpServerIds, ...config.skillIds].some(
      (id) => typeof id !== 'string',
    )
  )
    throw new Error('每个 Bot 最多装配 8 个 MCP 服务和 32 个 Skills')
  const servers = [...new Set(config.mcpServerIds)]
  const skills = [...new Set(config.skillIds)]
  if (
    servers.some((id) => !getMcpServer(id)) ||
    skills.some((id) => !skillRecord(id))
  )
    throw new Error('扩展已被卸载，请刷新后重试')
  getDb().transaction(() => {
    getDb().prepare('DELETE FROM bot_mcp_servers WHERE bot_id=?').run(botId)
    getDb().prepare('DELETE FROM bot_skills WHERE bot_id=?').run(botId)
    for (const id of servers)
      getDb().prepare('INSERT INTO bot_mcp_servers VALUES (?,?)').run(botId, id)
    for (const id of skills)
      getDb().prepare('INSERT INTO bot_skills VALUES (?,?)').run(botId, id)
  })()
  observe('extensions.configured', {
    bot_id: botId,
    server_count: servers.length,
    skill_count: skills.length,
  })
  extensionsChanged(botId)
  return getBotExtensions(botId)
}
