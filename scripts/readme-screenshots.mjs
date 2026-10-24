// README product tour: real Electron UI, fictional data, loopback model only.
// Run after building, or use npm run screenshots:readme.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'
import { expect } from '@playwright/test'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'covan-readme-'))
const artifacts = path.join(root, 'artifacts', 'readme')
const output = path.join(root, 'docs', 'screenshots')
fs.mkdirSync(artifacts, { recursive: true })
const errors = []
let blockedInlineFonts = 0
let app, page
let writes = 0
const generated = []

const executionPlan = `# 轻舟 · 发布执行单

> 小范围验证，再决定是否扩大投入。

## 本轮目标

用 7 天验证：用户能否完成第一次团队讨论，并留下可复用的结果。

## 分工与交付

| 负责人 | 交付内容 | 时间 |
| --- | --- | --- |
| 小夏 · 产品 | 邀请 20 位种子用户 | 周一 |
| 阿岚 · 设计 | 首次使用引导与空状态 | 周二 |
| 林舟 · 开发 | 跑通核心流程与回归 | 周四 |

## 发布前检查

- [x] 明确首批用户与验证目标
- [x] 确认最小范围与角色分工
- [ ] 完成邀请、创建团队、首次讨论
- [ ] 验证停止、重试与文件交付

## 复盘依据

关注激活率、首次讨论完成率和次日回访。
达到目标后，再扩展模板与工具集成。
`

const dashboard = [
  '先优化激活，再扩大获客。下面是这组演示数据的概览。',
  '',
  '```openui-lang',
  'root = Card("轻舟 · 首周增长复盘", [metrics, channels, next])',
  'metrics = Stack([activation, retention], "row", "m")',
  'activation = Metric("首次讨论完成率", "68%", "较上周 +12 个百分点 · 演示数据")',
  'retention = Metric("次日回访率", "42%", "100 位体验用户 · 演示数据")',
  'channels = BarChart("新增用户来源（人）", ["朋友推荐", "开发者社区", "内容分享", "直接访问"], [42, 32, 18, 8])',
  'next = Choices("下一步优先做什么？", ["优化首次使用", "访谈流失用户", "扩大邀请范围"])',
  '```',
].join('\n')

const teamReplies = {
  README_PRODUCT: '**先做 20 人的小范围验证。**\n\n本周先跑通「创建团队 → 发起讨论 → 留下结果」，验证新用户能否完成第一次团队讨论。其余需求进入候选池。',
  README_DESIGN: '**首次使用要给一个明确起点。**\n\n提供「产品评审」示例团队和可发送的问题，让用户直接开始讨论，减少从零配置的负担。',
  README_ENGINEER: '**先把核心闭环做稳，再扩展功能。**\n\n覆盖建群、回复、停止和文件交付的回归。发布前整理执行单，把每项任务落实到负责人。',
}

const textOf = (content) => typeof content === 'string' ? content
  : Array.isArray(content) ? content.map((part) => part?.text ?? '').join('') : ''

