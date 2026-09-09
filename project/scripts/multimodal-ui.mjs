// Isolated Electron end-to-end test. --kimi opts into the user's configured Kimi service.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'
import { expect } from '@playwright/test'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'covan-multimodal-'))
const artifacts = path.join(root, 'artifacts', 'multimodal')
fs.mkdirSync(artifacts, { recursive: true })
const real = process.argv.includes('--kimi')
const requests = [],
  errors = []
let app, fixture, generatedPng
const server = http.createServer(async (req, res) => {
  try {
    let raw = ''
    for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw || '{}')
    requests.push({ url: req.url, body })
    if (req.url === '/v1/images/generations') {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ data: [{ b64_json: generatedPng }] }))
      return
    }
    const calls = body.messages.filter((m) => m.role === 'tool').length
    const followup = JSON.stringify(body.messages).includes('继续看看')
    const tool = !followup && calls < 2
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    const send = (delta, finish_reason = null) =>
      res.write(
        `data: ${JSON.stringify({
          id: 'test',
          object: 'chat.completion.chunk',
          model: body.model,
          choices: [{ index: 0, delta, finish_reason }],
        })}\n\n`,
      )
    send({ role: 'assistant' })
    send(
      tool
        ? {
            tool_calls: [
              {
                index: 0,
                id: `image-${calls}`,
                type: 'function',
                function: {
                  name: 'generate_image',
                  arguments: JSON.stringify({ prompt: '蓝色方形插画' }),
                },
              },
            ],
          }
        : {
            content: `第1张是红色圆形，第2张是蓝色方形。图片已显示。\n\n![内嵌预览](data:image/png;base64,${generatedPng})`,
          },
    )
    send({}, tool ? 'tool_calls' : 'stop')
    res.end('data: [DONE]\n\n')
  } catch (e) {
    errors.push(String(e))
    res.writeHead(500)
    res.end()
  }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}/v1`
async function launch() {
  app = await electron.launch({
    args: [root],
    env: {
      ...process.env,
      ELECTRON_RENDERER_URL: '',
      COVAN_USER_DATA_DIR: profile,
    },
  })
  const page = await app.firstWindow()
  page.on('pageerror', (e) => errors.push(e.message))
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.waitForFunction(() => !!window.covan)
  return page
}
async function waitAnswer(page, count = 1) {
  await expect
    .poll(
      async () =>
        page.evaluate(
          async (id) =>
            (await window.covan.listMessages(id)).filter(
              (m) => m.sender_type === 'bot' && m.status !== 'streaming',
            ).length,
          fixture.chat.id,
        ),
      { timeout: 180000 },
    )
    .toBe(count)
  const messages = await page.evaluate(
    (id) => window.covan.listMessages(id),
    fixture.chat.id,
  )
  const answer = messages.filter((m) => m.sender_type === 'bot').at(-1)
  assert.equal(answer.status, 'done', answer.error)
  return { messages, answer }
}
try {
  let page = await launch()
  let provider = {
    name: '多模态模拟服务',
    kind: 'openai-compatible',
    api_key: '',
    base_url: base,
    default_model: 'test-vision',
  }
  if (real) {
    // Read only the requested provider in the main process; never print credentials.
    provider = await app.evaluate(async (_, root) => {
      const { createRequire } = process.getBuiltinModule('node:module')
      const { homedir } = process.getBuiltinModule('node:os')
      const req = createRequire(root + '/package.json')
      const Database = req('better-sqlite3')
      const database = new Database(
        homedir() + '/Library/Application Support/covan/legacy.db',
        { readonly: true },
      )
      try {
        const p = database
          .prepare(
            "SELECT name,kind,api_key,base_url,default_model FROM providers WHERE kind='kimi' LIMIT 1",
          )
          .get()
        if (!p) throw new Error('没有已配置的 Kimi Provider')
        return p
      } finally {
        database.close()
      }
    }, root)
  }
  fixture = await page.evaluate(
    async ({ provider, real }) => {
      const api = window.covan
      const p = await api.saveProvider(provider)
      const models = real ? await api.listProviderModels(p.id) : ['test-vision']
      if (real && !models.includes('k3'))
        throw new Error('实时模型列表未返回 k3')
      const bot = await api.createBot({
        name: '多模态测试',
        provider_id: p.id,
        model: real ? 'k3' : 'test-vision',
        max_tokens: 2048,
        reasoning_effort: 'off',
        system_prompt:
          '请直接按用户要求观察图片，用中文简短回复。不要修改任何设置，不要调用不相关工具。',
      })
      const chat = await api.createDm(bot.id)
      if (!real)
        for (const [k, v] of [
          ['avatar_provider', p.id],
          ['avatar_model', 'test-image'],
        ])
          await api.setSetting(k, v)
      return { chat, bot, models }
    },
    { provider, real },
  )
  provider = null
  const pictures = await page.evaluate(() =>
    ['red', 'blue'].map((color, i) => {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 256
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, 256, 256)
      ctx.fillStyle = color
      if (i === 0) {
        ctx.beginPath()
        ctx.arc(128, 128, 80, 0, Math.PI * 2)
        ctx.fill()
      } else ctx.fillRect(48, 48, 160, 160)
      return canvas.toDataURL('image/png').split(',')[1]
    }),
  )
  generatedPng = pictures[1]
  await page.reload()
  await page
    .locator('aside')
    .getByRole('button', { name: '多模态测试', exact: true })
    .click()
  const input = page.getByLabel('选择图片')
  const files = pictures.map((p, i) => ({
    name: `image-${i + 1}.png`,
    mimeType: 'image/png',
    buffer: Buffer.from(p, 'base64'),
  }))
  await input.setInputFiles([...files, { ...files[0], name: 'remove.png' }])
  await expect(page.locator('.composer-image')).toHaveCount(3)
  await page
    .getByRole('button', { name: '移除图片：remove.png', exact: true })
    .click()
  await expect(page.locator('.composer-image')).toHaveCount(2)
  await page.reload()
  await expect(page.locator('.composer-image')).toHaveCount(2)
  await page
    .getByLabel('输入消息')
    .fill('分别描述第1张、第2张图片的颜色与形状。用中文，按顺序作答。')
  const started = Date.now()
  await page.getByRole('button', { name: '发送', exact: true }).click()
  const { messages, answer } = await waitAnswer(page)
  assert.equal(
    messages.find((m) => m.sender_type === 'user').attachments.length,
    2,
  )
  assert.match(answer.content, /红/)
  assert.match(answer.content, /圆/)
  assert.match(answer.content, /蓝/)
  assert.match(answer.content, /方|正方/)
  console.log(
    `✓ ${real ? 'Kimi k3 real' : 'Mock'} multi-image round-trip (${((Date.now() - started) / 1000).toFixed(1)}s): ${answer.content.split('![')[0].trim()}`,
  )
  if (!real) {
    assert.equal(answer.attachments.length, 2)
    const first = requests.find((r) => r.url === '/v1/chat/completions').body
    assert.equal(
      first.messages
        .filter((m) => m.role === 'user')
        .at(-1)
        .content.filter((p) => p.type === 'image_url').length,
      2,
    )
    assert.equal(
      requests.filter((r) => r.url === '/v1/images/generations').length,
      2,
    )
    console.log('✓ Agent tool image outputs persisted and rendered')
    await expect(
      page.locator('.markdown-content img[alt="内嵌预览"]'),
    ).toHaveCount(1)
    await page.locator('.markdown-content .chat-image').click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    const exportPath = path.join(profile, 'multimodal.md')
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath })
    }, exportPath)
    await page.evaluate((id) => window.covan.exportChat(id), fixture.chat.id)
    const exported = fs.readFileSync(exportPath, 'utf8')
    const links = [...exported.matchAll(/\]\((covan-images-[^)]+)\)/g)].map(
      (m) => m[1],
    )
    assert.equal(links.length, 4)
    assert.ok(links.every((link) => fs.existsSync(path.join(profile, link))))
    console.log('✓ Inline Markdown images, lightbox, exported media assets')
  }
  await expect(page.locator('.message-user .message-images img')).toHaveCount(2)
  await page.locator('.message-user .chat-image').first().click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await app.close()
  app = null
  page = await launch()
  await expect(page.locator('.message-user .message-images img')).toHaveCount(2)
  assert.ok(
    await page
      .locator('.message-user .message-images img')
      .first()
      .evaluate((img) => img.complete && img.naturalWidth === 256),
  )
  if (!real) {
    await expect(page.locator('.message-bot .message-images img')).toHaveCount(
      2,
    )
    await page.getByLabel('输入消息').fill('继续看看之前的图片')
    await page.getByRole('button', { name: '发送', exact: true }).click()
    await waitAnswer(page, 2)
    const last = requests
      .filter((r) => r.url === '/v1/chat/completions')
      .at(-1).body
    assert.equal(
      last.messages
        .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
        .filter((p) => p.type === 'image_url').length,
      4,
    )
    await page.getByLabel('选择图片').setInputFiles([files[0]])
    await expect(page.locator('.composer-image')).toHaveCount(1)
    await page.getByRole('button', { name: '发送', exact: true }).click()
    await waitAnswer(page, 3)
    await page.getByLabel('选择图片').setInputFiles(
      Array.from({ length: 9 }, (_, i) => ({
        ...files[0],
        name: `${i}.png`,
      })),
    )
    await expect(page.getByRole('alert')).toContainText('最多 8')
    await page.getByLabel('选择图片').setInputFiles({
      name: 'fake.png',
      mimeType: 'image/png',
      buffer: Buffer.from('not an image'),
    })
    await expect(page.getByRole('alert')).toContainText('请选择 PNG')
    const rejected = await page.evaluate(async (id) => {
      try {
        await window.covan.sendUserMessage(
          id,
          '',
          [],
          [{ path: '../legacy.db', name: 'bad.png', mime: 'image/png' }],
        )
        return false
      } catch {
        return true
      }
    }, fixture.chat.id)
    assert.equal(rejected, true)
    for (const type of ['paste', 'drop']) {
      await page.evaluate(
        ({ png, type }) => {
          const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0))
          const dt = new DataTransfer()
          dt.items.add(new File([bytes], `${type}.png`, { type: 'image/png' }))
          const event =
            type === 'paste'
              ? new ClipboardEvent('paste', {
                  clipboardData: dt,
                  bubbles: true,
                  cancelable: true,
                })
              : new DragEvent('drop', {
                  dataTransfer: dt,
                  bubbles: true,
                  cancelable: true,
                })
          document.querySelector('.composer-shell').dispatchEvent(event)
        },
        { png: pictures[0], type },
      )
      await expect(page.locator('.composer-image')).toHaveCount(
        type === 'paste' ? 1 : 2,
      )
    }
    console.log('✓ Clipboard paste and drag-and-drop imports')
    console.log(
      '✓ Restart persistence, image-only input, history replay, limits and path validation',
    )
  }
  await page.screenshot({
    path: path.join(artifacts, real ? 'kimi.png' : 'mock.png'),
  })
  assert.deepEqual(errors, [])
} finally {
  await app?.close()
  await new Promise((resolve) => server.close(resolve))
  fs.rmSync(profile, { recursive: true, force: true })
}
