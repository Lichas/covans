// Optional real LM Studio regression. Uses an isolated Covan profile and no API key.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'covan-local-llm-'))
const model =
  process.env.COVAN_LOCAL_MODEL || 'qwen-3.8-27b-uncensored-8-bit-mlx:2'
let app

try {
  app = await electron.launch({
    args: [root],
    env: {
      ...process.env,
      ELECTRON_RENDERER_URL: '',
      COVAN_USER_DATA_DIR: profile,
    },
  })
  const page = await app.firstWindow()
  const result = await page.evaluate(
    async ({ model }) => {
      const provider = await window.covan.saveProvider({
        name: 'LM Studio 本地回归',
        kind: 'lm-studio',
        api_key: '',
        // Intentionally paste the native endpoint: Covan should normalize it.
        base_url: 'http://localhost:1234/api/v1/chat',
        default_model: model,
      })
      const models = await window.covan.listProviderModels(provider.id)
      const connection = await window.covan.testProvider(provider.id)
      const bot = await window.covan.createBot({
        name: '本地模型',
        provider_id: provider.id,
        model,
        reasoning_effort: 'off',
        max_tokens: 256,
      })
      const chat = await window.covan.createDm(bot.id)
      await window.covan.sendUserMessage(
        chat.id,
        '请用中文只回复一句：本地模型连接成功。',
        [],
      )
      let messages = await window.covan.listMessages(chat.id, undefined, 20)
      for (let attempt = 0; attempt < 240; attempt += 1) {
        const answer = messages.find((message) => message.sender_type === 'bot')
        if (answer && answer.status !== 'streaming') break
        await new Promise((resolve) => setTimeout(resolve, 500))
        messages = await window.covan.listMessages(chat.id, undefined, 20)
      }
      return {
        baseUrl: provider.base_url,
        models,
        connection,
        bot,
        messages,
      }
    },
    { model },
  )
  assert.equal(result.baseUrl, 'http://localhost:1234/v1')
  assert.equal(result.bot.reasoning_effort, 'off')
  assert.equal(result.bot.max_tokens, 256)
  assert.ok(result.models.includes(model), `模型目录中没有 ${model}`)
  assert.equal(result.connection.ok, true, result.connection.error)
  const answer = result.messages.find(
    (message) => message.sender_type === 'bot',
  )
  assert.equal(answer?.status, 'done', answer?.error)
  assert.ok(answer?.content.trim())
  console.log('✓ 无 API Key 拉取 LM Studio 模型')
  console.log('✓ /api/v1/chat 自动规范为 OpenAI 兼容 Base URL /v1')
  console.log(`✓ Covan → ${model} 实际对话成功：${answer.content.trim()}`)
} finally {
  await app?.close()
  fs.rmSync(profile, { recursive: true, force: true })
}
