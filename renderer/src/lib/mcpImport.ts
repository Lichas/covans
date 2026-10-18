import type { McpServerInput } from '@shared/types'

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function strings(value: unknown): Record<string, string> | undefined {
  if (value === undefined) return undefined
  if (!record(value) || Object.values(value).some((v) => typeof v !== 'string'))
    throw new Error('环境变量和请求头必须是字符串键值对象')
  return value as Record<string, string>
}

/** Parse one command as argv, never as shell code. No execution or saving. */
function commandArgs(source: string): string[] {
  if (/[\r\n`]/.test(source) || source.includes('$(')) throw new Error('请粘贴单条启动命令，不支持脚本或命令替换')
  const tokens: string[] = []
  let token = '', quote = '', started = false
  for (let i = 0; i < source.length; i++) {
    const c = source[i]
    if (c === '\\' && quote !== "'") {
      if (++i >= source.length) throw new Error('命令末尾的转义不完整')
      token += source[i]; started = true
    } else if (quote) {
      if (c === quote) quote = ''
      else token += c
    } else if (c === '"' || c === "'") {
      quote = c; started = true
    } else if (/\s/.test(c)) {
      if (started) tokens.push(token)
      token = ''; started = false
    } else {
      if (/[|&;<>]/.test(c)) throw new Error('不支持管道或多条命令，请使用 MCP JSON 配置')
      token += c; started = true
    }
  }
  if (quote) throw new Error('命令引号未闭合')
  if (started) tokens.push(token)
  if (!tokens[0] || /^[\w]+=.*/.test(tokens[0])) throw new Error('请填写启动命令；环境变量可在高级配置中设置')
  return tokens
}

function normalize(value: unknown, fallbackName: string): McpServerInput {
  if (!record(value)) throw new Error('每个 MCP 服务必须是配置对象')
  const name = typeof value.name === 'string' ? value.name : fallbackName
  if (typeof value.url === 'string' && value.url) {
    const url = new URL(value.url)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
      throw new Error('服务 URL 仅支持 HTTP/HTTPS；认证信息请放在请求头中')
    const kind = value.transport ?? value.type ?? 'http'
    if (!['http', 'streamable-http', 'sse'].includes(String(kind))) throw new Error('未知的远程连接方式')
    return { name: name || url.hostname, transport: kind === 'sse' ? 'sse' : 'http', url: url.href, headers: strings(value.headers) }
  }
  if (typeof value.command !== 'string' || !value.command.trim()) throw new Error('配置中缺少 command 或 url')
  if (value.args !== undefined && (!Array.isArray(value.args) || value.args.some((v) => typeof v !== 'string')))
    throw new Error('args 必须是字符串数组')
  if (value.cwd !== undefined && typeof value.cwd !== 'string') throw new Error('cwd 必须是目录字符串')
  return { name: name || value.command, transport: 'stdio', command: value.command, args: (value.args as string[] | undefined) ?? [], cwd: value.cwd as string | undefined, env: strings(value.env) }
}

export function parseMcpImport(source: string): McpServerInput[] {
  const text = source.trim()
  if (!text || text.length > 100_000) throw new Error('请粘贴配置，长度不超过 100 KB')
  if (text.startsWith('{')) {
    let value: unknown
    try { value = JSON.parse(text) } catch { throw new Error('JSON 格式无效，请检查括号与引号') }
    if (record(value) && value.mcpServers !== undefined) {
      if (!record(value.mcpServers)) throw new Error('mcpServers 必须是服务名称与配置的对象')
      const entries = Object.entries(value.mcpServers)
      if (!entries.length || entries.length > 128) throw new Error('配置须包含 1–128 个服务')
      return entries.map(([name, config]) => normalize(config, name))
    }
    return [normalize(value, '')]
  }
  if (/^https?:\/\//i.test(text)) return [normalize({ url: text }, '')]
  const [command, ...args] = commandArgs(text)
  return [normalize({ command, args }, '')]
}
