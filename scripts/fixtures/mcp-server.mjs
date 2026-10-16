import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { pathToFileURL } from 'node:url'
import fs from 'node:fs'

export function fixtureServer(onCall = () => {}) {
  const server = new Server(
    { name: 'covan-local-fixture', version: '1.0.0' },
    { capabilities: { tools: {} } },
  )
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [
      {
        name: 'fixture_echo',
        description: 'Return a local test value.',
        inputSchema: {
          type: 'object',
          properties: { value: { type: 'string' } },
          required: ['value'],
        },
      },
      {
        name: 'fixture_slow',
        description: 'Wait until cancelled.',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'fixture_error',
        description: 'Return a tool failure.',
        inputSchema: { type: 'object', properties: {} },
      },
    ],
  }))
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    onCall(request.params.name)
    if (request.params.name === 'fixture_slow')
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 30000)
        extra.signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer)
            resolve()
          },
          { once: true },
        )
      })
    return {
      content: [
        {
          type: 'text',
          text: `MCP_RESULT:${request.params.arguments?.value ?? 'ok'}`,
        },
      ],
      isError: request.params.name === 'fixture_error',
    }
  })
  return server
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (process.argv[2]) fs.appendFileSync(process.argv[2], `${process.pid}\n`)
  const server = fixtureServer()
  await server.connect(new StdioServerTransport())
}
