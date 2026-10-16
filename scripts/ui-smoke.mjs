// Real Electron tests; all fixtures live in an isolated temporary profile.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { expect } from '@playwright/test'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'covan-ui-'))
const artifacts = path.join(root, 'artifacts', 'ux')
fs.mkdirSync(artifacts, { recursive: true })
const errors = []
let app
let page
const markdown = [
  '## 把想法变成可以开始的计划',
  '一个好的开始，是把问题拆小。先确认 **用户价值**，再决定实现顺序。',
  '### 本周的三个重点',
  '- [x] 让消息更容易阅读\n- [ ] 打磨流式回复与停止体验\n- [ ] 验证完整的聊天流程',
  '> 少一点操作负担，多一点思考空间。',
  '| 优先级 | 体验改进 | 状态 |\n| --- | --- | --- |\n| P0 | Markdown 与代码高亮 | 已完成 |\n| P1 | 独立草稿与消息时间 | 已完成 |',
  '行内公式：$E = mc^2$，块级公式：',
  '$$\\int_{-\\infty}^{+\\infty} e^{-x^2}\\, dx = \\sqrt{\\pi}$$',
  '### 从一小段代码开始',
  '```typescript\nconst idea = { name: "Covan", ready: true };\nconsole.log(idea.name);\n```',
  '你也可以用 `Shift + Enter` 换行，或查看 [Markdown 文档](https://commonmark.org)。',
  '[unsafe](javascript:alert(1))',
  '<script>window.__unsafe = true</script>',
].join('\n\n')

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
  page.on('pageerror', (e) => errors.push(e.message))
  await expect(
    page.getByRole('heading', { name: '好想法，从对话开始。' }),
  ).toBeVisible()
  await page.getByRole('button', { name: '创建你的 Bot' }).click()
  await expect(page.getByRole('dialog', { name: '新建 Bot' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  console.log('✓ Welcome actions and dialog dismissal')

  const fixture = await page.evaluate(async () => {
    const p = await window.covan.saveProvider({
      name: 'Local test',
      kind: 'mock',
      default_model: 'mock-default',
    })
    await Promise.all([
      window.covan.saveProvider({
        name: 'Kimi icon fixture',
        kind: 'kimi',
        default_model: 'k3',
      }),
      window.covan.saveProvider({
        name: 'DeepSeek icon fixture',
        kind: 'deepseek',
        default_model: 'deepseek-v4-flash',
      }),
      window.covan.saveProvider({
        name: 'LM Studio icon fixture',
        kind: 'lm-studio',
      }),
    ])
    const a = await window.covan.createBot({
      name: '设计搭档',
      description: '把模糊的想法，变成清晰的下一步',
      provider_id: p.id,
    })
    const b = await window.covan.createBot({
      name: '产品搭档',
      provider_id: p.id,
    })
    const bad = await window.covan.createBot({ name: '未配置助手' })
    return {
      a,
      b,
      bad,
      dm: await window.covan.createDm(a.id),
      other: await window.covan.createDm(b.id),
      badChat: await window.covan.createDm(bad.id),
      group: await window.covan.createGroup('灵感工作室', [a.id, b.id]),
    }
  })
  await page.evaluate(
    async ({ a, dm }) => window.covan.saveScheduledTask({
      bot_id: a.id,
      chat_id: dm.id,
      title: '每日灵感整理',
      prompt: '整理三条今日灵感，使用简洁清单。',
      schedule: 'cron',
      cron: '0 9 * * *',
      timezone: 'Asia/Shanghai',
      enabled: false,
    }),
    fixture,
  )
  await app.evaluate(
    async ({ app }, { fixture, markdown }) => {
      const { createRequire } = process.getBuiltinModule('module')
      const req = createRequire(app.getAppPath() + '/package.json')
      const Database = req('better-sqlite3')
      const db = new Database(app.getPath('userData') + '/covan.db')
      const insert = db.prepare(
        'INSERT INTO messages(id, chat_id, sender_type, sender_bot_id, content, created_at) VALUES(?, ?, ?, ?, ?, ?)',
      )
      const yesterday = Date.now() - 86400000
      for (let i = 0; i < 64; i++)
        insert.run(
          'history-' + i,
          fixture.dm.id,
          'user',
          null,
          '历史消息 ' + i,
          yesterday + Math.floor(i / 3) * 1000,
        )
      insert.run(
        'question',
        fixture.dm.id,
        'user',
        null,
        '我想把 Covan 做得更好用，你有什么建议？',
        Date.now() - 2000,
      )
      insert.run(
        'markdown',
        fixture.dm.id,
        'bot',
        fixture.a.id,
        markdown,
        Date.now() - 1000,
      )
      db.prepare('UPDATE chats SET last_message_at = ? WHERE id = ?').run(
        Date.now(),
        fixture.dm.id,
      )
      db.close()
    },
    { fixture, markdown },
  )
  await page.reload()
  await page
    .locator('aside')
    .getByRole('button', { name: /设计搭档/ })
    .click()
  if (
    await page
      .getByRole('button', { name: '展开设置', exact: true })
      .isVisible()
      .catch(() => false)
  )
    await page.getByRole('button', { name: '展开设置', exact: true }).click()
  await page.getByRole('button', { name: '定时', exact: true }).click()
  await expect(page.getByText('每日灵感整理', { exact: true })).toBeVisible()
  await expect(page.getByText('已暂停', { exact: true })).toBeVisible()
  await page.screenshot({ path: path.join(artifacts, 'scheduled-tasks.png') })
  await page.getByRole('button', { name: '设定', exact: true }).click()
  await expect(page.locator('.markdown-content table')).toBeVisible()
  await expect(page.locator('.markdown-content .katex').first()).toBeVisible()
  await expect(page.locator('.markdown-content .katex-display')).toBeVisible()
  await expect(
    page.locator('.markdown-content pre .hljs-keyword').first(),
  ).toBeVisible()
  await expect(
    page.locator('.markdown-content input[type=checkbox]').first(),
  ).toBeChecked()
  assert.equal(await page.locator('.markdown-content script').count(), 0)
  assert.equal(await page.locator('a[href^="javascript:"]').count(), 0)
  await expect(page.locator('article time').last()).toHaveAttribute(
    'title',
    /\d{4}-\d{2}-\d{2}/,
  )
  await page.getByRole('button', { name: '复制代码', exact: true }).click()
  await expect(
    page.locator('.code-toolbar').getByRole('button', { name: '已复制' }),
  ).toBeVisible()
  assert.match(
    await app.evaluate(({ clipboard }) => clipboard.readText()),
    /^const idea/,
  )
  await page.screenshot({ path: path.join(artifacts, 'chat-light.png') })
  console.log(
    '✓ Markdown, tables, tasks, LaTeX, code highlighting, safe links, timestamps, code copy',
  )

  const exportPath = path.join(profile, 'export.md')
  await app.evaluate(({ dialog }, exportPath) => {
    dialog.showSaveDialog = async () => ({
      canceled: false,
      filePath: exportPath,
    })
  }, exportPath)
  await page.getByRole('button', { name: '导出会话', exact: true }).click()
  await expect(
    page.getByRole('status').filter({ hasText: '会话已导出' }),
  ).toBeVisible()
  const exported = fs.readFileSync(exportPath, 'utf8')
  assert.ok(
    exported.includes('历史消息 0') &&
      exported.includes('历史消息 63') &&
      exported.includes(markdown),
  )
  console.log('✓ Full-history Markdown export includes unloaded messages')

  await page.getByRole('button', { name: '加载更早的消息' }).click()
  await expect(page.locator('article')).toHaveCount(66)
  await expect(
    page.getByRole('button', { name: '加载更早的消息' }),
  ).toHaveCount(0)
  assert.equal(await page.locator('[data-message-id="history-0"]').count(), 1)
  await page.getByRole('button', { name: '回到最新消息' }).click()
  console.log('✓ Pagination keeps messages sharing the same timestamp')

  await expect(page.locator('.topic-suggestion')).toContainText(
    '这段对话已经比较长了',
  )
  await page.locator('.topic-header-action').click()
  const topicDialog = page.getByRole('dialog', { name: '开始新话题' })
  await expect(topicDialog).toContainText('会保留全部聊天记录')
  await expect(topicDialog).toContainText('66 条消息')
  await topicDialog.getByRole('button', { name: '压缩并开始' }).click()
  await expect(page.locator('[data-system-kind="topic_boundary"]')).toContainText(
    '新话题',
  )
  await expect(topicDialog).toHaveCount(0)
  await expect(page.locator('[data-system-kind="topic_boundary"]')).toBeInViewport()
  const topicState = await page.evaluate((id) =>
    window.covan.getChatTopicState(id), fixture.dm.id)
  assert.equal(topicState.current_message_count, 0)
  assert.ok(topicState.latest_topic.summary.length > 0)
  assert.equal(await page.locator('article').count(), 66)
  await page.screenshot({ path: path.join(artifacts, 'new-topic.png') })
  console.log('✓ New topic compresses context while preserving visible DM history')

  const composer = page.getByRole('textbox', { name: '输入消息' })
  await composer.fill('独立草稿 A')
  await page
    .locator('aside')
    .getByRole('button', { name: /产品搭档/ })
    .click()
  await expect(composer).toHaveValue('')
  await composer.fill('独立草稿 B')
  await page
    .locator('aside')
    .getByRole('button', { name: /设计搭档/ })
    .click()
  await expect(composer).toHaveValue('独立草稿 A')
  await page.reload()
  await expect(composer).toHaveValue('独立草稿 A')
  await composer.fill('')
  await page
    .locator('[data-message-id="markdown"]')
    .getByRole('button', { name: '引用回复' })
    .click()
  await expect(composer).toHaveValue('')
  await expect(page.getByLabel('引用内容')).toContainText('把想法')
  await composer.fill('引用之后的独立草稿')
  await page.reload()
  await expect(composer).toHaveValue('引用之后的独立草稿')
  await expect(page.getByLabel('引用内容')).toContainText('把想法')
  await page.screenshot({ path: path.join(artifacts, 'composer-quote.png') })
  await composer.fill('很长的草稿\n'.repeat(40))
  assert.equal(await composer.evaluate((el) => getComputedStyle(el).scrollbarWidth), 'none')
  assert.ok(await composer.evaluate((el) => { el.scrollTop = 100; return el.scrollTop > 0 }))
  await page.getByRole('button', { name: '取消引用' }).click()
  await expect(page.getByLabel('引用内容')).toHaveCount(0)
  await composer.fill('拼音输入确认')
  await composer.dispatchEvent('keydown', {
    key: 'Enter',
    code: 'Enter',
    isComposing: true,
    keyCode: 229,
  })
  await expect(composer).toHaveValue('拼音输入确认')
  await composer.fill('')
  console.log(
    '✓ Persistent per-chat drafts, restored chat, quote reply, Chinese IME',
  )

  await page.keyboard.press('Meta+k')
  await expect(page.getByRole('textbox', { name: '搜索会话' })).toBeFocused()
  await page.getByRole('textbox', { name: '搜索会话' }).fill('产品搭档')
  await page.keyboard.press('Enter')
  await expect(page.locator('.chat-header h1')).toHaveText('产品搭档')
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByRole('button', { name: 'Provider', exact: true }).click()
  for (const kind of ['kimi', 'deepseek', 'lm-studio']) {
    await expect(
      page.locator(`[data-provider-kind="${kind}"] .provider-icon-mark`).first(),
    ).toBeVisible()
  }
  const providerIconState = await page.evaluate(() =>
    ['kimi', 'deepseek', 'lm-studio'].map((kind) => {
      const icon = document.querySelector(`[data-provider-kind="${kind}"]`)
      const mark = icon?.querySelector('.provider-icon-mark')
      const styles = mark ? getComputedStyle(mark) : null
      return {
        hasText: Boolean(icon?.querySelector('text')),
        mask: styles?.webkitMaskImage || styles?.maskImage || '',
      }
    }),
  )
  assert.ok(
    providerIconState.every((icon) => !icon.hasText && icon.mask !== 'none'),
    'Provider 应显示本地图形标识，而非文字缩写',
  )
  await page.screenshot({ path: path.join(artifacts, 'provider-icons.png') })
  console.log('✓ Provider vendor marks render without text glyphs')
  await page.getByRole('button', { name: 'Bot', exact: true }).click()
  await expect(page.getByText('Jev 决策引擎', { exact: true })).toBeVisible()
  await expect(page.getByLabel('TypeSafe API Key')).toBeVisible()
  await expect(page.getByLabel('Jev 模型')).toHaveValue('jev-latest')
  await expect(page.getByLabel('Jev 置信度阈值')).toHaveValue('0.6')
  await page.screenshot({ path: path.join(artifacts, 'jev-settings.png') })
  console.log('✓ Global Jev credentials, model, and confidence threshold are configurable')
  await page.getByRole('button', { name: '定时任务', exact: true }).click()
  await expect(page.getByText('每日灵感整理', { exact: true })).toBeVisible()
  await page.screenshot({ path: path.join(artifacts, 'scheduled-tasks-global.png') })
  await page.getByRole('button', { name: '通用', exact: true }).click()
  await page.getByRole('button', { name: '深色', exact: true }).click()
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  await page
    .locator('aside')
    .getByRole('button', { name: /设计搭档/ })
    .click()
  await expect(page.locator('html')).toHaveClass(/dark/)
  if (
    await page
      .getByRole('button', { name: '展开设置', exact: true })
      .isVisible()
      .catch(() => false)
  )
    await page.getByRole('button', { name: '展开设置', exact: true }).click()
  await expect(page.getByText('聊天背景', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '更换', exact: true }).click()
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.group-background-option img')].some(
      (image) => image instanceof HTMLImageElement && image.naturalWidth > 0,
    ),
  )
  await page.screenshot({ path: path.join(artifacts, 'chat-dark.png') })
  await page.getByRole('button', { name: '模型', exact: true }).click()
  await expect(page.getByLabel('响应决策策略').locator('option[value="auto"]')).toHaveText(
    '自动 · Jev 可用时优先',
  )
  await page.getByLabel('响应决策策略').selectOption('jev')
  await expect.poll(async () =>
    page.evaluate(
      async (botId) =>
        (await window.covan.listBots()).find((bot) => bot.id === botId)
          ?.response_decision_strategy,
      fixture.a.id,
    ),
  ).toBe('jev')
  await page.screenshot({ path: path.join(artifacts, 'bot-decision-strategy.png') })
  await page.getByRole('button', { name: '设定', exact: true }).click()
  console.log('✓ Each Bot can select automatic, traditional LLM, or Jev response decisions')
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.keyboard.press('Shift+Tab')
  assert.equal(
    await page.evaluate(
      () => !!document.activeElement?.closest('[role="dialog"]'),
    ),
    true,
  )
  await page.getByRole('button', { name: '浅色', exact: true }).click()
  await page.keyboard.press('Escape')
  console.log('✓ Search shortcut, focus management, light and dark themes')

  await page
    .locator('aside')
    .getByRole('button', { name: /灵感工作室/ })
    .click()
  if (
    await page
      .getByRole('button', { name: '收起设置', exact: true })
      .isVisible()
      .catch(() => false)
  )
    await page.getByRole('button', { name: '收起设置', exact: true }).click()
  await page.getByRole('button', { name: '展开设置', exact: true }).click()
  await expect(page.getByText('回复机制', { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: /^主动回复/ })).toBeVisible()
  await expect(
    page.getByRole('button', { name: /^顺序回复/ }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText('聊天背景', { exact: true })).toBeVisible()
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.group-background-option img')].some(
      (image) => image instanceof HTMLImageElement && image.naturalWidth > 0,
    ),
  )
  await page.screenshot({ path: path.join(artifacts, 'group-settings.png') })
  await page.getByRole('button', { name: '收起设置', exact: true }).click()
  console.log('✓ Group gear opens reply-mode settings; sequential is default')

  await composer.fill('请大家讨论一下新功能')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect(
    page.locator('article[data-status="streaming"] .message-author'),
  ).toHaveText('设计搭档')
  await expect(
    page.locator('article[data-status="streaming"] .markdown-content'),
  ).toContainText('设计')
  await expect(page.locator('article[data-status="streaming"]').getByRole('button', { name: '复制诊断标识' })).toBeVisible()
  await expect(
    page.getByRole('button', { name: '发送', exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: '停止生成' }).click()
  await expect(page.locator('article[data-status="stopped"]')).toHaveCount(1)
  await expect(
    page.getByRole('button', { name: '发送', exact: true }),
  ).toBeVisible()
  const stopped = await page.evaluate(
    (id) => window.covan.listMessages(id),
    fixture.group.id,
  )
  assert.equal(stopped.filter((m) => m.sender_type === 'bot').length, 1)
  assert.ok(stopped.find((m) => m.status === 'stopped').content.length > 0)
  assert.equal(
    stopped.some((m) => m.sender_bot_id === fixture.b.id),
    false,
  )
  console.log(
    '✓ Streaming author, immediate stop, partial response, cancelled group queue',
  )

  await composer.fill('继续讨论')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect(
    page.getByRole('button', { name: '停止生成', exact: true }),
  ).toHaveCount(0, { timeout: 20000 })
  const completed = await page.evaluate(
    (id) => window.covan.listMessages(id),
    fixture.group.id,
  )
  assert.equal(
    completed.filter((m) => m.sender_type === 'bot' && m.status === 'done')
      .length,
    2,
  )
  await expect(
    page
      .locator('aside')
      .getByRole('button', { name: '灵感工作室', exact: true })
      .locator('.bg-sky-500'),
  ).toHaveCount(0)

  await page.getByRole('button', { name: '展开设置', exact: true }).click()
  await page.getByRole('button', { name: /^主动回复/ }).click()
  await expect(
    page.getByRole('button', { name: /^主动回复/ }),
  ).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: '收起设置', exact: true }).click()
  await composer.fill('主动模式：请一起看这个方案')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect(page.locator('.agent-activity-avatar')).toHaveCount(2)
  await expect(
    page.getByRole('button', { name: '发送', exact: true }),
  ).toBeVisible()
  await composer.fill('补充：优先考虑可靠性')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect(
    page.getByRole('button', { name: '停止生成', exact: true }),
  ).toHaveCount(0, { timeout: 20000 })
  const activeCompleted = await page.evaluate(
    (id) => window.covan.listMessages(id),
    fixture.group.id,
  )
  assert.ok(
    activeCompleted.some(
      (message) =>
        message.sender_type === 'user' && message.content.includes('优先考虑'),
    ),
  )
  const previousDone = completed.filter(
    (message) => message.sender_type === 'bot' && message.status === 'done',
  ).length
  const activeDone = activeCompleted.filter(
    (message) => message.sender_type === 'bot' && message.status === 'done',
  ).length
  assert.ok(activeDone >= previousDone + 2)
  console.log(
    '✓ Active mode shows animated member avatars and accepts new messages while replying',
  )

  await page
    .locator('aside')
    .getByRole('button', { name: /未配置助手/ })
    .click()
  await composer.fill('你好')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Provider')
  await expect(
    page.getByRole('button', { name: '重试', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: '发送', exact: true }),
  ).toBeVisible()
  console.log('✓ Group completion and recoverable configuration errors')

  await page.getByRole('button', { name: 'Covan 首页' }).click()
  await page.screenshot({ path: path.join(artifacts, 'welcome.png') })
  await page
    .locator('aside')
    .getByRole('button', { name: /设计搭档/ })
    .click()
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(960, 640),
  )
  await page.getByRole('button', { name: '展开设置' }).click()
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
    false,
  )
  await page.screenshot({ path: path.join(artifacts, 'compact.png') })
  await page.getByRole('button', { name: '定时', exact: true }).click()
  await page
    .getByRole('button', { name: '立即执行 每日灵感整理' })
    .click()
  await expect.poll(async () =>
    page.evaluate(async () =>
      (await window.covan.listScheduledTasks()).find(
        (task) => task.title === '每日灵感整理',
      )?.last_status,
    ),
  ).toBe('done')
  await expect(
    page.getByRole('button', { name: '停止生成', exact: true }),
  ).toHaveCount(0)
  await page.locator('article.message-bot[data-status="done"]').last().getByRole('button', { name: '引用回复' }).click()
  await composer.fill('针对引用内容补充一句')
  await page.screenshot({ path: path.join(artifacts, 'composer-quote-compact.png') })
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect(page.getByLabel('引用内容')).toHaveCount(0)
  await expect(
    page.locator('.chat-header-avatar[data-avatar-activity="active"]'),
  ).toHaveCount(1)
  await page.screenshot({ path: path.join(artifacts, 'private-avatar-active.png') })
  await expect(page.locator('article.message-user').last().locator('blockquote')).toBeVisible()
  const quoteMessages = await page.evaluate((id) => window.covan.listMessages(id), fixture.dm.id)
  const quoteSent = quoteMessages.filter((m) => m.sender_type === 'user').at(-1)
  assert.ok(quoteSent.content.startsWith('> 设计搭档\n> '))
  assert.ok(quoteSent.content.endsWith('\n\n针对引用内容补充一句'))
  await expect(page.getByRole('button', { name: '停止生成', exact: true })).toHaveCount(0, { timeout: 20000 })
  assert.deepEqual(errors, [])
  console.log('✓ Compact window layout and private-chat avatar activity ring, no renderer exceptions')
  console.log('Electron UX regression passed. Screenshots: ' + artifacts)
} catch (e) {
  if (page)
    await page
      .screenshot({ path: path.join(artifacts, 'failure.png') })
      .catch(() => {})
  throw e
} finally {
  await app?.close()
  fs.rmSync(profile, { recursive: true, force: true })
}
