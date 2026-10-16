// All servers and profiles are temporary/loopback. No user credentials or paid models.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { _electron as electron } from 'playwright'
import { expect } from '@playwright/test'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import { fixtureServer } from './fixtures/mcp-server.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'covan-extensions-'))
const fixtures = fs.mkdtempSync(path.join(os.tmpdir(), 'covan-skills-fixture-'))
const artifacts = path.join(root, 'artifacts', 'extensions')
fs.mkdirSync(artifacts, { recursive: true })
const skillDir = path.join(fixtures, 'writing-workflow')
fs.mkdirSync(path.join(skillDir, 'references'), { recursive: true })
fs.mkdirSync(path.join(skillDir, 'scripts'))
fs.writeFileSync(
  path.join(skillDir, 'SKILL.md'),
  '---\nname: writing-workflow\ndescription: 整理文章结构、检查引用并生成交付文件。\ncompatibility: macOS with bash\n---\n# 写作工作流\n\nSKILL_PRIVATE_BODY\n\n先读 references/style.txt，再运行 scripts/hello.sh。\n',
)
fs.writeFileSync(
  path.join(skillDir, 'references', 'style.txt'),
  'STYLE_REFERENCE_PRIVATE',
)
fs.writeFileSync(
  path.join(skillDir, 'scripts', 'hello.sh'),
  '#!/bin/bash\nprintf "SKILL_SCRIPT_OK"\n',
)
const pidFile = path.join(fixtures, 'mcp-pids')
const secret = 'fixture-secret-never-in-ui-or-logs'
const requests = []
const mcpCalls = []
const sseSessions = new Map()
let nextTools = []
let app, page
const pageErrors = []
const liveServers = new Set()
const server = http.createServer(async (req, res) => {
  try {
    if (req.url === '/sse-stall') {
      mcpCalls.push('connecting')
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.write(': waiting for endpoint\n\n')
      return
    }
    if (req.url === '/sse') {
      const transport = new SSEServerTransport('/sse-message', res)
      const mcp = fixtureServer((name) => mcpCalls.push(name))
      sseSessions.set(transport.sessionId, transport)
      liveServers.add(mcp)
      res.on('close', () => {
        sseSessions.delete(transport.sessionId)
        liveServers.delete(mcp)
        void mcp.close()
      })
      await mcp.connect(transport)
      return
    }
    if (req.url?.startsWith('/sse-message')) {
      const transport = sseSessions.get(
        new URL(req.url, 'http://localhost').searchParams.get('sessionId'),
      )
      if (!transport) {
        res.writeHead(404).end()
        return
      }
      await transport.handlePostMessage(req, res)
      return
    }
    if (req.url === '/mcp') {
      if (req.headers.authorization !== `Bearer ${secret}`) {
        res.writeHead(401).end()
        return
      }
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      })
      const mcp = fixtureServer((name) => mcpCalls.push(name))
      liveServers.add(mcp)
      res.on('close', () => {
        liveServers.delete(mcp)
        void mcp.close()
      })
      await mcp.connect(transport)
      await transport.handleRequest(req, res)
      return
    }
    if (req.url === '/broken') {
      res.writeHead(503).end('fixture-down')
      return
    }
    let raw = ''
    for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw || '{}')
    requests.push(body)
    const tool = body.tools?.length ? nextTools.shift() : undefined
    const content = body.tools?.length ? 'EXTENSION_RUN_COMPLETE' : '[]'
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    const send = (delta, reason = null) =>
      res.write(
        `data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', model: body.model, choices: [{ index: 0, delta, finish_reason: reason }] })}\n\n`,
      )
    send({ role: 'assistant' })
    if (tool)
      send({
        tool_calls: [
          {
            index: 0,
            id: `call_${requests.length}`,
            type: 'function',
            function: {
              name: tool.name,
              arguments: JSON.stringify(tool.args ?? {}),
            },
          },
        ],
      })
    else send({ content })
    send({}, tool ? 'tool_calls' : 'stop')
    res.end('data: [DONE]\n\n')
  } catch (error) {
    if (!res.headersSent) res.writeHead(500)
    res.end('local fixture failure')
    console.error(error.message)
  }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`
const launch = async () => {
  app = await electron.launch({
    args: [root],
    env: {
      ...process.env,
      ELECTRON_RENDERER_URL: '',
      COVAN_USER_DATA_DIR: profile,
    },
  })
  page = await app.firstWindow()
  page.on('pageerror', (e) => pageErrors.push(e.message))
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(
    page.getByRole('button', { name: '设置', exact: true }),
  ).toBeVisible()
}
const api = (name, ...args) =>
  page.evaluate(({ name, args }) => window.covan[name](...args), {
    name,
    args,
  })
const namespaced = (id, name) =>
  `mcp_${createHash('sha256').update(id).digest('hex').slice(0, 12)}_${name.slice(0, 16)}_${createHash('sha256').update(name).digest('hex').slice(0, 8)}`
const send = async (chatId, tools = []) => {
  nextTools = [...tools]
  await page.evaluate(
    ({ chatId, content }) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          off()
          reject(new Error('Timed out waiting for generation-state idle'))
        }, 45000)
        const off = window.covan.onEvent((event) => {
          if (
            event.type === 'generation-state' &&
            event.chatId === chatId &&
            !event.generating
          ) {
            clearTimeout(timer)
            off()
            resolve()
          }
        })
        window.covan
          .sendUserMessage(chatId, content, [], [])
          .catch((error) => {
            clearTimeout(timer)
            off()
            reject(error)
          })
      }),
    { chatId, content: `Run local extension fixture ${requests.length}` },
  )
  return (await api('listMessages', chatId))
    .filter((m) => m.sender_type === 'bot')
    .at(-1)
}

try {
  await launch()
  await api('setSetting', 'local_observability', '1')
  await api('setSetting', 'natural_follow_up', '0')
  const provider = await api('saveProvider', {
    name: 'Extension loopback',
    kind: 'openai-compatible',
    base_url: `${base}/v1`,
    default_model: 'fixture',
    api_key: '',
  })
  const a = await api('createBot', {
    name: '研究助手',
    provider_id: provider.id,
  })
  const b = await api('createBot', {
    name: '写作助手',
    provider_id: provider.id,
  })
  const dm = await api('createDm', a.id)
  const otherDm = await api('createDm', b.id)
  assert.deepEqual(await api('getBotExtensions', a.id), {
    mcpServerIds: [],
    skillIds: [],
  })
  await page.reload()
  await page.getByRole('button', { name: '设置', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '设置' })
  await dialog.getByRole('button', { name: 'MCP', exact: true }).click()
  const global = page.getByTestId('global-extensions')
  await global.getByRole('button', { name: '安装', exact: true }).click()
  await global.getByLabel('名称', { exact: true }).fill('本地工具集')
  await global.getByLabel('启动命令').fill(process.execPath)
  await global
    .getByLabel('参数（JSON 数组）')
    .fill(
      JSON.stringify([
        path.join(root, 'scripts/fixtures/mcp-server.mjs'),
        pidFile,
      ]),
    )
  await global.getByRole('button', { name: '安装', exact: true }).click()
  await expect(global.getByText('本地工具集', { exact: true })).toBeVisible()
  await global
    .getByRole('button', { name: '测试 本地工具集', exact: true })
    .click()
  await expect(global.getByRole('status')).toContainText(
    '连接成功 · 3 个工具',
    { timeout: 20000 },
  )
  const stdio = (await api('listExtensions')).servers[0]
  const remote = await api('saveMcpServer', {
    name: '远程检索服务',
    transport: 'http',
    url: `${base}/mcp`,
    headers: { Authorization: `Bearer ${secret}` },
  })
  const legacy = await api('saveMcpServer', {
    name: 'SSE 文档服务',
    transport: 'sse',
    url: `${base}/sse`,
  })
  assert.equal((await api('testMcpServer', remote.id)).ok, true)
  assert.equal((await api('testMcpServer', legacy.id)).ok, true)
  assert.equal(
    JSON.stringify(await api('listExtensions')).includes(secret),
    false,
  )
  await api('saveMcpServer', { ...remote, name: '远程检索服务' })
  assert.equal(
    (await api('testMcpServer', remote.id)).ok,
    true,
    'editing without headers preserves encrypted credentials',
  )
  await page.screenshot({ path: path.join(artifacts, '01-mcp-library.png') })
  console.log(
    '✓ MCP installation UI, stdio/HTTP/SSE handshake, secret redaction and preservation',
  )

  await dialog.getByRole('button', { name: 'Skills', exact: true }).click()
  await global.getByRole('button', { name: '安装', exact: true }).click()
  await global.getByLabel('Skill 目录', { exact: true }).fill(skillDir)
  await global.getByRole('button', { name: '安装', exact: true }).click()
  await expect(global.getByRole('status')).toContainText('已安装 1 个 Skills')
  const skill = (await api('listExtensions')).skills[0]
  await global.getByRole('button', { name: `查看 ${skill.name}` }).click()
  await expect(
    global.getByRole('heading', { name: '写作工作流' }),
  ).toBeVisible()
  await global.getByRole('button', { name: '返回扩展列表' }).click()
  await page.screenshot({ path: path.join(artifacts, '02-skills-library.png') })
  await page.keyboard.press('Escape')
  await page
    .locator('aside')
    .first()
    .getByRole('button', { name: a.name, exact: true })
    .click()
  await page.getByRole('button', { name: '展开设置' }).click()
  const panel = page.getByRole('complementary', { name: 'Bot 设定' })
  await panel.getByRole('button', { name: '扩展', exact: true }).click()
  const botPanel = page.getByTestId('bot-extensions')
  await botPanel.getByRole('switch', { name: '装配 本地工具集' }).click()
  await expect(
    botPanel.getByRole('switch', { name: '装配 本地工具集' }),
  ).toHaveAttribute('aria-checked', 'true')
  await botPanel.getByRole('tab', { name: /Skills/ }).click()
  await botPanel.getByRole('switch', { name: `装配 ${skill.name}` }).click()
  await expect(
    botPanel.getByRole('switch', { name: `装配 ${skill.name}` }),
  ).toHaveAttribute('aria-checked', 'true')
  assert.deepEqual(await api('getBotExtensions', b.id), {
    mcpServerIds: [],
    skillIds: [],
  })
  await page.screenshot({ path: path.join(artifacts, '03-bot-equipment.png') })
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(960, 640),
  )
  await page.screenshot({
    path: path.join(artifacts, '04-bot-equipment-compact.png'),
  })
  assert.equal(
    await botPanel.evaluate((el) => el.scrollWidth > el.clientWidth + 1),
    false,
  )
  console.log(
    '✓ Skill installation/preview, per-Bot assignment and compact layout',
  )

  const managedSkillDir = path.join(
    profile,
    'skills',
    fs.readdirSync(path.join(profile, 'skills'))[0],
  )
  const reply = await send(dm.id, [
    { name: 'skill_read', args: { skillId: skill.id } },
    {
      name: 'skill_read',
      args: { skillId: skill.id, path: 'references/style.txt' },
    },
    {
      name: 'bash',
      args: { command: `/bin/bash '${managedSkillDir}/scripts/hello.sh'` },
    },
    {
      name: namespaced(stdio.id, 'fixture_echo'),
      args: { value: 'TOOL_PRIVATE_VALUE' },
    },
  ])
  assert.equal(reply.status, 'done')
  const transmitted = JSON.stringify(requests)
  assert.ok(transmitted.includes('SKILL_SCRIPT_OK'))
  assert.ok(transmitted.includes('STYLE_REFERENCE_PRIVATE'))
  assert.ok(transmitted.includes('MCP_RESULT:TOOL_PRIVATE_VALUE'))
  const report = await api('getDiagnosticReport', reply.id)
  for (const event of [
    'mcp.connect.completed',
    'mcp.tools.discovered',
    'mcp.call.completed',
    'skill.read.completed',
  ])
    assert.ok(
      report.events.some((e) => e.event === event),
      event,
    )
  assert.ok(
    report.events
      .filter((e) => e.fields.server_id)
      .every((e) => e.fields.server_id !== stdio.id),
  )
  const log = fs.readFileSync(
    path.join(profile, 'logs', 'observability.jsonl'),
    'utf8',
  )
  for (const privateText of [
    secret,
    'SKILL_PRIVATE_BODY',
    'TOOL_PRIVATE_VALUE',
    'STYLE_REFERENCE_PRIVATE',
  ])
    assert.equal(log.includes(privateText), false)
  const before = requests.length
  await send(otherDm.id, [
    {
      name: 'bash',
      args: { command: `cat '${managedSkillDir}/references/style.txt'` },
    },
  ])
  const unassignedRequests = requests
    .slice(before)
    .filter((r) => r.tools?.length)
  assert.ok(
    unassignedRequests.every(
      (r) =>
        !r.tools.some(
          (t) =>
            t.function.name.startsWith('mcp_') ||
            t.function.name === 'skill_read',
        ),
    ),
  )
  assert.ok(
    /Operation not permitted|Permission denied/.test(
      JSON.stringify(unassignedRequests),
    ),
  )
  assert.equal(
    JSON.stringify(unassignedRequests).includes('STYLE_REFERENCE_PRIVATE'),
    false,
  )
  await send(dm.id, [
    {
      name: 'bash',
      args: {
        command: `echo MUTATED > '${managedSkillDir}/references/style.txt'`,
      },
    },
  ])
  assert.equal(
    fs.readFileSync(path.join(managedSkillDir, 'references/style.txt'), 'utf8'),
    'STYLE_REFERENCE_PRIVATE',
  )
  console.log(
    '✓ Real Agent MCP calls, lazy Skill reads/scripts, trace logs and cross-Bot read/write isolation',
  )

  await send(dm.id, [
    {
      name: 'configure_extensions',
      args: { mcpServerIds: [remote.id, legacy.id], skillIds: [skill.id] },
    },
  ])
  assert.deepEqual((await api('getBotExtensions', a.id)).mcpServerIds, [
    remote.id,
    legacy.id,
  ])
  await send(dm.id, [
    { name: namespaced(remote.id, 'fixture_echo'), args: { value: 'HTTP' } },
    { name: namespaced(legacy.id, 'fixture_echo'), args: { value: 'SSE' } },
  ])
  assert.ok(mcpCalls.filter((name) => name === 'fixture_echo').length >= 2)
  const failedTool = await send(dm.id, [
    { name: namespaced(remote.id, 'fixture_error') },
  ])
  assert.ok(
    (await api('getDiagnosticReport', failedTool.id)).events.some(
      (e) => e.event === 'tool.completed' && e.fields.is_error,
    ),
  )
  const broken = await api('saveMcpServer', {
    name: 'Unavailable',
    transport: 'http',
    url: `${base}/broken`,
  })
  await api('setBotExtensions', a.id, {
    mcpServerIds: [broken.id],
    skillIds: [skill.id],
  })
  const degraded = await send(dm.id)
  assert.equal(degraded.status, 'done')
  assert.ok(
    (await api('getDiagnosticReport', degraded.id)).events.some(
      (e) => e.event === 'mcp.connect.failed',
    ),
  )
  await api('setBotExtensions', a.id, {
    mcpServerIds: [remote.id],
    skillIds: [skill.id],
  })
  const inflight = send(dm.id, [
    { name: namespaced(remote.id, 'fixture_slow') },
  ])
  await expect.poll(() => mcpCalls.includes('fixture_slow')).toBe(true)
  await api('stopChat', dm.id)
  await inflight
  await expect
    .poll(
      async () =>
        (await api('listMessages', dm.id))
          .filter((m) => m.sender_type === 'bot')
          .at(-1)?.status,
    )
    .toBe('stopped')
  const stalled = await api('saveMcpServer', {
    name: 'Handshake stall',
    transport: 'sse',
    url: `${base}/sse-stall`,
  })
  await api('setBotExtensions', a.id, {
    mcpServerIds: [stalled.id],
    skillIds: [],
  })
  const connecting = send(dm.id)
  await expect.poll(() => mcpCalls.includes('connecting')).toBe(true)
  await api('stopChat', dm.id)
  assert.equal((await connecting).status, 'stopped')
  const timeout = await api('testMcpServer', stalled.id)
  assert.equal(timeout.ok, false)
  assert.match(timeout.error, /timeout/)
  await api('setBotExtensions', a.id, {
    mcpServerIds: [remote.id],
    skillIds: [skill.id],
  })
  console.log(
    '✓ Agent self-assembly, HTTP/SSE execution, remote errors, graceful connection failure and cancellation',
  )

  await api('setSkillEnabled', skill.id, false)
  const disabledAt = requests.length
  await send(dm.id)
  assert.ok(
    requests
      .slice(disabledAt)
      .every((r) => !r.tools?.some((t) => t.function.name === 'skill_read')),
  )
  await api('setSkillEnabled', skill.id, true)
  const escaped = await send(dm.id, [
    {
      name: 'skill_read',
      args: { skillId: skill.id, path: '../../covan.db' },
    },
  ])
  assert.ok(
    (await api('getDiagnosticReport', escaped.id)).events.some(
      (e) => e.event === 'skill.read.failed',
    ),
  )
  const updated = await api('installSkills', skillDir)
  assert.equal(updated[0].id, skill.id)
  assert.ok((await api('getBotExtensions', a.id)).skillIds.includes(skill.id))
  const invalidDir = path.join(fixtures, 'bad-skill')
  fs.mkdirSync(invalidDir)
  fs.writeFileSync(
    path.join(invalidDir, 'SKILL.md'),
    '---\nname: bad-skill\ndescription: bad\n---\n',
  )
  fs.symlinkSync(
    path.join(skillDir, 'references'),
    path.join(invalidDir, 'escape'),
  )
  await assert.rejects(() => api('installSkills', invalidDir), /符号链接/)
  await assert.rejects(() => api('installSkills', skillDir, '..'), /不能超出/)
  await assert.rejects(
    () =>
      api('saveMcpServer', {
        name: 'bad',
        transport: 'http',
        url: `${base}/mcp?key=${secret}`,
      }),
    /认证请使用请求头/,
  )
  await assert.rejects(
    () =>
      api('setBotExtensions', a.id, {
        mcpServerIds: ['missing'],
        skillIds: [],
      }),
    /已被卸载/,
  )
  const task = await api('saveScheduledTask', {
    bot_id: a.id,
    chat_id: dm.id,
    title: '扩展定时回归',
    prompt: '执行本地扩展',
    schedule: 'once',
    run_at: Date.now() + 3600000,
    enabled: false,
  })
  nextTools = [
    {
      name: namespaced(remote.id, 'fixture_echo'),
      args: { value: 'SCHEDULED' },
    },
  ]
  await api('runScheduledTask', task.id)
  const scheduledReply = (await api('listMessages', dm.id))
    .filter((m) => m.sender_type === 'bot')
    .at(-1)
  const scheduledReport = await api('getDiagnosticReport', scheduledReply.id)
  assert.ok(
    scheduledReport.events.some((e) => e.event === 'mcp.call.completed'),
  )
  assert.ok(
    scheduledReport.events.some((e) => e.event === 'scheduled_task.completed'),
  )
  await app.close()
  await launch()
  assert.deepEqual(await api('getBotExtensions', a.id), {
    mcpServerIds: [remote.id],
    skillIds: [skill.id],
  })
  assert.equal((await api('testMcpServer', remote.id)).ok, true)
  await api('deleteMcpServer', remote.id)
  await api('deleteSkill', skill.id)
  assert.deepEqual(await api('getBotExtensions', a.id), {
    mcpServerIds: [],
    skillIds: [],
  })
  console.log(
    '✓ Disable/update persistence, validation, scheduled inheritance, restart and uninstall cascade',
  )

  await app.close()
  app = undefined
  for (const pid of fs
    .readFileSync(pidFile, 'utf8')
    .trim()
    .split('\n')
    .map(Number)) {
    assert.throws(
      () => process.kill(pid, 0),
      'stdio child must exit after the run',
    )
  }
  assert.equal(
    fs
      .readFileSync(path.join(profile, 'covan.db'))
      .includes(Buffer.from(secret)),
    false,
  )
  assert.deepEqual(pageErrors, [])
  console.log(`Extension regression passed. Screenshots: ${artifacts}`)
} finally {
  await app?.close().catch(() => {})
  await Promise.allSettled([...liveServers].map((s) => s.close()))
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  fs.rmSync(profile, { recursive: true, force: true })
  fs.rmSync(fixtures, { recursive: true, force: true })
}
