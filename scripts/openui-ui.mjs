// Real Electron + loopback model API. Verifies the SDK's canonical
// openui-lang fence, legacy openui compatibility, and draft staging.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { expect } from '@playwright/test'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'covan-openui-ui-'))
const artifacts = path.join(root, 'artifacts', 'openui')
fs.mkdirSync(artifacts, { recursive: true })
const requests = []
const errors = []
let app, page

const canonical = [
  '这是可交互界面。',
  '',
  '```openui-lang',
  'root = Card("周末安排", [intro, metric, table, chart, line, options, form])',
  'intro = Text("先选一个方向，再一起细化。")',
  'metric = Metric("预算", "¥1,200", "按两人两天估算")',
  'table = Table(["方案", "车程", "适合天气"], [["去徒步", "1.5 小时", "晴"], ["逛展览", "40 分钟", "雨"]])',
  'chart = BarChart("预估花费（元）", ["交通", "餐饮", "门票"], [320, 480, 200])',
  'line = LineChart("每日预算（元）", ["1日", "5日", "10日", "15日", "20日"], [180, 260, 210, 320, 150])',
  'options = Choices("周末想做什么？", ["去徒步", "逛展览", "在家休息"])',
  'form = Form("出发信息", [{label: "日期", placeholder: "周六"}])',
  '```',
].join('\n')

const legacy = [
  '这条已经保存的旧消息使用历史围栏。',
  '',
  '```openui',
  'root = Card("历史界面", [note, options])',
  'note = Text("旧消息仍然可以交互。")',
  'options = Choices("继续吗？", ["继续", "稍后"])',
  '```',
].join('\n')

const invalid = [
  '```openui-lang',
  'root = Card("损坏界面", [evil])',
  'evil = Query("read_user_profile", {})',
  '```',
].join('\n')

const gallery = [
  '```openui-lang',
  'root = Card("内容组件", [callout, tag, list, steps, sep, stack, tabs, accordion])',
  'callout = Callout("info", "提示", "这是一条提示")',
  'tag = Tag("标签", "accent")',
  'list = List(["一", "二"], true)',
  'steps = Steps([step])',
  'step = StepsItem("第一步", "详情", "done")',
  'sep = Separator("分组")',
  'stack = Stack([tag, callout], "row", "s")',
  'tabs = Tabs([tab, tab2])',
  'tab = TabItem("a", "标签页", [text])',
  'tab2 = TabItem("b", "第二页", [text2])',
  'accordion = Accordion([section])',
  'section = AccordionItem("a", "折叠", [text])',
  'text = Text("标签页内容")',
  'text2 = Text("第二页内容")',
  '```',
  '',
  '```openui-lang',
  'root = Card("扩展图表", [area, pie, radar, radial, scatter])',
  'area = AreaChart("面积趋势", ["一", "二", "三"], [2, 5, 3])',
  'pie = PieChart("构成", ["A", "B", "C"], [3, 2, 1], "donut")',
  'radar = RadarChart("能力", ["速度", "稳定", "成本", "体验"], [4, 3, 2, 5])',
  'radial = RadialChart("完成度", ["设计", "开发", "测试"], [80, 55, 30])',
  'scatter = ScatterChart("相关性", "投入", "产出", [1, 2, 3, 4], [2, 4, 3, 6])',
  '```',
].join('\n')

const textOf = (content) =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map((part) => part?.text ?? '').join('')
      : ''

