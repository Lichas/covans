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
const alternateCliPath = path.join(profile, 'alternate-fake-cli.mjs')
fs.copyFileSync(path.join(root, 'scripts', 'fixtures', 'fake-cli.mjs'), alternateCliPath)
fs.chmodSync(alternateCliPath, 0o755)
const artifacts = path.join(root, 'artifacts', 'ux')
fs.mkdirSync(artifacts, { recursive: true })
const errors = []
let app
let page
// Verify that messages really pass behind a fading layer, rather than a flat
// header that merely lacks a border. Screenshot review covers the visual blend.
const expectFadingHeader = async () => {
  const header = page.locator('.chat-header')
  await expect(header).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(header).toHaveCSS('border-bottom-width', '0px')
  await expect(header).toHaveCSS('backdrop-filter', 'none')
  const layer = await header.evaluate((element) => {
    const style = getComputedStyle(element, '::before')
    const scroll = document.querySelector('.message-scroll')
    return {
      backdrop: style.backdropFilter, mask: style.maskImage,
      background: style.backgroundImage, pointerEvents: style.pointerEvents,
      headerTop: element.getBoundingClientRect().top,
      scrollTop: scroll.getBoundingClientRect().top,
      inset: parseFloat(getComputedStyle(scroll).scrollPaddingTop),
      headerHeight: element.getBoundingClientRect().height,
    }
  })
  assert.equal(layer.backdrop, 'blur(32px) saturate(1.25)')
  assert.ok(layer.mask.includes('linear-gradient') && layer.mask.includes('rgba(0, 0, 0, 0)'))
  assert.ok(layer.background.includes('linear-gradient'))
  assert.equal(layer.pointerEvents, 'none')
  assert.ok(Math.abs(layer.headerTop - layer.scrollTop) < 1)
  assert.ok(layer.inset > layer.headerHeight)
}
// Exercise the actual background picker: its image cards are an intentional
// exception to capsule buttons, and a photo must not change the user's palette.
const expectReadablePhotoBackgrounds = async (scope) => {
  const options = page.locator('.group-background-option')
  await expect(options).toHaveCount(13)
  const selectedOption = page.locator('.group-background-option[aria-pressed="true"]')
  const selected = await selectedOption.count() ? await selectedOption.getAttribute('title') : null
  const wasDark = await page.locator('html').evaluate((el) => el.classList.contains('dark'))
  const scrollTop = await page.locator('.message-scroll').evaluate((el) => el.scrollTop)
  const cards = await page.locator('.chat-background-current, .group-background-option').evaluateAll((elements) =>
    elements.map((el) => {
      const rect = el.getBoundingClientRect()
      return { radius: parseFloat(getComputedStyle(el).borderTopLeftRadius), width: rect.width, height: rect.height }
    }),
  )
  assert.ok(cards.length >= 13 && cards.every(({ radius, width, height }) => radius > 0 && radius < Math.min(width, height) / 2))
  const bubble = page.locator('.message-user .message-surface').last()
  const palette = () => bubble.evaluate((el) => {
    const style = getComputedStyle(el)
    return { background: style.backgroundColor, color: style.color, shadow: style.boxShadow, backdrop: style.backdropFilter }
  })
  for (const theme of ['light', 'dark']) {
    await page.locator('.theme-dock').getByRole('button', { name: theme === 'light' ? '切换到浅色主题' : '切换到深色主题' }).click()
    if (theme === 'dark') await expect(page.locator('html')).toHaveClass(/dark/)
    else await expect(page.locator('html')).not.toHaveClass(/dark/)
    if (await page.getByRole('button', { name: '清除', exact: true }).count()) {
      await page.getByRole('button', { name: '清除', exact: true }).click()
    }
    await expect(page.locator('.chat-view')).not.toHaveClass(/group-background/)
    const baseline = await palette()
    if (scope === 'dm') {
      // An opaque fill and WCAG AA text contrast keep bright photos from
      // washing out the default dark bubble and its light text.
      const luminance = (color) => color.match(/[\d.]+/g).slice(0, 3)
        .map((v) => Number(v) / 255)
        .map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
        .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0)
      assert.match(baseline.background, /^rgb\(/)
      const [low, high] = [luminance(baseline.background), luminance(baseline.color)].sort((a, b) => a - b)
      assert.ok((high + 0.05) / (low + 0.05) >= 4.5)
    }
    for (const title of ['海崖花径', '星夜']) {
      const option = page.locator(`.group-background-option[title="${title}"]`)
      await option.click()
      await expect(option).toHaveAttribute('aria-pressed', 'true')
      await expect(page.locator('.chat-view')).toHaveClass(/group-background/)
      assert.deepEqual(await palette(), baseline, `${scope}/${theme}/${title}: preserve default user bubble`)
      if (title === '海崖花径') {
        await bubble.scrollIntoViewIfNeeded()
        await page.screenshot({ path: path.join(artifacts, `${scope}-background-${theme}.png`) })
      }
    }
  }
  if (selected) await page.locator(`.group-background-option[title="${selected}"]`).click()
  else await page.getByRole('button', { name: '清除', exact: true }).click()
  await page.locator('.theme-dock').getByRole('button', { name: wasDark ? '切换到深色主题' : '切换到浅色主题' }).click()
  await page.locator('.message-scroll').evaluate((el, top) => { el.scrollTop = top }, scrollTop)
  console.log(`✓ ${scope}: rectangular background cards and unchanged readable user bubbles on bright/dark photos in both themes`)
}
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
      COVAN_FAKE_CLI_LOG: path.join(profile, 'cli-calls.jsonl'),
    },
  })
  page = await app.firstWindow()
  page.on('pageerror', (e) => errors.push(e.message))
  await expect(page.getByRole('button', { name: '创建你的 Bot' })).toBeVisible()
  await page.getByRole('button', { name: '创建你的 Bot' }).click()
  await expect(page.getByRole('dialog', { name: '新建 Bot' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  console.log('✓ Welcome actions and dialog dismissal')

  const sidebarToolbar = page.locator('.sidebar-toolbar-actions')
  const searchButton = sidebarToolbar.getByRole('button', { name: '搜索', exact: true })
  const createButton = sidebarToolbar.getByRole('button', { name: '新建', exact: true })
  await expect(page.getByRole('textbox', { name: '搜索会话' })).toHaveCount(0)
  const [searchBounds, createBounds, brandBounds] = await Promise.all([
    searchButton.boundingBox(), createButton.boundingBox(), page.locator('.sidebar-brand').boundingBox(),
  ])
  assert.ok(searchBounds.x > brandBounds.x + brandBounds.width)
  assert.ok(createBounds.x > searchBounds.x && Math.abs(createBounds.y - searchBounds.y) < 1)
  await searchButton.click()
  await expect(searchButton).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByRole('textbox', { name: '搜索会话' })).toBeFocused()
  await page.getByRole('textbox', { name: '搜索会话' }).fill('无匹配内容')
  await page.getByRole('button', { name: '清除搜索' }).click()
  await expect(page.getByRole('textbox', { name: '搜索会话' })).toHaveValue('')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('textbox', { name: '搜索会话' })).toHaveCount(0)
  await expect(searchButton).toBeFocused()
  await createButton.click()
  const createMenu = page.getByRole('menu', { name: '创建菜单' })
  await expect(createMenu).toBeVisible()
  await expect(createMenu.getByRole('menuitem').first()).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(createMenu.getByRole('menuitem', { name: /创建群聊/ })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(createMenu).toHaveCount(0)
  await expect(createButton).toBeFocused()
  await createButton.click()
  await createButton.click()
  await expect(createMenu).toHaveCount(0)
  await createButton.click()
  await createMenu.getByRole('menuitem', { name: /创建群聊/ }).click()
  await expect(page.getByRole('dialog', { name: '创建群聊' })).toBeVisible()
  await page.keyboard.press('Escape')
  const typography = await page.evaluate(() => ({
    font: getComputedStyle(document.body).fontFamily,
    capsules: [...document.querySelectorAll('button:not(.shape-rect)')].filter((button) => button.getClientRects().length).every((button) => {
      const rect = button.getBoundingClientRect()
      return parseFloat(getComputedStyle(button).borderTopLeftRadius) >= Math.min(rect.width, rect.height) / 2
    }),
  }))
  assert.ok(typography.font.startsWith('-apple-system'))
  assert.ok(typography.capsules)
  console.log('✓ Sidebar search/create buttons, collapsed search, menu focus/toggle, system font and capsule buttons')


  // Theme controls share one persisted setting across the dock and settings.
  const themeDock = page.locator('.theme-dock')
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' })
  await themeDock.getByRole('button', { name: '切换到浅色主题' }).click()
  await expect(page.locator('html')).not.toHaveClass(/dark/)
  await expect.poll(() => page.evaluate(() => window.covan.getSetting('theme'))).toBe('light')
  await page.screenshot({ path: path.join(artifacts, 'glass-welcome-light.png') })
  await themeDock.getByRole('button', { name: '切换到深色主题' }).click()
  await expect.poll(() => page.evaluate(() => window.covan.getSetting('theme'))).toBe('dark')
  await page.reload()
  await expect(themeDock.getByRole('button', { name: '切换到深色主题' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('html')).toHaveClass(/dark/)
  await expect(page.locator('.welcome-content')).toHaveCSS('color', 'rgb(244, 244, 245)')
  await expect(page.locator('.sidebar-brand')).toHaveCSS('color', 'rgb(244, 244, 245)')
  // Electron can capture a compositor frame before inherited colors repaint.
  const settleAppearance = () => page.evaluate(() => new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve)),
  ))
  await settleAppearance()
  await page.screenshot({ path: path.join(artifacts, 'glass-welcome-dark.png') })
  await page.getByRole('button', { name: '设置', exact: true }).click()
  const settingsDialog = page.getByRole('dialog', { name: '设置', exact: true })
  const settingsNav = settingsDialog.getByRole('navigation', { name: '设置分类' })
  for (const name of ['通用', 'Provider', 'Bot', '定时任务', '头像生成', 'MCP', 'Skills', 'Debug']) {
    await settingsNav.getByRole('button', { name, exact: true }).click()
    await expect(settingsNav.getByRole('button', { name, exact: true })).toHaveAttribute('aria-current', 'page')
    const content = settingsDialog.getByRole('main', { name, exact: true })
    await expect(content).toBeVisible()
    // Each page mounts only its actual controls, without an extra title band.
    await expect(content.locator(':scope > *')).toHaveCount(1)
  }
  await settingsNav.getByRole('button', { name: '通用', exact: true }).click()
  const contentTop = (await settingsDialog.getByRole('main').boundingBox()).y
  const firstControlTop = (await settingsDialog.getByText('外观主题', { exact: true }).boundingBox()).y
  assert.ok(firstControlTop - contentTop < 32, 'Settings content starts directly below the dialog title')
  const expectThemeCards = async () => {
    const cards = await settingsDialog.locator('.theme-picker button').evaluateAll((elements) => elements.map((el) => {
      const rect = el.getBoundingClientRect()
      return { radius: parseFloat(getComputedStyle(el).borderTopLeftRadius), width: rect.width, height: rect.height }
    }))
    assert.equal(cards.length, 3)
    assert.ok(cards.every(({ radius, width, height }) => radius === 14 && Math.min(width, height) > radius * 2))
  }
  await expectThemeCards()
  await expect(page.getByRole('button', { name: '深色', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await settleAppearance()
  await page.screenshot({ path: path.join(artifacts, 'settings-dark.png') })
  await page.getByRole('button', { name: '浅色', exact: true }).click()
  await expectThemeCards()
  await expect(themeDock.getByRole('button', { name: '切换到浅色主题' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.theme-picker .theme-option-label').first()).toHaveCSS('color', 'rgb(24, 24, 27)')
  await settleAppearance()
  await page.screenshot({ path: path.join(artifacts, 'glass-theme-settings.png') })
  await page.keyboard.press('Escape')
  console.log('✓ All settings categories omit the title band; theme cards remain rounded rectangles in both themes')
  await themeDock.getByRole('button', { name: '切换到跟随系统主题' }).click()
  await expect.poll(() => page.evaluate(() => window.covan.getSetting('theme'))).toBe('system')
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.locator('html')).toHaveClass(/dark/)
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(page.locator('html')).not.toHaveClass(/dark/)
  await themeDock.getByRole('button', { name: '切换到浅色主题' }).focus()
  await page.keyboard.press('Enter')
  await expect(themeDock.getByRole('button', { name: '切换到浅色主题' })).toHaveAttribute('aria-pressed', 'true')
  console.log('✓ Theme dock, settings sync, reload persistence, system appearance and keyboard activation')


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
    .getByRole('button', { name: '设计搭档', exact: true })
    .click()
  if (
    await page
      .getByRole('button', { name: '展开设置', exact: true })
      .isVisible()
      .catch(() => false)
  )
    await page.getByRole('button', { name: '展开设置', exact: true }).click()
  const identityButton = page.locator('.chat-identity-button')
  await expect(identityButton).toContainText('设计搭档')
  await expect(identityButton).toHaveAttribute('aria-expanded', 'true')
  await expect(identityButton).toHaveCSS('border-top-color', 'rgb(37, 99, 235)')
  await expect(page.locator('.chat-dm .chat-header')).toHaveCSS('border-bottom-width', '0px')
  await expectFadingHeader()
  await expect(page.locator('.bot-profile-header')).toHaveCSS('border-bottom-width', '0px')
  await expect(page.locator('.bot-profile-header')).toHaveCSS('backdrop-filter', 'blur(24px) saturate(1.2)')
  await expect(page.locator('.app-sidebar')).toHaveCSS('border-right-color', 'rgba(24, 24, 27, 0.1)')
  await expect(page.getByRole('complementary', { name: 'Bot 设定' })).toHaveCSS('border-left-color', 'rgba(24, 24, 27, 0.1)')
  await expect(page.locator('.chat-dm .chat-header .chat-actions')).toHaveCount(0)
  const sidebarActions = page.locator('.bot-profile-actions')
  const actionBoxes = await Promise.all([
    sidebarActions.getByRole('button', { name: '建群', exact: true }).boundingBox(),
    sidebarActions.getByRole('button', { name: '开始新话题', exact: true }).boundingBox(),
    sidebarActions.getByRole('button', { name: '导出会话', exact: true }).boundingBox(),
  ])
  const portraitBox = await page.getByRole('button', { name: '更换头像', exact: true }).boundingBox()
  assert.ok(actionBoxes.every((box) => box && box.x > portraitBox.x + portraitBox.width))
  assert.ok(actionBoxes[0].y < actionBoxes[1].y && actionBoxes[1].y < actionBoxes[2].y)
  assert.ok(actionBoxes.every((box) => Math.abs(box.x - actionBoxes[0].x) < 1))
  const headerBox = await page.locator('.chat-header').boundingBox()
  const identityBox = await identityButton.boundingBox()
  assert.ok(Math.abs(identityBox.x + identityBox.width / 2 - headerBox.x - headerBox.width / 2) < 1)
  await sidebarActions.getByRole('button', { name: '建群', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '邀请 Bot 组队' })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '关闭 Bot 设定', exact: true }).click()
  await expect(page.getByRole('complementary', { name: 'Bot 设定' })).toHaveCount(0)
  await identityButton.focus()
  await page.keyboard.press('Enter')
  await expect(identityButton).toHaveAttribute('aria-expanded', 'true')
  await identityButton.click()
  await expect(identityButton).toHaveAttribute('aria-expanded', 'false')
  await identityButton.hover()
  await expect(identityButton).toHaveCSS('border-top-color', 'rgba(0, 0, 0, 0)')
  await identityButton.focus()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Shift+Tab')
  await expect(identityButton).toBeFocused()
  await expect(identityButton).toHaveCSS('border-top-color', 'rgba(0, 0, 0, 0)')
  await expect(identityButton).toHaveCSS('outline-color', 'rgb(128, 128, 128)')
  await page.getByRole('textbox', { name: '输入消息' }).focus()
  await page.screenshot({ path: path.join(artifacts, 'dm-header-unselected.png') })
  await page.keyboard.press('Control+.')
  await expect(sidebarActions.getByRole('button', { name: '导出会话' })).toBeVisible()
  console.log('✓ DM selection-only blue border, borderless frosted headers, gray dividers, and vertical sidebar actions')
  await page.getByRole('button', { name: '定时', exact: true }).click()
  await expect(page.getByText('每日灵感整理', { exact: true })).toBeVisible()
  await expect(page.getByText('已暂停', { exact: true })).toBeVisible()
  await page.screenshot({ path: path.join(artifacts, 'scheduled-tasks.png') })
  await page.getByRole('button', { name: '设定', exact: true }).click()
  await page.getByRole('button', { name: '更换', exact: true }).click()
  await expectReadablePhotoBackgrounds('dm')
  await page.getByRole('button', { name: '收起', exact: true }).click()
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
    .getByRole('button', { name: '产品搭档', exact: true })
    .click()
  await expect(composer).toHaveValue('')
  await composer.fill('独立草稿 B')
  await page
    .locator('aside')
    .getByRole('button', { name: '设计搭档', exact: true })
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
  await page.getByRole('textbox', { name: '搜索会话' }).dispatchEvent('keydown', {
    key: 'Enter', code: 'Enter', isComposing: true, keyCode: 229,
  })
  await expect(page.getByRole('textbox', { name: '搜索会话' })).toHaveValue('产品搭档')
  await page.keyboard.press('Enter')
  await expect(page.locator('.chat-header h1')).toHaveText('产品搭档')
  await expect(page.getByRole('textbox', { name: '搜索会话' })).toHaveCount(0)
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
    .getByRole('button', { name: '设计搭档', exact: true })
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
  await expect(page.locator('.chat-dm .chat-header')).toHaveCSS('border-bottom-width', '0px')
  await expectFadingHeader()
  await expect(page.getByRole('complementary', { name: 'Bot 设定' })).toHaveCSS('border-left-color', 'rgba(255, 255, 255, 0.1)')
  // 资料页把所有设置摊成「标签 + 摘要 + 操作」行，决策策略是行内的分段控件。
  await page.getByRole('button', { name: '设定', exact: true }).click()
  const decisionGroup = page.getByRole('group', { name: '响应决策策略' })
  await expect(decisionGroup.getByRole('button', { name: '自动' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText('自动 · Jev 可用时优先，失败回退当前 LLM')).toBeVisible()
  await decisionGroup.getByRole('button', { name: 'Jev' }).click()
  await expect(decisionGroup.getByRole('button', { name: 'Jev' })).toHaveAttribute('aria-pressed', 'true')
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
    .getByRole('button', { name: '灵感工作室', exact: true })
    .click()
  if (
    await page
      .getByRole('button', { name: '收起设置', exact: true })
      .isVisible()
      .catch(() => false)
  )
    await page.getByRole('button', { name: '收起设置', exact: true }).click()
  await expectFadingHeader()
  await page.screenshot({ path: path.join(artifacts, 'group-fade-light.png') })
  await themeDock.getByRole('button', { name: '切换到深色主题' }).click()
  await expect(page.locator('html')).toHaveClass(/dark/)
  await expectFadingHeader()
  await expect(page.locator('.chat-header h1')).toHaveCSS('color', 'rgb(244, 244, 245)')
  await settleAppearance()
  await page.screenshot({ path: path.join(artifacts, 'group-fade-dark.png') })
  await themeDock.getByRole('button', { name: '切换到浅色主题' }).click()
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
  console.log('✓ DM/group gradient glass overlays in both themes, photo background and group actions')
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
  await page.getByRole('button', { name: '展开设置', exact: true }).click()
  await expectReadablePhotoBackgrounds('group')
  await page.getByRole('button', { name: '收起设置', exact: true }).click()

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
    .getByRole('button', { name: '未配置助手', exact: true })
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
  await expect(page.locator('.welcome-bot-card')).toHaveCount(3)
  await page.screenshot({ path: path.join(artifacts, 'welcome.png') })
  await themeDock.getByRole('button', { name: '切换到深色主题' }).click()
  await expect(page.locator('.welcome-content')).toHaveCSS('color', 'rgb(244, 244, 245)')
  await settleAppearance()
  await page.screenshot({ path: path.join(artifacts, 'glass-bots-dark.png') })
  await themeDock.getByRole('button', { name: '切换到浅色主题' }).click()

  await page
    .locator('aside')
    .getByRole('button', { name: '设计搭档', exact: true })
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
  for (const control of [
    page.getByRole('button', { name: '关于我', exact: true }),
    themeDock.getByRole('button', { name: '切换到深色主题' }),
    page.getByRole('button', { name: '发送', exact: true }),
    page.getByRole('textbox', { name: '输入消息' }),
  ]) await expect(control).toBeInViewport()
  await themeDock.getByRole('button', { name: '切换到深色主题' }).click()
  await page.screenshot({ path: path.join(artifacts, 'glass-compact-dark.png') })
  await themeDock.getByRole('button', { name: '切换到浅色主题' }).click()

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

  // 新建 Bot 支持本地 CLI 运行方式（用确定性假 CLI，不消耗任何真实订阅）
  await page.getByRole('button', { name: '新建', exact: true }).click()
  await page.locator('button', { hasText: '新建 Bot' }).last().click()
  const cliDialog = page.getByRole('dialog', { name: '新建 Bot' })
  await expect(cliDialog).toBeVisible()
  // 模型选择器：左轨切换来源，右侧点选模型，底部一键回到来源默认模型。
  await cliDialog.locator('[data-rail="cli:codex-cli"]').click()
  await cliDialog
    .getByLabel('CLI 可执行文件')
    .fill(path.join(root, 'scripts', 'fixtures', 'fake-cli.mjs'))
  await expect(cliDialog.getByRole('status')).toContainText('已安装', { timeout: 20000 })
  await expect(cliDialog.getByRole('status')).toContainText('0.149.0')
  await expect(cliDialog.getByRole('status')).toContainText('fake-cli.mjs')
  await expect(cliDialog.locator('[data-use-bot-default]')).toHaveAttribute('aria-pressed', 'true')
  // API model values must never follow a backend switch into the CLI.
  await cliDialog.locator(`[data-rail="provider:${fixture.a.provider_id}"]`).click()
  await expect(cliDialog.locator('[data-rail="provider:' + fixture.a.provider_id + '"]')).toHaveAttribute('aria-pressed', 'true')
  await cliDialog.locator('[data-model-option="mock-default"]').click()
  await expect(cliDialog.locator('[data-model-option="mock-default"]')).toHaveAttribute('aria-pressed', 'true')
  await cliDialog.locator('[data-rail="cli:codex-cli"]').click()
  await expect(cliDialog.locator('[data-use-bot-default]')).toHaveAttribute('aria-pressed', 'true')
  await expect(cliDialog.locator('[data-model-option="account-only-model"]')).toHaveCount(1)
  await expect(cliDialog.locator('[data-model-option="gpt-6-luna"]')).toHaveCount(0)
  await expect(cliDialog.locator('[data-model-option="hidden-model"]')).toHaveCount(0)
  await cliDialog.locator('[data-model-option="gpt-5.6-sol"]').click()
  await expect(cliDialog.locator('[data-model-option="gpt-5.6-sol"]')).toHaveAttribute('aria-pressed', 'true')
  await cliDialog.getByLabel('Provider（判断用，可选）').selectOption('')
  await expect(cliDialog.locator('[data-model-option="gpt-5.6-sol"]')).toHaveAttribute('aria-pressed', 'true')
  await cliDialog.getByRole('group', { name: '文件权限' }).getByRole('button', { name: '可写' }).click()
  await cliDialog.getByPlaceholder('给你的 Bot 起个名字').fill('CLI 伙伴')
  await page.screenshot({ path: path.join(artifacts, 'new-bot-cli.png') })
  await cliDialog.getByRole('button', { name: '创建并开始聊天' }).click()
  await expect(cliDialog).toHaveCount(0)
  const cliBot = await page.evaluate(async () => {
    const bots = await window.covan.listBots()
    const bot = bots.find((item) => item.name === 'CLI 伙伴')
    return bot
      ? { id: bot.id, backend: bot.backend, cli_path: bot.cli_path, cli_access: bot.cli_access, model: bot.model }
      : null
  })
  assert.equal(cliBot?.backend, 'codex-cli')
  assert.equal(cliBot?.cli_access, 'workspace-write')
  assert.ok(cliBot?.cli_path.endsWith('fake-cli.mjs'))
  assert.equal(cliBot?.model, 'gpt-5.6-sol')
  await page.reload()
  await expect(page.locator('.chat-identity-button')).toContainText('CLI 伙伴')
  await page.getByRole('button', { name: '展开设置', exact: true }).click()
  await page.getByRole('button', { name: '设定', exact: true }).click()
  const modelPanel = page.getByRole('complementary', { name: 'Bot 设定' })
  const modelRow = modelPanel.locator('[data-profile-row="model"]')
  await expect(modelRow).toContainText('Codex CLI · gpt-5.6-sol')
  await modelRow.locator('[data-profile-edit="model"]').click()
  await expect(modelPanel.locator('[data-model-option="gpt-5.6-sol"]')).toHaveAttribute('aria-pressed', 'true')
  await expect(modelPanel.locator('[data-model-option="gpt-5.6-sol"] [data-bot-model]')).toHaveText('(Bot 的模型)')
  await page.evaluate(() => window.covan.setSetting('natural_follow_up', '0'))
  for (const text of ['第一轮 CLI 模型验证', '第二轮 CLI 模型验证']) {
    await page.getByRole('textbox', { name: '输入消息' }).fill(text)
    await page.getByRole('button', { name: '发送', exact: true }).click()
    await expect(page.locator('article.message-bot').last()).toContainText('假 CLI 回复', { timeout: 20000 })
    await expect(page.getByRole('button', { name: '停止生成', exact: true })).toHaveCount(0, { timeout: 20000 })
  }
  const cliCalls = fs.readFileSync(path.join(profile, 'cli-calls.jsonl'), 'utf8').trim().split('\n').map(JSON.parse)
  assert.equal(cliCalls.length, 2)
  assert.ok(cliCalls.every((call) => call.model === 'gpt-5.6-sol'))
  assert.equal(cliCalls[0].isResume, false)
  assert.equal(cliCalls[1].isResume, true)
  await modelPanel.locator('[data-model-custom]').click()
  await modelPanel.getByLabel('自定义 CLI 模型 ID').fill('custom-cli-model')
  await modelPanel.getByLabel('自定义 CLI 模型 ID').press('Tab')
  await expect.poll(() => page.evaluate(async (id) =>
    (await window.covan.listBots()).find((bot) => bot.id === id)?.model, cliBot.id,
  )).toBe('custom-cli-model')
  // These fields previously used camelCase and silently failed to persist.
  await modelPanel.getByLabel('CLI 可执行文件').fill(alternateCliPath)
  await expect.poll(() => page.evaluate(async (id) =>
    (await window.covan.listBots()).find((bot) => bot.id === id)?.cli_path, cliBot.id,
  )).toBe(alternateCliPath)
  await modelPanel.getByRole('group', { name: '文件权限' }).getByRole('button', { name: '只读' }).click()
  await expect.poll(() => page.evaluate(async (id) =>
    (await window.covan.listBots()).find((bot) => bot.id === id)?.cli_access, cliBot.id,
  )).toBe('read-only')
  await page.reload()
  await page.getByRole('button', { name: '展开设置', exact: true }).click()
  await page.getByRole('button', { name: '设定', exact: true }).click()
  await expect(modelPanel.locator('[data-profile-row="model"]')).toContainText('Codex CLI · custom-cli-model')
  await modelPanel.locator('[data-profile-edit="model"]').click()
  await expect(modelPanel.locator('[data-model-unlisted]')).toContainText('custom-cli-model')
  await expect(modelPanel.getByLabel('CLI 可执行文件')).toHaveValue(alternateCliPath)
  await expect(modelPanel.getByRole('group', { name: '文件权限' }).getByRole('button', { name: '只读' })).toHaveAttribute('aria-pressed', 'true')
  await modelPanel.locator('[data-use-bot-default]').click()
  await expect.poll(() => page.evaluate(async (id) =>
    (await window.covan.listBots()).find((bot) => bot.id === id)?.model, cliBot.id,
  )).toBe('')
  console.log('✓ CLI preset/custom/default persist across reload, initial/resume send selected model, path/access edits save')
  await page.evaluate(({ id, cliPath }) => window.covan.updateBot(id, {
    model: 'gpt-6-luna', cli_path: cliPath,
  }), { id: cliBot.id, cliPath: alternateCliPath })
  await expect(modelPanel.getByRole('alert').filter({ hasText: '不在当前 CLI 列表中' })).toBeVisible()
  await page.getByRole('textbox', { name: '输入消息' }).fill('验证不支持模型的错误提示')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect(page.locator('article.message-bot').last()).toContainText('当前 CLI 登录账号不支持这个模型', { timeout: 20000 })
  await expect(page.locator('article.message-bot').last()).not.toContainText('invalid_request_error')
  await modelPanel.getByRole('button', { name: '刷新模型', exact: true }).click()
  await modelPanel.getByRole('button', { name: '使用 CLI 推荐模型 gpt-5.6-sol', exact: true }).click()
  await expect.poll(() => page.evaluate(async (id) =>
    (await window.covan.listBots()).find((bot) => bot.id === id)?.model, cliBot.id,
  )).toBe('gpt-5.6-sol')
  await page.locator('article.message-bot').last().getByRole('button', { name: '重试', exact: true }).click()
  await expect(page.locator('article.message-bot').last()).toContainText('假 CLI 回复', { timeout: 20000 })
  await expect(page.getByRole('button', { name: '停止生成', exact: true })).toHaveCount(0, { timeout: 20000 })
  console.log('✓ Native CLI catalog, unsupported saved model warning, translated error, recommendation and retry')


  await page.getByRole('button', { name: '新建', exact: true }).click()
  await page.locator('button', { hasText: '新建 Bot' }).last().click()
  await cliDialog.locator('[data-rail="cli:claude-cli"]').click()
  await cliDialog.locator('[data-model-option="sonnet"]').click()
  await cliDialog.getByPlaceholder('给你的 Bot 起个名字').fill('Claude CLI 伙伴')
  await cliDialog.getByRole('button', { name: '创建并开始聊天' }).click()
  await expect(cliDialog).toHaveCount(0)
  await expect.poll(() => page.evaluate(async () =>
    (await window.covan.listBots()).find((bot) => bot.name === 'Claude CLI 伙伴')?.model,
  )).toBe('sonnet')
  console.log('✓ Claude CLI model selection saves when creating a Bot')

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
