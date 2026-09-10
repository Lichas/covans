// Real Electron + loopback model/image API. Never touches the user's profile or paid services.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { expect } from '@playwright/test'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'covan-context-ui-'))
const artifacts = path.join(root, 'artifacts', 'context')
fs.mkdirSync(artifacts, { recursive: true })
const requests = []
const proxyRequests = []
const errors = []
let sequence = []
let app, page
const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6T90AAAAASUVORK5CYII='
const server = http.createServer(async (req, res) => {
  try {
    if (req.url === '/v1/models') {
      res.setHeader('Content-Type', 'application/json')
      res.end(
        JSON.stringify({ data: [{ id: 'test-agent' }, { id: 'test-image' }] }),
      )
      return
    }
    let raw = ''
    for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw || '{}')
    requests.push({ url: req.url, body })
    if (req.url === '/v1/images/generations') {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ data: [{ b64_json: png }] }))
      return
    }
    const system =
      body.messages
        ?.filter((m) => m.role === 'system' || m.role === 'developer')
        .map((m) => m.content)
        .join('\n') || ''
    let content = '已完成，我已经更新设定、记住你的偏好，并咨询了设计伙伴。'
    let tool
    if (system.includes('<<memory-scene-summary>>')) {
      const input = JSON.parse(body.messages?.find((message) => message.role === 'user')?.content || '[]')
      const latest = input.at(-1)
      content = JSON.stringify({ short_summary: '当前围绕：' + String(latest?.content || '').slice(0, 68), summary: '围绕当前话题整理了参与者的最新信息，等待后续确认。', evidence_ids: input.map((item) => item.source_id), memories: [] })
    } else if (system.includes('当前为 Agent 私聊'))
      content =
        '## 设计建议\n采用清晰层级与柔和留白。\n\n- 顶部只显示已置顶 Bot\n- 私聊放在轻量浮窗中'
    else if (system.includes('橙色的天空来自意大利') &&
      body.messages?.some((message) => message.role === 'user' && JSON.stringify(message.content).includes('橙色的天空来自哪里')))
      content = '小蓝曾在私聊里告诉我：橙色的天空来自意大利。这是他转达的说法。'
    else if (system.includes('头像艺术指导'))
      content = JSON.stringify({
        prompt: '蓝色机器人，柔和的编辑插画，简洁背景，圆形裁切，无文字',
        style: 'robot',
        palette: 'ocean',
      })
    else if (body.tools?.some((t) => t.function?.name === 'update_bot'))
      tool = sequence.shift()
    else content = '[]'
    if (body.stream === false) {
      res.setHeader('Content-Type', 'application/json')
      res.end(
        JSON.stringify({
          id: 'response',
          object: 'chat.completion',
          model: body.model,
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 20 },
        }),
      )
      return
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    const send = (delta, reason = null) =>
      res.write(
        'data: ' +
          JSON.stringify({
            id: 'test-response',
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: body.model,
            choices: [{ index: 0, delta, finish_reason: reason }],
          }) +
          '\n\n',
      )
    send({ role: 'assistant' })
    if (tool)
      send({
        tool_calls: [
          {
            index: 0,
            id: 'call-' + requests.length,
            type: 'function',
            function: { name: tool.name, arguments: JSON.stringify(tool.args) },
          },
        ],
      })
    else send({ content })
    send({}, tool ? 'tool_calls' : 'stop')
    res.end('data: [DONE]\n\n')
  } catch (e) {
    errors.push(String(e))
    res.statusCode = 500
    res.end('test server failure')
  }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}/v1`
const proxyServer = http.createServer((req, res) => {
  try {
    const target = new URL(req.url)
    proxyRequests.push(target.toString())
    if (target.hostname !== 'public.test' || target.pathname !== '/article') {
      res.statusCode = 502
      res.end('unexpected proxy target')
      return
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(
      `<html><head><title>动态代理网页</title></head><body><main id="root"></main><script>
        setTimeout(() => {
          document.querySelector('#root').innerHTML = '<h1>代理网页</h1><p>COVAN_BROWSER_JS_OK</p>'
        }, 100)
      </script></body></html>`,
    )
  } catch (error) {
    errors.push(String(error))
    res.statusCode = 500
    res.end('proxy fixture failure')
  }
})
await new Promise((resolve) => proxyServer.listen(0, '127.0.0.1', resolve))
const proxyPort = proxyServer.address().port
try {
  app = await electron.launch({
    args: [
      root,
      `--proxy-server=http://127.0.0.1:${proxyPort}`,
      '--host-resolver-rules=MAP public.test 198.18.0.42',
    ],
    env: {
      ...process.env,
      ELECTRON_RENDERER_URL: '',
      COVAN_USER_DATA_DIR: profile,
    },
  })
  page = await app.firstWindow()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  page.on('pageerror', (e) => errors.push(e.message))
  await expect(
    page.getByRole('heading', { name: '好想法，从对话开始。' }),
  ).toBeVisible()
  const fixture = await page.evaluate(async (base) => {
    const api = window.covan
    const p = await api.saveProvider({
      name: '本地模拟服务',
      kind: 'openai-compatible',
      base_url: base,
      api_key: '',
      default_model: 'test-agent',
    })
    const mock = await api.saveProvider({ name: '测试慢速流', kind: 'mock' })
    const bots = []
    for (const name of ['开发伙伴', '设计伙伴', '产品伙伴', '第四位伙伴'])
      bots.push(await api.createBot({ name, provider_id: p.id }))
    const slow = await api.createBot({ name: '慢速伙伴', provider_id: mock.id })
    const bad = await api.createBot({ name: '未配置伙伴' })
    const chats = []
    for (const bot of bots) chats.push(await api.createDm(bot.id))
    const group = await api.createGroup(
      '测试群',
      bots.slice(0, 2).map((b) => b.id),
    )
    return { p, bots, chats, group, slow, bad }
  }, base)
  assert.ok(
    fixture.bots.every((bot) => bot.avatar.startsWith('avatars/preset/')),
    '新 Bot 应从内置头像集中获得默认头像',
  )
  await page.reload()
  const sidebar = page.locator('aside').first()
  const item = (name) => sidebar.getByRole('button', { name, exact: true })
  await expect(page.locator('.pinned-bots')).toHaveCount(0)
  for (const name of ['开发伙伴', '设计伙伴', '产品伙伴']) {
    await item(name).click({ button: 'right' })
    await page.getByRole('menuitem', { name: '置顶', exact: false }).click()
  }
  await expect(page.locator('.pinned-bots > button')).toHaveCount(3)
  await item('第四位伙伴').click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: /置顶/ })).toHaveAttribute(
    'aria-disabled',
    'true',
  )
  await expect(page.getByRole('menu')).toContainText('已置顶 3 个')
  await page.keyboard.press('Escape')
  const pinFailure = await page.evaluate(async (id) => {
    try {
      await window.covan.updateBot(id, { pinned: true })
      return ''
    } catch (e) {
      return String(e)
    }
  }, fixture.bots[3].id)
  assert.match(pinFailure, /最多置顶 3/)
  await item('产品伙伴').click({ button: 'right' })
  await page.getByRole('menuitem', { name: /取消置顶/ }).click()
  await expect(page.locator('.pinned-bots > button')).toHaveCount(2)
  await item('第四位伙伴').click({ button: 'right' })
  await page.getByRole('menuitem', { name: /置顶/ }).click()
  await item('测试群').click({ button: 'right' })
  const groupMenu = page.getByRole('menu', { name: '群聊操作' })
  await expect(groupMenu).toBeVisible()
  await expect(groupMenu.getByRole('menuitem')).toHaveCount(1)
  await expect(
    groupMenu.getByRole('menuitem', { name: '删除群聊' }),
  ).toBeVisible()
  page.once('dialog', async (dialog) => {
    assert.match(dialog.message(), /全部聊天记录.*永久删除/)
    await dialog.accept()
  })
  await groupMenu.getByRole('menuitem', { name: '删除群聊' }).click()
  await expect(item('测试群')).toHaveCount(0)
  assert.equal(
    (await page.evaluate(() => window.covan.listChats())).some(
      (chat) => chat.name === '测试群',
    ),
    false,
  )
  console.log(
    '✓ Right-click DM pin/unpin, 3-Bot cap, and permanent group deletion',
  )

  await page.getByRole('button', { name: '关于我', exact: false }).click()
  await page.getByLabel('怎么称呼我').fill('Lua')
  await page.getByLabel('我的角色').fill('独立开发者')
  await page.getByLabel('交流与生活偏好').fill('中文，简洁直接，先给结论')
  await page
    .getByLabel('我正在关注的目标')
    .fill('把 Covan 打造成有温度的多 Agent 工作台')
  await page.getByRole('button', { name: '保存资料' }).click()
  await expect(page.getByRole('status')).toContainText('资料已保存')
  const userPresets = await page.evaluate(() =>
    window.covan.listUserPresetAvatars(),
  )
  assert.equal(userPresets.length, 9, '应提供 9 张用户默认头像')
  assert.ok(
    userPresets.every((preset) => fs.existsSync(path.join(profile, preset.avatar))),
    '用户默认头像应复制进隔离 profile',
  )
  await page.getByRole('button', { name: '选择默认头像 1' }).click()
  await expect(page.getByRole('status')).toContainText('默认头像 1已应用')
  await expect(
    sidebar.getByRole('img', { name: 'Lua', exact: true }),
  ).toBeVisible()
  assert.ok(
    (await sidebar
      .getByRole('img', { name: 'Lua', exact: true })
      .evaluate((image) => image.naturalWidth)) > 0,
    '侧边栏应能读取已选中的用户默认头像',
  )
  await page.screenshot({ path: path.join(artifacts, 'about-me.png') })
  await page.getByRole('button', { name: /对我的了解/ }).click()
  await page.getByLabel('补充一件关于我的事').fill('喜欢暖灰色、克制的界面')
  await page.getByRole('button', { name: '添加记忆' }).click()
  await expect(page.locator('.user-memory-row')).toContainText('暖灰色')
  await page.getByRole('button', { name: '编辑记忆' }).click()
  await page.getByLabel('编辑这条记忆').fill('喜欢柔和、低饱和的界面')
  await page.getByRole('button', { name: '保存修改' }).click()
  await expect(page.locator('.user-memory-row')).toContainText('低饱和')
  await page.keyboard.press('Escape')
  await page.reload()
  assert.equal(
    await page.evaluate(
      async () => (await window.covan.getUserProfile()).name,
    ),
    'Lua',
  )
  assert.equal(
    (await page.evaluate(() => window.covan.listUserMemories())).length,
    1,
  )
  console.log('✓ Shared user profile and memory CRUD, persisted across reload')

  await item('开发伙伴').click()
  await page.getByRole('button', { name: '展开设置' }).click()
  await page.getByRole('button', { name: '模型', exact: true }).click()
  await page.getByLabel('推理强度').selectOption('low')
  await page.getByLabel('最大输出 Token').fill('512')
  await page.getByLabel('最大输出 Token').press('Tab')
  await expect.poll(async () => {
    const bots = await page.evaluate(() => window.covan.listBots())
    const bot = bots.find((item) => item.name === '开发伙伴')
    return `${bot?.reasoning_effort}:${bot?.max_tokens}`
  }).toBe('low:512')
  console.log('✓ Per-Bot reasoning effort and output limit persist')
  await page.getByRole('button', { name: '更换头像', exact: true }).click()
  await page.getByRole('button', { name: 'AI 生图', exact: true }).click()
  await page.getByLabel('生成方式').selectOption('local')
  await page.getByLabel('头像画面与风格').fill('蓝色机器人')
  await page.getByRole('button', { name: '生成并应用', exact: true }).click()
  await expect(page.getByRole('dialog').getByRole('status')).toContainText(
    '本地插画',
  )
  await expect(
    page.getByRole('dialog').getByRole('img', { name: '开发伙伴' }),
  ).toBeVisible()
  assert.equal(
    await page
      .getByRole('dialog')
      .getByRole('img', { name: '开发伙伴' })
      .evaluate((el) => el.naturalWidth),
    256,
  )
  await page.getByRole('button', { name: '根据人设扩写', exact: true }).click()
  await expect(page.getByLabel('头像画面与风格')).toHaveValue(/蓝色机器人/)
  await page.screenshot({ path: path.join(artifacts, 'avatar-local.png') })
  await page.getByRole('button', { name: /AI 生图/ }).click()
  await page.getByLabel('生成方式').selectOption('image')
  await page.getByRole('button', { name: '生成并应用', exact: true }).click()
  await expect(page.getByRole('dialog').getByRole('status')).toContainText(
    '配置生图',
  )
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByRole('button', { name: '头像生成', exact: true }).click()
  await page.getByLabel('生图 Provider').selectOption(fixture.p.id)
  await page.getByRole('button', { name: '拉取模型', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('已拉取 2 个模型')
  await page.getByLabel('生图模型', { exact: true }).fill('test-image')
  await page.getByRole('button', { name: '保存生图设置' }).click()
  await expect(page.getByRole('status')).toContainText('已保存')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '更换头像', exact: true }).click()
  await page.getByRole('button', { name: /AI 生图/ }).click()
  await page.getByLabel('生成方式').selectOption('image')
  await page.getByLabel('头像画面与风格').fill('动漫角色，柔和光线')
  await page.getByRole('button', { name: '生成并应用', exact: true }).click()
  await expect(page.getByRole('dialog').getByRole('status')).toContainText(
    'AI 图片头像',
  )
  assert.ok(
    requests.some(
      (r) =>
        r.url === '/v1/images/generations' &&
        r.body.model === 'test-image' &&
        r.body.prompt.includes('动漫'),
    ),
  )
  assert.ok(
    !requests.some((request) =>
      JSON.stringify(request.body).includes('avatars/preset/'),
    ),
    '用户头像路径不应发送给模型服务',
  )
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '收起设置' }).click()
  console.log(
    '✓ Local SVG loaded, prompt expansion, unconfigured error, model fetch, Images API fixture',
  )

  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByRole('button', { name: 'Bot', exact: true }).click()
  const naturalFollowUpCard = page
    .getByText('自然追问', { exact: true })
    .locator('xpath=../..')
  const naturalFollowUpSwitch = naturalFollowUpCard.getByRole('switch')
  await expect(naturalFollowUpSwitch).toHaveAttribute('aria-checked', 'true')
  await naturalFollowUpSwitch.click()
  await expect(naturalFollowUpSwitch).toHaveAttribute('aria-checked', 'false')
  await expect.poll(() => page.evaluate(() => window.covan.getSetting('natural_follow_up'))).toBe('0')
  await naturalFollowUpSwitch.click()
  await expect.poll(() => page.evaluate(() => window.covan.getSetting('natural_follow_up'))).toBe('1')
  await page.getByRole('button', { name: '通用', exact: true }).click()
  const observabilityCard = page
    .getByText('本地观测日志', { exact: true })
    .locator('xpath=../..')
  const observabilitySwitch = observabilityCard.getByRole('switch')
  await expect(observabilitySwitch).toHaveAttribute('aria-checked', 'false')
  await observabilitySwitch.click()
  await expect
    .poll(() =>
      page.evaluate(() => window.covan.getSetting('local_observability')),
    )
    .toBe('1')
  await page.keyboard.press('Escape')
  console.log(
    '✓ Natural follow-up and privacy-safe local observability settings persist',
  )

  sequence = [
    {
      name: 'update_bot',
      args: { name: '小蓝', description: '蓝色机器人开发伙伴' },
    },
    {
      name: 'remember_user',
      args: { content: '用户喜欢先看结论', kind: 'preference' },
    },
    { name: 'expand_avatar_prompt', args: { direction: '蓝色机器人' } },
    {
      name: 'generate_bot_avatar',
      args: { mode: 'local', prompt: '蓝色机器人' },
    },
    { name: 'list_bots', args: {} },
    {
      name: 'agent_private_chat',
      args: {
        to_bot_id: fixture.bots[1].id,
        message: '请给 Covan 的私聊浮窗一些设计建议',
      },
    },
    {
      name: 'workspace_write',
      args: {
        path: 'notes/tool-check.md',
        content: '# Tool check\n\n文件工具已连通。',
      },
    },
    {
      name: 'workspace_edit',
      args: {
        path: 'notes/tool-check.md',
        old_text: '文件工具已连通。',
        new_text: '文件读写与精确编辑已连通。',
      },
    },
    { name: 'workspace_list', args: {} },
    {
      name: 'workspace_read',
      args: { path: 'notes/tool-check.md', offset: 1, limit: 20 },
    },
    {
      name: 'bash',
      args: { command: "printf 'bash-loop-ok' > notes/bash-check.txt" },
    },
    {
      name: 'web_fetch',
      args: { url: 'http://public.test/article' },
    },
  ]
  await page
    .getByRole('textbox', { name: '输入消息' })
    .fill(
      '请改名为小蓝，生成蓝色机器人头像，记住我喜欢先看结论，再请设计伙伴提建议。',
    )
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: '小蓝', exact: true }),
  ).toBeVisible({ timeout: 20000 })
  await expect(page.locator('.agent-conversation-card')).toHaveCount(1, {
    timeout: 20000,
  })
  await expect(page.locator('.agent-conversation-card')).toContainText(
    '已完成',
    { timeout: 20000 },
  )
  await expect(
    page.locator('article[data-status="done"] .markdown-content'),
  ).toContainText('已完成')
  const artifactCard = page.locator('.artifact-card')
  await expect(artifactCard).toHaveCount(1)
  await expect(artifactCard).toContainText('已交付 1 个文件')
  await expect(artifactCard).toContainText('tool-check.md')
  await artifactCard.getByRole('button', { name: '预览' }).click()
  await expect(artifactCard.locator('.artifact-preview')).toContainText(
    '文件读写与精确编辑已连通。',
  )
  assert.equal(sequence.length, 0)
  assert.equal(
    fs.readFileSync(
      path.join(
        profile,
        'workspaces',
        fixture.bots[0].id,
        'notes',
        'tool-check.md',
      ),
      'utf8',
    ),
    '# Tool check\n\n文件读写与精确编辑已连通。',
  )
  assert.equal(
    fs.readFileSync(
      path.join(
        profile,
        'workspaces',
        fixture.bots[0].id,
        'notes',
        'bash-check.txt',
      ),
      'utf8',
    ),
    'bash-loop-ok',
    '真实 Agent tool-call/result 循环应执行 Bash 命令',
  )
  const normalToolRequest = requests.find((r) =>
    r.body.tools?.some((tool) => tool.function?.name === 'web_search'),
  )
  assert.ok(normalToolRequest, '普通 Agent 请求应挂载网页工具')
  assert.equal(
    normalToolRequest.body.messages.at(-1)?.role,
    'user',
    '最新用户输入应作为本轮显式 query 发给 OpenAI-compatible/LM Studio',
  )
  assert.ok(
    [
      'workspace_read',
      'workspace_write',
      'workspace_edit',
      'workspace_list',
      'bash',
      'web_search',
      'web_fetch',
    ].every((name) =>
      normalToolRequest.body.tools.some((tool) => tool.function?.name === name),
    ),
  )
  assert.ok(
    requests.some((r) =>
      JSON.stringify(r.body.messages || []).includes('COVAN_BROWSER_JS_OK'),
    ),
    'Fake-IP 动态页执行 JavaScript 后的内容应回灌模型',
  )
  assert.ok(
    proxyRequests.includes('http://public.test/article'),
    'web_fetch 应通过 Electron 系统代理传输',
  )
  assert.ok(
    requests.some(
      (r) =>
        JSON.stringify(r.body.messages?.[0] || '').includes('Lua') &&
        JSON.stringify(r.body.messages?.[0] || '').includes('低饱和'),
    ),
  )
  const peerRequest = requests.find((r) =>
    JSON.stringify(r.body.messages?.[0] || '').includes('当前为 Agent 私聊'),
  )
  assert.ok(peerRequest)
  assert.ok(
    peerRequest.body.tools.every((t) =>
      [
        'workspace_list',
        'workspace_read',
        'web_search',
        'web_fetch',
      ].includes(t.function.name),
    ),
  )
  assert.ok(
    !peerRequest.body.tools.some((t) =>
      ['workspace_write', 'workspace_edit', 'bash'].includes(t.function.name),
    ),
  )
  const memories = await page.evaluate(() => window.covan.listUserMemories())
  assert.equal(
    memories.find((m) => m.source === 'agent').source_bot_id,
    fixture.bots[0].id,
  )
  const threads = await page.evaluate(
    (id) => window.covan.listAgentThreads(id),
    fixture.chats[0].id,
  )
  const messages = await page.evaluate(
    (id) => window.covan.listMessages(id),
    fixture.chats[0].id,
  )
  const delivered = messages.find((m) => m.artifacts?.length)
  assert.equal(delivered.artifacts.length, 1)
  assert.equal(delivered.artifacts[0].relPath, 'notes/tool-check.md')
  assert.equal(delivered.artifacts[0].operation, 'edit')
  assert.equal(
    threads[0].origin_message_id,
    messages.find((m) => m.sender_type === 'user').id,
  )
  await page.screenshot({ path: path.join(artifacts, 'private-card.png') })
  await page.locator('.agent-conversation-card').click()
  await expect(page.getByRole('dialog', { name: 'Agent 私聊' })).toBeVisible()
  await expect(page.locator('.peer-message')).toHaveCount(2)
  await expect(page.locator('.peer-transcript')).toContainText('设计建议')
  await page.screenshot({ path: path.join(artifacts, 'private-dialog.png') })
  await page.keyboard.press('Escape')
  await page.reload()
  await expect(page.locator('.agent-conversation-card')).toHaveCount(1)
  console.log(
    '✓ Real tool loop: app actions, workspace tools, automatic Chromium JS fallback through Fake-IP proxy',
  )

  await page.evaluate(
    (f) =>
      window.covan.startAgentConversation(
        f.chats[0].id,
        f.bots[0].id,
        f.slow.id,
        '请慢慢分析如何打磨交互',
      ),
    fixture,
  )
  await expect(page.locator('.agent-conversation-card')).toHaveCount(2)
  await page.locator('.agent-conversation-card').last().click()
  await expect(page.locator('.peer-message').last()).toContainText('我是')
  await page.getByRole('button', { name: '停止私聊' }).click()
  await expect(page.getByRole('dialog')).toContainText('已停止')
  await expect(page.locator('.peer-message').last()).toContainText(
    '保留以上内容',
  )
  await page.keyboard.press('Escape')
  const badThread = await page.evaluate(
    async (f) =>
      window.covan.startAgentConversation(
        f.chats[0].id,
        f.bots[0].id,
        f.bad.id,
        '测试错误',
      ),
    fixture,
  )
  await expect
    .poll(
      async () =>
        await page.evaluate(
          async (id) => (await window.covan.getAgentThread(id)).thread.status,
          badThread,
        ),
    )
    .toBe('error')
  const selfFailure = await page.evaluate(async (f) => {
    try {
      await window.covan.startAgentConversation(
        f.chats[0].id,
        f.bots[0].id,
        f.bots[0].id,
        '自己',
      )
      return ''
    } catch (e) {
      return String(e)
    }
  }, fixture)
  assert.match(selfFailure, /另一个 Bot/)
  await page.getByRole('button', { name: /关于我/ }).click()
  await page.getByRole('button', { name: /对我的了解/ }).click()
  await expect(page.locator('.user-memory-row')).toHaveCount(2)
  await page.screenshot({ path: path.join(artifacts, 'shared-memory.png') })
  await page.getByRole('button', { name: '删除记忆' }).first().click()
  await expect(page.locator('.user-memory-row')).toHaveCount(1)
  await page.keyboard.press('Escape')
  const memoryThread = await page.evaluate(async (f) => {
    await window.covan.setSetting('natural_follow_up', '0')
    return window.covan.startAgentConversation(f.chats[0].id, f.bots[0].id, f.bots[1].id, '橙色的天空来自意大利')
  }, fixture)
  await expect.poll(() => page.evaluate(async (id) => (await window.covan.getAgentThread(id)).thread.status, memoryThread)).toBe('done')
  const memoriesByOwner = await page.evaluate(async (f) => Promise.all(f.bots.slice(0, 3).map((bot) => window.covan.listMemories(bot.id))), fixture)
  for (const owner of memoriesByOwner.slice(0, 2)) {
    const record = owner.find((m) => m.scene_id === memoryThread && m.content === '橙色的天空来自意大利')
    assert.equal(record.layer, 'evidence')
    assert.equal(record.representation, 'verbatim')
    assert.equal(record.speaker, fixture.bots[0].id)
    assert.deepEqual(record.participants, [fixture.bots[0].id, fixture.bots[1].id])
  }
  assert.ok(!memoriesByOwner[2].some((m) => m.scene_id === memoryThread))
  const requestStart = requests.length
  await page.evaluate((id) => window.covan.sendUserMessage(id, '橙色的天空来自哪里', []), fixture.chats[1].id)
  await expect.poll(() => requests.slice(requestStart).some((r) => r.body.stream && r.body.messages?.some((m) => m.role === 'user' && JSON.stringify(m.content).includes('橙色的天空来自哪里')))).toBe(true)
  const recallRequest = requests.slice(requestStart).find((r) => r.body.stream && r.body.messages?.some((m) =>
    m.role === 'user' && JSON.stringify(m.content).includes('橙色的天空来自哪里')))
  const recallSystem = recallRequest.body.messages.filter((m) => ['system', 'developer'].includes(m.role)).map((m) => m.content).join('\n')
  assert.match(recallSystem, /橙色的天空来自意大利/)
  assert.match(recallSystem, /"发言者":"小蓝"/)
  assert.match(recallSystem, /"来源":"private"/)
  await expect.poll(() => page.evaluate(async (id) =>
    (await window.covan.listMessages(id)).some((message) =>
      message.status === 'done' && message.sender_type === 'bot' && message.content.includes('这是他转达的说法')),
  fixture.chats[1].id)).toBe(true)
  await item('设计伙伴').click()
  await expect(page.locator('.message-row').last()).toContainText('这是他转达的说法')
  if (await page.getByRole('button', { name: '展开设置', exact: true }).count())
    await page.getByRole('button', { name: '展开设置', exact: true }).click()
  await page.getByRole('button', { name: '记忆', exact: true }).click()
  await page.getByRole('button', { name: '原文', exact: true }).click()
  const sourceRow = page.locator('.memory-row').filter({ hasText: '橙色的天空来自意大利' }).filter({ hasText: '小蓝说过' })
  await expect(sourceRow).toHaveCount(1)
  await expect(sourceRow).toContainText('Bot 私聊')
  await page.screenshot({ path: path.join(artifacts, 'layered-memory.png') })
  await sourceRow.getByRole('button', { name: '删除记忆' }).click()
  await expect(sourceRow).toHaveCount(0)
  await page.getByRole('button', { name: '长期', exact: true }).click()
  await page.evaluate((id) => window.covan.addMemory(id, '长期面板实时刷新测试'), fixture.bots[1].id)
  await expect(page.locator('.memory-row')).toContainText('长期面板实时刷新测试')
  await page.reload()
  const persistedMemories = await page.evaluate((id) => window.covan.listMemories(id), fixture.bots[1].id)
  assert.ok(persistedMemories.some((m) => m.content === '长期面板实时刷新测试' && m.layer === 'long'))
  assert.ok(!persistedMemories.some((m) => m.scene_id === memoryThread && m.content === '橙色的天空来自意大利'))
  console.log('✓ 双向私聊记忆、隔离、接收方跨会话模型输入、分层 UI、实时刷新和删除持久化')
  assert.deepEqual(errors, [])
  const observationLog = fs.readFileSync(
    path.join(profile, 'logs', 'observability.jsonl'),
    'utf8',
  )
  assert.match(observationLog, /"event":"agent\.run\.started"/)
  assert.match(observationLog, /"event":"provider\.payload\.ready"/)
  assert.match(observationLog, /"payload_last_role":"user"/)
  assert.doesNotMatch(observationLog, /请改名为小蓝|文件工具已连通|API Key/)
  console.log(
    '✓ Private-chat errors and privacy-safe local observation metadata',
  )
  console.log('Context UI regression passed. Screenshots: ' + artifacts)
} catch (e) {
  if (page)
    await page
      .screenshot({ path: path.join(artifacts, 'failure.png') })
      .catch(() => {})
  throw e
} finally {
  await app?.close()
  await new Promise((resolve) => server.close(resolve))
  await new Promise((resolve) => proxyServer.close(resolve))
  fs.rmSync(profile, { recursive: true, force: true })
}
