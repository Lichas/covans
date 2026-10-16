import { createHash, randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import {
  ListRootsRequestSchema,
  type Tool,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js'
import type { McpServer } from '../../shared/types'
import {
  anonymizeId,
  classifyObservationError,
  observe,
  type ObservationFields,
} from '../observability'
import { getMcpSecrets, getMcpServer, recordMcpCheck } from './store'

let mcpFetch: typeof globalThis.fetch | undefined
const sessions = new Set<() => Promise<void>>()
export function configureMcpFetch(fetch: typeof globalThis.fetch): void {
  mcpFetch = fetch
}
export async function closeMcpSessions(): Promise<void> {
  await Promise.allSettled([...sessions].map((close) => close()))
}

export function mcpToolName(serverId: string, name: string): string {
  return `mcp_${anonymizeId(serverId)}_${name.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 16)}_${createHash('sha256').update(name).digest('hex').slice(0, 8)}`
}

const errorCode = (error: unknown) =>
  error instanceof Error && error.name === 'TimeoutError'
    ? 'timeout'
    : classifyObservationError(error)

export function mcpError(error: unknown): string {
  const code = errorCode(error)
  const messages: Record<string, string> = {
    authentication: 'MCP 认证失败，请检查请求头或环境变量',
    timeout: 'MCP 请求超时',
    aborted: 'MCP 请求已取消',
    network_error: 'MCP 连接失败，请检查地址、网络或本地命令',
  }
  return `${messages[code] ?? 'MCP 请求失败，请检查服务配置及兼容性'} [${code}]`
}

export async function connectMcp(
  server: McpServer,
  signal: AbortSignal,
  scope: ObservationFields = {},
  workspace?: string,
) {
  signal.throwIfAborted()
  const started = Date.now()
  const fields = { ...scope, server_id: server.id, transport: server.transport }
  observe('mcp.connect.started', fields)
  const client = new Client(
    { name: 'covan', version: '0.1.0' },
    { capabilities: workspace ? { roots: {} } : {} },
  )
  let closed = false
  let closing: Promise<void> | undefined
  const close = (): Promise<void> => {
    if (closing) return closing
    closed = true
    signal.removeEventListener('abort', onAbort)
    closing = client
      .close()
      .catch(() => {})
      .then(() => {
        sessions.delete(close)
        observe('mcp.connection.closed', fields)
      })
    return closing
  }
  const onAbort = () => {
    void close()
  }
  signal.addEventListener('abort', onAbort, { once: true })
  sessions.add(close)
  try {
    const { env, headers } = getMcpSecrets(server.id)
    const transport =
      server.transport === 'stdio'
        ? new StdioClientTransport({
            command: server.command,
            args: server.args,
            cwd: server.cwd || workspace || undefined,
            env,
            stderr: 'ignore',
          })
        : server.transport === 'http'
          ? new StreamableHTTPClientTransport(new URL(server.url), {
              requestInit: { headers },
              fetch: mcpFetch,
              reconnectionOptions: {
                maxRetries: 0,
                maxReconnectionDelay: 1000,
                initialReconnectionDelay: 1000,
                reconnectionDelayGrowFactor: 1,
              },
            })
          : new SSEClientTransport(new URL(server.url), {
              requestInit: { headers },
              fetch: mcpFetch,
            })
    if (workspace)
      client.setRequestHandler(ListRootsRequestSchema, () => ({
        roots: [{ uri: pathToFileURL(workspace).href, name: 'Bot workspace' }],
      }))
    client.onerror = (error) =>
      observe('mcp.connection.error', {
        ...fields,
        error_code: classifyObservationError(error),
      })
    // SSE transport.start() can wait for an endpoint before SDK request timeouts begin.
    const connectSignal = AbortSignal.any([signal, AbortSignal.timeout(15000)])
    let abortConnect: () => void = () => {}
    try {
      await new Promise<void>((resolve, reject) => {
        abortConnect = () => {
          void close()
          reject(connectSignal.reason)
        }
        connectSignal.addEventListener('abort', abortConnect, { once: true })
        if (connectSignal.aborted) {
          abortConnect()
          return
        }
        void client
          .connect(transport, { signal: connectSignal, timeout: 15000 })
          .then(resolve, reject)
      })
    } finally {
      connectSignal.removeEventListener('abort', abortConnect)
    }
    signal.throwIfAborted()
    observe('mcp.connect.completed', {
      ...fields,
      duration_ms: Date.now() - started,
    })
    const tools: Tool[] = []
    const cursors = new Set<string>()
    const names = new Set<string>()
    let cursor: string | undefined
    const discoverySignal = AbortSignal.any([
      signal,
      AbortSignal.timeout(15000),
    ])
    if (client.getServerCapabilities()?.tools)
      do {
        const page = await client.listTools(
          { cursor },
          { signal: discoverySignal, timeout: 15000 },
        )
        for (const tool of page.tools) {
          if (names.has(tool.name) || tools.length >= 128)
            throw new Error('invalid MCP tool list')
          names.add(tool.name)
          tools.push(tool)
        }
        cursor = page.nextCursor
        if (cursor && cursors.has(cursor))
          throw new Error('invalid MCP pagination')
        if (cursor) cursors.add(cursor)
      } while (cursor)
    observe('mcp.tools.discovered', {
      ...fields,
      tool_count: tools.length,
      duration_ms: Date.now() - started,
    })
    return {
      tools,
      close,
      async call(
        name: string,
        args: Record<string, unknown>,
        toolSignal?: AbortSignal,
      ) {
        const callStarted = Date.now()
        const callFields = {
          ...fields,
          call_id: randomUUID(),
          tool_name: mcpToolName(server.id, name),
        }
        if (closed || !getMcpServer(server.id)?.enabled)
          throw new Error('MCP 服务已停用或断开')
        const requestSignal = toolSignal
          ? AbortSignal.any([signal, toolSignal])
          : signal
        requestSignal.throwIfAborted()
        observe('mcp.call.started', callFields)
        try {
          const result = await client.callTool(
            { name, arguments: args },
            undefined,
            { signal: requestSignal, timeout: 60000, maxTotalTimeout: 60000 },
          )
          observe('mcp.call.completed', {
            ...callFields,
            is_error: Boolean(result.isError),
            duration_ms: Date.now() - callStarted,
          })
          return result as CallToolResult
        } catch (error) {
          observe('mcp.call.failed', {
            ...callFields,
            error_code: errorCode(error),
            duration_ms: Date.now() - callStarted,
          })
          throw new Error(mcpError(error))
        }
      },
    }
  } catch (error) {
    observe('mcp.connect.failed', {
      ...fields,
      duration_ms: Date.now() - started,
      error_code: errorCode(error),
    })
    await close()
    throw new Error(mcpError(error))
  }
}

export async function testMcpServer(id: string) {
  const server = getMcpServer(id)
  if (!server) throw new Error('MCP 服务不存在')
  try {
    const session = await connectMcp(server, AbortSignal.timeout(35000))
    try {
      const tools = session.tools.map((t) => ({
        name: t.name,
        description: t.description?.slice(0, 2000) ?? '',
      }))
      recordMcpCheck(id, tools)
      return { ok: true, tools }
    } finally {
      await session.close()
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'MCP 连接失败'
    recordMcpCheck(id, [], message)
    return { ok: false, tools: [], error: message }
  }
}
