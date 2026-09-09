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
    if (system.includes('当前为 Agent 私聊'))
      content =
        '## 设计建议\n采用清晰层级与柔和留白。\n\n- 顶部只显示已置顶 Bot\n- 私聊放在轻量浮窗中'
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
try {
  app = await electron.launch({
    args: [root],
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
  await expect(page.getByRole('menu')).toHaveCount(0)
  console.log(
    '✓ Right-click DM pin/unpin, no empty slots, 3-Bot UI and backend cap, no group pin',
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
  await page.getByRole('button', { name: '设计头像', exact: true }).click()
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
  await page.getByRole('button', { name: '设计头像', exact: true }).click()
  await page.getByRole('button', { name: /AI 生图/ }).click()
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
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '收起设置' }).click()
  console.log(
    '✓ Local SVG loaded, prompt expansion, unconfigured error, model fetch, Images API fixture',
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
  assert.equal(sequence.length, 0)
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
      ['workspace_list', 'workspace_read'].includes(t.function.name),
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
    '✓ Real tool loop: rename, avatar, shared memory, peer consultation; anchored card and persisted transcript',
  )

  await page.getByRole('button', { name: '发起 Agent 私聊' }).click()
  await page.getByLabel('向谁请教').selectOption(fixture.slow.id)
  await page.getByLabel('讨论什么').fill('请慢慢分析如何打磨交互')
  await page.getByRole('button', { name: '发起私聊', exact: true }).click()
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
  assert.deepEqual(errors, [])
  console.log(
    '✓ Private-chat launcher, cancellation with partial content, error handling, no self-chat, memory deletion',
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
  fs.rmSync(profile, { recursive: true, force: true })
}