const server = http.createServer(async (req, res) => {
  try {
    assert.equal(req.url, '/v1/chat/completions')
    let raw = ''
    for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw)
    const system = body.messages.filter((message) => ['system', 'developer'].includes(message.role))
      .map((message) => textOf(message.content)).join('\n')
    const user = textOf([...body.messages].reverse().find((message) => message.role === 'user')?.content)
    let content = '[]'
    let tool
    if (system.includes('<<memory-scene-summary>>')) {
      const input = JSON.parse(user)
      const evidence = Array.isArray(input) ? input : input.evidence || []
      const ids = evidence.map((item) => item.source_id)
      content = JSON.stringify({
        short_summary: '团队正围绕首批用户的激活体验安排小范围发布，待执行后再做复盘。',
        short_evidence_ids: Array.isArray(input) ? ids : input.short_window_ids || [],
        summary: '当前讨论聚焦小范围验证：优先帮助新用户完成首次团队讨论，再根据复盘结果安排后续工作。',
        evidence_ids: ids, memories: [],
      })
    } else if (system.includes('<<group-reply-decision>>')) {
      content = system.includes('第 1 轮') ? 'REPLY' : 'SKIP'
    } else if (body.tools?.length && system.includes('## 可选交互式回复')) {
      if (user.includes('发布执行单')) {
        if (writes === 0) {
          assert.ok(body.tools.some((item) => item.function.name === 'workspace_write'))
          tool = { name: 'workspace_write', arguments: JSON.stringify({ path: 'launch/发布执行单.md', content: executionPlan }) }
          writes++
        } else {
          assert.ok(body.messages.some((message) => message.role === 'tool'), '文件交付必须经过真实工具结果')
          content = '**发布执行单已写入工作区。**\n\n包含本轮目标、三位伙伴的分工、发布前检查和复盘依据。点击下方文件即可预览。\n\n- **产品**：邀请种子用户，收集反馈\n- **设计**：完善引导与空状态\n- **开发**：跑通核心流程与回归\n\n建议先完成首轮验证，再安排下一批功能。'
        }
      } else if (system.includes('README_ANALYST')) {
        content = dashboard
      } else {
        const role = Object.keys(teamReplies).find((key) => system.includes(key))
        assert.ok(role, '未知的演示角色')
        content = teamReplies[role]
      }
    }
    if (body.stream === false) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        id: 'readme-mock', object: 'chat.completion', model: body.model,
        choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 40, completion_tokens: 80 },
      }))
      return
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    const send = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({
      id: 'readme-mock', object: 'chat.completion.chunk', model: body.model,
      choices: [{ index: 0, delta, finish_reason }],
    })}\n\n`)
    send({ role: 'assistant' })
    if (tool) send({ tool_calls: [{ index: 0, id: 'readme-write', type: 'function', function: tool }] })
    else send({ content })
    send({}, tool ? 'tool_calls' : 'stop')
    res.end('data: [DONE]\n\n')
  } catch (error) {
    errors.push(String(error))
    res.writeHead(500)
    res.end('README mock failed')
  }
})

try {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  app = await electron.launch({
    args: [root],
    env: {
      PATH: process.env.PATH,
      HOME: os.homedir(),
      TMPDIR: os.tmpdir(),
      LANG: 'zh_CN.UTF-8',
      ELECTRON_RENDERER_URL: '',
      COVAN_USER_DATA_DIR: profile,
    },
  })
  page = await app.firstWindow()
  page.setDefaultTimeout(15000)
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    // Existing CSP blocks an inline data font. Allow only that exact diagnostic;
    // the tour still fails on every other console error or failed request.
    if (/^Refused to load the font 'data:font\/woff2;base64,[^']+' because it violates the following Content Security Policy directive: "default-src 'self'"\./.test(message.text())) blockedInlineFonts++
    else errors.push(message.text())
  })
  page.on('requestfailed', (request) => errors.push(`${request.url()}: ${request.failure()?.errorText}`))
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' })
  await page.setViewportSize({ width: 1440, height: 1040 })
  await expect(page.getByRole('button', { name: '创建你的 Bot' })).toBeVisible()

  const fixture = await page.evaluate(async (base) => {
    const api = window.covan
    await api.setSetting('theme', 'light')
    await api.setSetting('natural_follow_up', 'false')
    await api.setSetting('window_transparency', 'standard')
    const provider = await api.saveProvider({
      name: 'README 本地演示', kind: 'openai-compatible', base_url: base,
      api_key: '', default_model: 'readme-mock',
    })
    const roles = [
      ['小夏 · 产品', 'README_PRODUCT', 'female', '03', '聚焦用户价值，把讨论变成可验证的计划。'],
      ['林舟 · 开发', 'README_ENGINEER', 'male', '07', '把想法落成可运行、可验证的交付。'],
      ['阿岚 · 设计', 'README_DESIGN', 'female', '06', '让复杂的流程更清楚，让第一次使用更轻松。'],
      ['予安 · 数据', 'README_ANALYST', 'male', '09', '先看数据，再决定下一步。'],
    ]
    const bots = []
    const chats = []
    for (const [name, role, gender, avatar, description] of roles) {
      const bot = await api.createBot({
        name, gender, description, system_prompt: `${role}\n${description}`,
        avatar: `avatars/preset/avatar-${avatar}-original.png`,
        provider_id: provider.id, pinned: bots.length < 3,
        response_decision_strategy: 'llm', reasoning_effort: 'off',
      })
      bots.push(bot)
      chats.push(await api.createDm(bot.id))
    }
    await api.addMemory(bots[0].id, '当前项目是轻舟，优先服务独立开发者与小团队。', 'fact')
    await api.addMemory(bots[1].id, '交付前先给结论，列出验收步骤，保留可复用的文件。', 'preference')
    const group = await api.createGroup('轻舟 · 产品发布小队', bots.slice(0, 3).map((bot) => bot.id))
    await api.updateChat(group.id, { backgroundImage: '09-modern-office-city-view.png' })
    return { bots, chats, group }
  }, `http://127.0.0.1:${server.address().port}/v1`)
  await page.reload()
  const sidebar = page.getByRole('complementary', { name: '会话导航' })
  const composer = page.getByRole('textbox', { name: '输入消息' })
  const send = async (text) => {
    await composer.fill(text)
    await page.getByRole('button', { name: '发送', exact: true }).click()
  }
  const idle = async () => {
    await expect(page.getByRole('button', { name: '停止生成', exact: true })).toHaveCount(0)
    await expect(page.locator('article[data-status="streaming"]')).toHaveCount(0)
    await expect(page.locator('[data-avatar-activity="active"]')).toHaveCount(0)
  }
  const capture = async (name) => {
    await idle()
    await page.evaluate(async () => {
      await document.fonts.ready
      await Promise.all([...document.images].map((image) => image.decode().catch(() => {})))
    })
    await page.mouse.move(10, 40)
    await page.screenshot({ path: path.join(artifacts, name), animations: 'disabled' })
    generated.push(name)
  }

  // 1. One question, three distinct roles, a bounded group discussion.
  await sidebar.getByRole('button', { name: fixture.group.name, exact: true }).click()
  await send('轻舟准备下周小范围发布。我们只有一周，产品、设计和开发各自建议先做什么？')
  await expect(page.locator('article.message-bot[data-status="done"]')).toHaveCount(3)
  await idle()
  const groupMessages = await page.evaluate((id) => window.covan.listMessages(id), fixture.group.id)
  assert.equal(new Set(groupMessages.filter((message) => message.sender_type === 'bot').map((message) => message.sender_bot_id)).size, 3)
  await expect(page.locator('.message-scroll')).toContainText('首次使用要给一个明确起点')
  await capture('multi-agent-team.png')

  // 2. Charts and choices use the actual message renderer and draft workflow.
  await sidebar.getByRole('button', { name: fixture.bots[3].name, exact: true }).click()
  await send('请复盘首周演示数据：完成率 68%（+12 个百分点），回访率 42%；100 人来源为推荐 42、社区 32、内容 18、直接访问 8。')
  await expect(page.locator('article.message-bot[data-status="done"]')).toHaveCount(1)
  await expect(page.locator('.genui-card')).toContainText('轻舟 · 首周增长复盘')
  await expect(page.locator('.genui-bar-row')).toHaveCount(4)
  await page.getByRole('button', { name: '优化首次使用', exact: true }).click()
  await expect(composer).toHaveValue('下一步优先做什么？\n优化首次使用')
  await expect(page.locator('.composer-quote')).toContainText(fixture.bots[3].name)
  assert.equal((await page.evaluate((id) => window.covan.listMessages(id), fixture.chats[3].id)).length, 2)
  await capture('interactive-results.png')

  // 3. A real workspace_write result produces the delivery card and preview.
  await sidebar.getByRole('button', { name: fixture.bots[1].name, exact: true }).click()
  await send('把小范围发布的目标、分工和检查项整理成一份发布执行单，保存为 Markdown。')
  await expect(page.locator('article.message-bot[data-status="done"]')).toHaveCount(1)
  await expect(page.locator('.artifact-card')).toContainText('发布执行单.md')
  await page.locator('.artifact-card').getByRole('button', { name: '预览', exact: true }).click()
  await expect(page.locator('.artifact-preview-markdown')).toContainText('轻舟 · 发布执行单')
  const resizer = page.getByRole('separator', { name: '调整产物预览宽度' })
  await resizer.focus()
  await resizer.press('ArrowLeft')
  await resizer.press('ArrowLeft')
  await composer.focus()
  assert.equal(await page.evaluate((id) => window.covan.readWorkspaceFile(id, 'launch/发布执行单.md'), fixture.bots[1].id), executionPlan)
  assert.equal(writes, 1)
  await capture('workspace-delivery.png')

  assert.deepEqual(errors, [])
  assert.equal(generated.length, 3)
  // Only replace published images after the entire tour passes.
  fs.mkdirSync(output, { recursive: true })
  for (const name of generated) fs.copyFileSync(path.join(artifacts, name), path.join(output, name))
  console.log('✓ README screenshots: team discussion, interactive results, workspace delivery')
  console.log('3 screenshots saved to docs/screenshots/ (fictional data; loopback only)')
  if (blockedInlineFonts) console.log(`i Existing CSP blocked ${blockedInlineFonts} inline-font loads; system fonts used.`)
} catch (error) {
  await page?.screenshot({ path: path.join(artifacts, 'failure.png') }).catch(() => {})
  throw error
} finally {
  try {
    await app?.close()
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
    fs.rmSync(profile, { recursive: true, force: true })
  }
}