const server = http.createServer(async (req, res) => {
  try {
    if (req.url === '/v1/models') {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ data: [{ id: 'test-agent' }] }))
      return
    }
    let raw = ''
    for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw || '{}')
    const system = (body.messages ?? [])
      .filter((message) => message.role === 'system' || message.role === 'developer')
      .map((message) => textOf(message.content))
      .join('\n')
    const lastUser = [...(body.messages ?? [])]
      .reverse()
      .find((message) => message.role === 'user')
    const userText = textOf(lastUser?.content)
    requests.push({ url: req.url, system, userText, stream: body.stream })

    let content = '收到，这是普通 Markdown 回复。'
    if (system.includes('## 可选交互式回复') && /canonical|legacy|invalid|gallery/.test(userText)) {
      if (userText.includes('legacy')) content = legacy
      else if (userText.includes('invalid')) content = invalid
      else if (userText.includes('gallery')) content = gallery
      else if (userText.includes('canonical')) content = canonical
    }

    if (body.stream === false) {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({
        id: 'openui-response', object: 'chat.completion', model: body.model,
        choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 20, completion_tokens: 20 },
      }))
      return
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    const send = (delta, reason = null) => res.write(`data: ${JSON.stringify({
      id: 'openui-response', object: 'chat.completion.chunk', model: body.model,
      choices: [{ index: 0, delta, finish_reason: reason }],
    })}\n\n`)
    send({ role: 'assistant' })
    send({ content })
    send({}, 'stop')
    res.end('data: [DONE]\n\n')
  } catch (error) {
    errors.push(String(error))
    res.statusCode = 500
    res.end('openui fixture failure')
  }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}/v1`

try {
  // In Electron-as-Node test runners, ELECTRON_RUN_AS_NODE would stop the
  // app window from launching; the smoke runner sets it for its own process.
  const launchEnv = { ...process.env }
  delete launchEnv.ELECTRON_RUN_AS_NODE
  app = await electron.launch({
    args: [root],
    env: {
      ...launchEnv,
      ELECTRON_RENDERER_URL: '',
      COVAN_USER_DATA_DIR: profile,
    },
  })
  page = await app.firstWindow()
  page.on('pageerror', (error) => errors.push(error.message))
  await expect(page.getByRole('button', { name: '创建你的 Bot' })).toBeVisible()

  const fixture = await page.evaluate(async (baseUrl) => {
    const provider = await window.covan.saveProvider({
      name: 'OpenUI loopback',
      kind: 'openai-compatible',
      base_url: baseUrl,
      api_key: 'loopback-only',
      default_model: 'test-agent',
    })
    const bot = await window.covan.createBot({ name: '界面助手', provider_id: provider.id })
    const chat = await window.covan.createDm(bot.id)
    return { provider, bot, chat }
  }, base)

  await page.reload()
  const sidebar = page.locator('aside').first()
  await sidebar.getByRole('button', { name: '界面助手', exact: true }).click()
  const composer = page.getByRole('textbox', { name: '输入消息' })
  await expect(composer).toBeVisible()

  // The generated prompt must teach the SDK's openui-lang, not a second alias.
  await composer.fill('canonical UI please')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect(page.locator('.genui-card')).toContainText('周末安排', { timeout: 20000 })
  await expect(page.locator('.genui-metric')).toContainText('预算')
  await expect(page.locator('.genui-table')).toContainText('去徒步')
  await expect(page.locator('.genui-chart')).toContainText('预估花费')
  await expect(page.locator('.genui-line-chart')).toContainText('每日预算')
  await expect(page.locator('.genui-form')).toContainText('出发信息')
  await expect(page.locator('.genui-choices legend')).toHaveText('周末想做什么？')
  const choiceButton = page.getByRole('button', { name: '去徒步', exact: true })
  await expect(choiceButton.locator('.genui-choice-arrow')).toHaveCount(1)
  await expect(choiceButton).toHaveCSS('cursor', 'pointer')
  await page.locator('.genui-card').scrollIntoViewIfNeeded()
  await page.screenshot({ path: path.join(artifacts, 'canonical-card.png') })
  const replyRequest = requests.find((request) => request.system.includes('## 可选交互式回复'))
  assert.ok(replyRequest, '正式回复应注入生成式 UI 提示')
  assert.ok(replyRequest.system.includes('```openui-lang'), '提示应要求 SDK 的 openui-lang 围栏')
  assert.ok(!replyRequest.system.includes('```openui '), '提示不应再要求旧 openui 围栏')

  // Choices stage an editable draft with a source quote instead of sending.
  await page.getByRole('button', { name: '去徒步', exact: true }).click()
  await expect(composer).toHaveValue('周末想做什么？\n去徒步')
  await expect(page.locator('.composer-quote')).toContainText('界面助手')
  await expect(page.locator('.composer-quote')).toContainText('这是可交互界面。')
  await expect(page.getByRole('status')).toContainText('已填入输入框')
  await page.screenshot({ path: path.join(artifacts, 'canonical-and-draft.png') })
  const themeDock = page.locator('.theme-dock')
  await themeDock.getByRole('button', { name: '切换到深色主题' }).click()
  await expect(page.locator('html')).toHaveClass(/dark/)
  await page.screenshot({ path: path.join(artifacts, 'canonical-dark.png') })
  await themeDock.getByRole('button', { name: '切换到浅色主题' }).click()
  await expect(page.locator('html')).not.toHaveClass(/dark/)
  assert.equal(
    await page.evaluate((id) => window.covan.listMessages(id).then((messages) => messages.filter((message) => message.sender_type === 'bot' && message.status === 'done').length), fixture.chat.id),
    1,
    '选择只填入草稿，不直接发送消息',
  )

  // The UI and the draft survive a reload.
  await page.reload()
  await sidebar.getByRole('button', { name: '界面助手', exact: true }).click()
  await expect(page.locator('.genui-card')).toContainText('周末安排')
  await expect(composer).toHaveValue('周末想做什么？\n去徒步')

  // A message saved with the legacy openui fence still renders after reload.
  await page.getByRole('button', { name: '取消引用', exact: true }).click()
  await composer.fill('legacy UI please')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect(page.locator('.genui-card').filter({ hasText: '历史界面' })).toContainText('历史界面', { timeout: 20000 })
  await expect(page.locator('.genui-card')).toHaveCount(2)

  // The extended display set renders in one message with two UI blocks.
  await composer.fill('gallery UI please')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect(page.locator('.genui-card')).toHaveCount(4, { timeout: 20000 })
  await expect(page.locator('.genui-card').filter({ hasText: '内容组件' })).toBeVisible()
  await expect(page.locator('.genui-card').filter({ hasText: '扩展图表' })).toBeVisible()
  await expect(page.getByRole('tab', { name: '标签页' })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('tab', { name: '第二页' }).click()
  await expect(page.getByRole('tab', { name: '第二页' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByText('第二页内容')).toBeVisible()
  const accordionTrigger = page.getByRole('button', { name: /折叠/ })
  await expect(accordionTrigger).toHaveAttribute('aria-expanded', 'true')
  await accordionTrigger.click()
  await expect(accordionTrigger).toHaveAttribute('aria-expanded', 'false')
  for (const [selector, count] of [
    ['.genui-callout', 2],
    ['.genui-tag', 2],
    ['.genui-list', 1],
    ['.genui-steps', 1],
    ['.genui-separator', 1],
    ['.genui-stack', 1],
    ['.genui-tabs', 1],
    ['.genui-accordion', 1],
  ]) {
    await expect(page.locator(selector)).toHaveCount(count)
  }
  for (const selector of ['.genui-line-chart.is-area', '.genui-pie-chart', '.genui-radar-chart', '.genui-radial-chart', '.genui-scatter-chart']) {
    await expect(page.locator(selector)).toHaveCount(1)
  }
  await page.locator('.genui-card').filter({ hasText: '内容组件' }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: path.join(artifacts, 'extended-content.png') })
  await page.locator('.genui-card').filter({ hasText: '扩展图表' }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: path.join(artifacts, 'extended-components.png') })

  // Invalid UI degrades locally without taking down Markdown or the chat.
  await composer.fill('invalid UI please')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect(page.locator('.genui-fallback')).toContainText('暂时无法显示此界面', { timeout: 20000 })
  await expect(page.locator('.genui-fallback summary')).toContainText('查看界面源码')
  await expect(page.locator('article.message-bot[data-status="done"]')).toHaveCount(4)

  const stored = await page.evaluate((id) => window.covan.listMessages(id), fixture.chat.id)
  const botMessages = stored.filter((message) => message.sender_type === 'bot' && message.status === 'done')
  assert.equal(botMessages.length, 4)
  assert.ok(botMessages[0].content.includes('```openui-lang'))
  assert.ok(botMessages[1].content.includes('```openui\n'))
  assert.ok(botMessages[2].content.includes('Callout(') && botMessages[2].content.includes('AreaChart('))
  assert.ok(botMessages[3].content.includes('Query('))
  await page.screenshot({ path: path.join(artifacts, 'canonical-legacy-fallback.png') })

  assert.deepEqual(errors, [])
  console.log('✓ SDK openui-lang prompt, extended display/chart set, tab/accordion state, legacy history, draft staging, reload recovery and local fallback')
  console.log('OpenUI UI regression passed. Screenshots: ' + artifacts)
} catch (error) {
  if (page) await page.screenshot({ path: path.join(artifacts, 'failure.png') }).catch(() => {})
  throw error
} finally {
  await app?.close()
  await new Promise((resolve) => server.close(resolve))
  fs.rmSync(profile, { recursive: true, force: true })
}
