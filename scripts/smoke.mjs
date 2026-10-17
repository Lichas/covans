// scripts/smoke.mjs — 纯 Node 冒烟测试（不启动 Electron）
// 用 esbuild 把真实 main/ 模块（db/orchestrator/memory/agentRuntime/mockProvider/workspace）
// 打成临时 ESM bundle（node_modules 依赖保持 external），在临时目录建库后走一遍：
//   mock provider → 建 bot A/B/C → 建群 → sendUserMessage 编排 → 断言事件与落库。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import Database from 'better-sqlite3'
import { runMemoryRegression } from './memory-regression.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'covan-smoke-'))
const userData = path.join(tmp, 'userData')
// bundle 放在项目 node_modules 缓存目录下，保证 external 依赖（better-sqlite3/pi 包）能从项目解析
const bundleDir = path.join(
  root,
  'node_modules',
  '.cache',
  `covan-smoke-${process.pid}`,
)
fs.mkdirSync(bundleDir, { recursive: true })

let failures = 0
function assert(cond, label) {
  if (cond) {
    console.log(`  ✓ ${label}`)
  } else {
    failures += 1
    console.error(`  ✗ ${label}`)
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 1. 打包真实 main 模块（pi/electron/better-sqlite3 等保持 external，由 node_modules 解析）
await build({
  entryPoints: {
    orchestrator: path.join(root, 'main/orchestrator.ts'),
    db: path.join(root, 'main/db.ts'),
    workspace: path.join(root, 'main/workspace.ts'),
    memory: path.join(root, 'main/memory.ts'),
    personas: path.join(root, 'renderer/src/lib/personaTemplates.ts'),
    webTools: path.join(root, 'main/tools/web.ts'),
    bashTools: path.join(root, 'main/tools/bash.ts'),
    agentTools: path.join(root, 'main/agentTools.ts'),
    scheduledTasks: path.join(root, 'main/scheduledTasks.ts'),
    diagnostics: path.join(root, 'main/diagnostics.ts'),
    observability: path.join(root, 'main/observability.ts'),
    decisionStrategy: path.join(root, 'main/decisionStrategy.ts'),
    cli: path.join(root, 'main/cli/index.ts'),
  },
  outdir: bundleDir,
  bundle: true,
  splitting: true, // 多入口共享 chunk，保证 db 模块单例
  format: 'esm',
  platform: 'node',
  target: 'node20',
  packages: 'external',
  logLevel: 'warning',
})

const orchestrator = await import(
  pathToFileURL(path.join(bundleDir, 'orchestrator.js')).href
)
const db = await import(pathToFileURL(path.join(bundleDir, 'db.js')).href)
const workspace = await import(
  pathToFileURL(path.join(bundleDir, 'workspace.js')).href
)

const memory = await import(
  pathToFileURL(path.join(bundleDir, 'memory.js')).href
)
const personas = await import(
  pathToFileURL(path.join(bundleDir, 'personas.js')).href
)
const webTools = await import(
  pathToFileURL(path.join(bundleDir, 'webTools.js')).href
)
const bashTools = await import(
  pathToFileURL(path.join(bundleDir, 'bashTools.js')).href
)
const agentTools = await import(
  pathToFileURL(path.join(bundleDir, 'agentTools.js')).href,
)
const scheduledTasks = await import(
  pathToFileURL(path.join(bundleDir, 'scheduledTasks.js')).href,
)
const diagnostics = await import(pathToFileURL(path.join(bundleDir, 'diagnostics.js')).href)
const observability = await import(pathToFileURL(path.join(bundleDir, 'observability.js')).href)
const decisionStrategy = await import(
  pathToFileURL(path.join(bundleDir, 'decisionStrategy.js')).href,
)
const cli = await import(pathToFileURL(path.join(bundleDir, 'cli.js')).href)

// 2. 初始化（临时目录，WAL）
const legacyDatabaseFile = 'legacy.db'
fs.mkdirSync(userData, { recursive: true })
const oldDb = new Database(path.join(userData, legacyDatabaseFile))
oldDb.exec('CREATE TABLE migration_probe (id INTEGER PRIMARY KEY)')
oldDb.close()
db.initDb(userData)
observability.initObservability(userData)
db.setSetting('local_observability', '1')
const jevRequests = []
decisionStrategy.initResponseDecisionEngine({
  codec: {
    seal: (value) => Buffer.from(value, 'utf8').toString('base64'),
    unseal: (value) => Buffer.from(value, 'base64').toString('utf8'),
  },
  fetch: async (_url, init) => {
    const request = JSON.parse(String(init.body))
    jevRequests.push({
      authorization: init.headers.Authorization,
      state: request.state,
      question: request.questions.response_action,
    })
    const natural = request.state.decision_kind === 'natural_follow_up'
    const lowConfidence = JSON.stringify(request.state).includes('Jev 低置信度冒烟')
    const choice = natural
      ? request.state.follow_up_number === 1
        ? 'reply'
        : 'skip'
      : request.state.round === 1
        ? 'reply'
        : 'skip'
    return new Response(
      JSON.stringify({
        model: 'jev-1.13.0',
        answers: {
          response_action: {
            type: 'choice',
            choice,
            probabilities: { reply: choice === 'reply' ? 0.94 : 0.06, skip: choice === 'skip' ? 0.94 : 0.06 },
            confidence: lowConfidence ? 0.3 : 0.88,
          },
        },
        usage: { input_tokens: 120, output_tokens: 8 },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  },
})
workspace.initWorkspace(userData)
const events = []
orchestrator.initOrchestrator({ emit: (ev) => events.push(ev) })

console.log('\n[1] 建库 & migration')
{
  assert(
    fs.existsSync(path.join(userData, 'covan.db')) &&
      !fs.existsSync(path.join(userData, legacyDatabaseFile)),
    '旧数据库文件已迁移为 covan.db',
  )
  assert(
    Boolean(
      db
        .getDb()
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='migration_probe'")
        .get(),
    ),
    '数据库文件名迁移保留已有数据',
  )
  const tables = db
    .getDb()
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all()
    .map((r) => r.name)
  for (const t of [
    'providers',
    'bots',
    'chats',
    'chat_members',
    'messages',
    'chat_topics',
    'memories',
    'settings',
    'scheduled_tasks',
  ]) {
    assert(tables.includes(t), `表 ${t} 已创建`)
  }
  const config = decisionStrategy.saveJevConfig({
    api_key: 'jev-smoke-secret',
    model: 'jev-latest',
    confidence_threshold: 0.6,
  })
  assert(config.has_api_key && !('api_key' in config), 'Jev 配置只向渲染层返回密钥状态')
  assert(
    !db.getSetting('jev_api_key_sealed').includes('jev-smoke-secret'),
    'Jev API Key 加密后写入本地设置',
  )
}

console.log('\n[1b] 成熟内容偏好与伴侣模板')
{
  db.setSetting('user_profile', JSON.stringify({ name: '旧资料测试' }))
  assert(
    db.getUserProfile().accept_mature_content === false,
    '旧资料默认关闭成熟内容',
  )
  const profile = db.getUserProfile()
  db.saveUserProfile({ ...profile, accept_mature_content: true })
  assert(
    db.getUserProfile().accept_mature_content === true,
    '成熟偏好按布尔值持久化',
  )
  let rejected = false
  try {
    db.saveUserProfile({ ...profile, accept_mature_content: 'true' })
  } catch {
    rejected = true
  }
  assert(
    rejected && db.getUserProfile().accept_mature_content,
    '非法偏好拒绝且不覆盖原值',
  )
  const { accept_mature_content, ...legacy } = profile
  db.saveUserProfile(legacy)
  assert(
    db.getUserProfile().accept_mature_content,
    '旧客户端省略新字段时保留偏好',
  )
  for (const id of ['girlfriend', 'boyfriend']) {
    assert(
      personas.personaTemplateById(id, true).prompt.includes('轻度调情'),
      id + ' 模板支持成熟风格',
    )
    assert(
      personas
        .personaTemplateById(id, false)
        .prompt.includes('用户未开启成熟内容偏好'),
      id + ' 默认模板为日常陪伴',
    )
  }
  assert(
    personas.personaTemplateById('fullstack', true).prompt ===
      personas.personaTemplateById('fullstack', false).prompt,
    '工作型模板不受偏好影响',
  )
  const bot = db.createBot({
    name: '偏好测试',
    system_prompt: personas.personaTemplateById('boyfriend', true).prompt,
  })
  assert(
    memory.buildSystemPrompt(bot, []).includes('用户已开启成熟内容偏好'),
    '运行时注入开启偏好，布尔字段不导致文本拼接崩溃',
  )
  db.saveUserProfile({ ...profile, accept_mature_content: false })
  const prompt = memory.buildSystemPrompt(db.getBot(bot.id), [])
  assert(
    prompt.includes(
      '当前内容偏好（优先于人设中的旧偏好）\n用户未开启成熟内容偏好',
    ),
    '关闭状态覆盖旧模板偏好，无需改写人设',
  )
  assert(
    !prompt.includes('accept_mature_content:'),
    '原始布尔字段不作为用户资料文本发送',
  )
  assert(
    prompt.includes('必须先用 list_bots 找到准确 ID，再调用 agent_private_chat') &&
      prompt.includes('只有本轮确实收到 agent_private_chat 的工具结果') &&
      prompt.includes('禁止自行模拟、代写或编造另一位 Bot 的回答') &&
      prompt.includes('只能依据本轮实际工具执行结果回答'),
    '系统提示词要求跨 Bot 咨询必须真实调用工具且禁止伪造结果',
  )
  db.deleteBot(bot.id)
  db.setSetting('user_profile', '')
}

console.log('\n[1c] 可替换网页搜索 provider')
{
  let received
  const tools = webTools.createWebTools({
    searchProvider: {
      id: 'smoke-search',
      async search(request) {
        received = request
        return [
          { title: '', url: 'https://empty.example/', snippet: '无标题' },
          { title: '非 HTTP', url: 'file:///tmp/private', snippet: '必须过滤' },
          {
            title: '有效结果',
            url: 'https://example.com/path?q=1',
            snippet: 'x'.repeat(2_000),
          },
        ]
      },
    },
  })
  const search = tools.find((tool) => tool.name === 'web_search')
  const result = await search.execute(
    'smoke-search-call',
    { query: 'Covan 工具层', limit: 3, language: 'zh-CN' },
    new AbortController().signal,
  )
  assert(
    received.query === 'Covan 工具层' && received.limit === 3,
    '搜索请求通过 provider 接口注入',
  )
  assert(
    result.details.provider === 'smoke-search' &&
      result.details.results.length === 1 &&
      result.details.results[0].snippet.length === 1_200,
    'provider 返回值由核心层过滤非 HTTP URL 并截断输出',
  )
}

console.log('\n[1d] Bash 工作区沙箱')
{
  const bot = db.createBot({ name: 'Bash 测试' })
  workspace.ensureWorkspace(bot.id)
  const bash = bashTools
    .createBashTools(bot.id)
    .find((tool) => tool.name === 'bash')
  const signal = new AbortController().signal
  process.env.COVAN_SMOKE_BASH_SECRET = 'MUST_NOT_REACH_BASH'
  const run = await bash.execute(
    'bash-basic',
    {
      command:
        "mkdir -p nested && printf 'bash-ok' > nested/result.txt && printf 'stdout-ok' && printf 'stderr-ok' >&2 && printf \"$COVAN_SMOKE_BASH_SECRET\"",
    },
    signal,
  )
  delete process.env.COVAN_SMOKE_BASH_SECRET
  assert(
    run.details.exitCode === 0 &&
      run.content[0].text.includes('stdout-ok') &&
      run.content[0].text.includes('stderr-ok') &&
      !run.content[0].text.includes('MUST_NOT_REACH_BASH') &&
      fs.readFileSync(
        path.join(workspace.botWorkspaceDir(bot.id), 'nested', 'result.txt'),
        'utf8',
      ) === 'bash-ok',
    'Bash 在 Bot 工作区执行并使用不含宿主密钥的最小环境',
  )
  const nested = await bash.execute(
    'bash-cwd',
    { command: 'pwd', cwd: 'nested' },
    signal,
  )
  assert(
    nested.details.cwd === 'nested' &&
      nested.content[0].text.includes('/nested'),
    'Bash cwd 只能选择工作区内已有目录',
  )
  const outside = path.join(tmp, 'bash-private.txt')
  fs.writeFileSync(outside, 'OUTSIDE_WORKSPACE_SECRET')
  const denied = await bash.execute(
    'bash-outside-read',
    { command: `cat ${JSON.stringify(outside)}` },
    signal,
  )
  assert(
    denied.details.exitCode !== 0 &&
      !denied.content[0].text.includes('OUTSIDE_WORKSPACE_SECRET'),
    'macOS 沙箱拒绝 Bash 读取 Bot 工作区外的文件内容',
  )
  const timedOut = await bash.execute(
    'bash-timeout',
    { command: 'sleep 5', timeout_seconds: 1 },
    signal,
  )
  assert(
    timedOut.details.timedOut && timedOut.details.durationMs < 4_000,
    'Bash 超时会终止进程组',
  )
  const truncated = await bash.execute(
    'bash-truncate',
    { command: "head -c 100000 /dev/zero | tr '\\0' x" },
    signal,
  )
  assert(
    truncated.details.truncated && truncated.content[0].text.length < 50_000,
    'Bash 输出按流限制为40KB并标记截断',
  )
  db.deleteBot(bot.id)
}

console.log('\n[1e] 本地 CLI 运行后端')
{
  const fakeCli = path.join(root, 'scripts/fixtures/fake-cli.mjs')
  const cliLog = path.join(tmp, 'cli-calls.jsonl')
  process.env.COVAN_FAKE_CLI_LOG = cliLog
  const calls = () =>
    fs.existsSync(cliLog)
      ? fs
          .readFileSync(cliLog, 'utf8')
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line))
      : []
  const TINY_PNG =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='
  const userTurn = (text, withImage = false) => ({
    role: 'user',
    content: [
      { type: 'text', text },
      ...(withImage
        ? [{ type: 'image', data: TINY_PNG, mimeType: 'image/png' }]
        : []),
    ],
    timestamp: Date.now(),
  })
  const runTurn = async (bot, chat, history, systemPrompt) => {
    let text = ''
    const artifacts = []
    const errors = []
    await cli.runCliAgent(
      chat.id,
      db.getBot(bot.id),
      history,
      {
        onDelta: (delta) => {
          text += delta
        },
        onDone: () => {},
        onError: (message) => errors.push(message),
        onArtifact: (artifact) => artifacts.push(artifact),
      },
      { systemPrompt },
      new AbortController().signal,
    )
    return { text, artifacts, errors }
  }

  const probe = await cli.probeLocalCli('codex-cli', fakeCli)
  assert(
    probe.available && probe.version === '0.149.0' && probe.path === fakeCli,
    '探测本地 CLI 返回可用性、版本与真实路径',
  )
  const missing = await cli.probeLocalCli(
    'codex-cli',
    path.join(tmp, 'nope', 'missing-cli'),
  )
  assert(
    !missing.available && missing.error.includes('找不到'),
    'CLI 路径不存在时返回可读错误而不是抛异常',
  )

  const catalog = await cli.listLocalCliModels('codex-cli', fakeCli)
  assert(catalog.models.map((m) => m.id).join(',') === 'gpt-5.6-sol,gpt-5.6-luna,gpt-5.6-terra,account-only-model',
    'CLI 模型来自分页目录，去重并过滤隐藏项，不使用写死列表')
  assert(catalog.models.find((m) => m.id === 'gpt-5.6-sol')?.recommended, '保留 CLI 推荐模型标识')
  const missingCatalog = await cli.listLocalCliModels('codex-cli', path.join(tmp, 'missing-cli'))
  assert(!missingCatalog.models.length && !!missingCatalog.error, 'CLI 模型读取失败不回退假设的可用模型')
  const previousCatalogMode = process.env.COVAN_FAKE_CLI_CATALOG_MODE
  try {
    for (const mode of ['error', 'invalid', 'empty', 'loop']) {
      process.env.COVAN_FAKE_CLI_CATALOG_MODE = mode
      const result = await cli.listLocalCliModels('codex-cli', fakeCli)
      assert(!result.models.length && !!result.error, `模型目录 ${mode} 返回可恢复错误且不暴露部分目录`)
    }
  } finally {
    if (previousCatalogMode === undefined) delete process.env.COVAN_FAKE_CLI_CATALOG_MODE
    else process.env.COVAN_FAKE_CLI_CATALOG_MODE = previousCatalogMode
  }

  const cliBot = db.createBot({
    name: 'CLI 冒烟',
    backend: 'codex-cli',
    cli_path: fakeCli,
    cli_access: 'read-only',
    model: 'gpt-5.6-sol',
  })
  const cliChat = db.createDm(cliBot.id)

  const unsupportedBot = db.createBot({ name: '不支持模型', backend: 'codex-cli', cli_path: fakeCli, model: 'gpt-6-luna' })
  const unsupportedChat = db.createDm(unsupportedBot.id)
  const unsupported = await runTurn(unsupportedBot, unsupportedChat, [userTurn('你好')], '模型错误用例')
  assert(unsupported.errors.some((e) => e.includes('当前 CLI 登录账号不支持这个模型') && e.includes('刷新 CLI 模型列表') && !e.includes('invalid_request_error')),
    '账号不支持模型时显示中文修复入口，不直接展示原始 JSON')
  assert(db.getBot(unsupportedBot.id).model === 'gpt-6-luna', '模型错误不静默替换用户的模型选择')

  // 首轮：新会话，提示词应包含人设与既有转录
  const first = await runTurn(
    cliBot,
    cliChat,
    [userTurn('第一句')],
    '你是 CLI 冒烟 Bot',
  )
  const firstCall = calls().at(-1)
  assert(
    first.text.includes('假 CLI 回复（新会话）') && !first.errors.length,
    '本地 CLI 正文按增量流式回传并正常结束',
  )
  assert(
    firstCall.prompt.includes('你是 CLI 冒烟 Bot') &&
      firstCall.prompt.includes('第一句') &&
      firstCall.isResume === false,
    '首次发言把系统提示与转录一并交给 CLI 建立会话',
  )
  assert(
    firstCall.sandbox === 'read-only',
    'Codex CLI 的只读权限映射为 --sandbox read-only',
  )
  assert(
    first.artifacts.some((artifact) => artifact.relPath === 'cli-note.txt'),
    'CLI 报告的文件改动转换为工作区交付产物',
  )

  // 会话续接：只发送新的用户消息
  const second = await runTurn(cliBot, cliChat, [userTurn('第二句')], '不会再用到')
  const secondCall = calls().at(-1)
  assert(
    secondCall.isResume === true && secondCall.prompt === '第二句',
    '同一会话后续轮次续接 CLI 会话且只发送最新用户消息',
  )
  assert(
    second.text.includes('续接'),
    '续接轮次的正文同样写回聊天',
  )
  assert(
    firstCall.model === 'gpt-5.6-sol' && secondCall.model === 'gpt-5.6-sol',
    '新建与续接都带上 Bot 指定模型（resume 不带 -m 会回退 CLI 默认模型）',
  )

  // 图片：Codex 走 -i 附图参数
  await runTurn(cliBot, cliChat, [userTurn('看图', true)], '')
  assert(calls().at(-1).imageCount === 1, 'Codex CLI 通过 -i 传递用户图片')

  // 失败路径：CLI 报错时进入错误回调而不是产生空回复
  const failed = await runTurn(cliBot, cliChat, [userTurn('FAIL_ME')], '')
  assert(
    failed.errors.length === 1 && failed.errors[0].includes('假 CLI 主动失败'),
    'CLI 运行失败时把真实错误交给聊天气泡',
  )

  // 清空聊天记录后必须重建 CLI 会话
  db.clearChatMessages(cliChat.id)
  assert(
    db.getCliSession(cliBot.id, cliChat.id, cli.cliFingerprint(db.getBot(cliBot.id))) === '',
    '清空聊天记录后丢弃 CLI 会话映射',
  )
  await runTurn(cliBot, cliChat, [userTurn('清空之后')], '')
  assert(calls().at(-1).isResume === false, '清空后重新建立 CLI 会话')

  // 换模型也要重建会话：续接时模型与建会话不一致会被 CLI 警告甚至直接失败。
  db.updateBot(cliBot.id, { model: 'gpt-5.4' })
  await runTurn(db.getBot(cliBot.id), cliChat, [userTurn('换模型')], '')
  assert(
    calls().at(-1).isResume === false && calls().at(-1).model === 'gpt-5.4',
    '修改模型后重建 CLI 会话并带上新模型',
  )

  // 判断用 Provider 不能接管 CLI 的正文：CLI 后端优先于 mock Provider。
  const mockJudge = db.saveProvider({ name: 'Mock 判断用', kind: 'mock' })
  const judgeBot = db.createBot({
    name: 'CLI 带判断 Provider',
    backend: 'codex-cli',
    cli_path: fakeCli,
    model: 'gpt-5.6-sol',
    provider_id: mockJudge.id,
  })
  const judgeChat = db.createDm(judgeBot.id)
  const judged = await runTurn(judgeBot, judgeChat, [userTurn('正文必须来自 CLI')], '')
  assert(
    judged.text.includes('假 CLI 回复') && calls().at(-1).model === 'gpt-5.6-sol',
    '判断用 Provider（含 mock）不接管 CLI Bot 的正文生成',
  )
  db.deleteBot(judgeBot.id)
  db.deleteProvider(mockJudge.id)

  // Claude 方言：改用 -p/stream-json，且只读映射为 plan 权限模式
  process.env.COVAN_FAKE_CLI_DIALECT = 'claude'
  const claudeBot = db.createBot({
    name: 'Claude CLI 冒烟',
    backend: 'claude-cli',
    cli_path: fakeCli,
    cli_access: 'read-only',
  })
  const claudeChat = db.createDm(claudeBot.id)
  const claudeFirst = await runTurn(claudeBot, claudeChat, [userTurn('你好')], '人设')
  const claudeCall = calls().at(-1)
  assert(
    claudeFirst.text.includes('假 CLI 回复（新会话）') &&
      claudeCall.permissionMode === 'plan',
    'Claude CLI 适配器解析 stream-json 并把只读映射为 plan 权限模式',
  )
  const claudeSecond = await runTurn(claudeBot, claudeChat, [userTurn('再来')], '')
  assert(
    calls().at(-1).isResume === true && claudeSecond.text.includes('续接'),
    'Claude CLI 通过 --resume 续接会话',
  )
  delete process.env.COVAN_FAKE_CLI_DIALECT
  delete process.env.COVAN_FAKE_CLI_LOG

  db.deleteBot(cliBot.id)
  db.deleteBot(unsupportedBot.id)
  db.deleteBot(claudeBot.id)
}

console.log('\n[2] 注入 mock provider + bot A/B/C')
const provider = db.saveProvider({ name: 'Mock Provider', kind: 'mock' })
assert(provider.kind === 'mock', 'mock provider 已保存')
const lmStudio = db.saveProvider({
  name: 'LM Studio',
  kind: 'lm-studio',
  base_url: 'http://localhost:1234/api/v1/chat',
})
assert(
  lmStudio.base_url === 'http://localhost:1234/v1',
  'LM Studio 地址已规范化为 /v1',
)
const kimi = db.saveProvider({ name: 'Kimi', kind: 'kimi' })
const botA = db.createBot({
  name: '架构师老A',
  description: '架构设计师',
  provider_id: provider.id,
  is_coordinator: true,
})
const botB = db.createBot({
  name: '测试员小B',
  description: '端到端测试',
  provider_id: provider.id,
})
const botC = db.createBot({
  name: '产品经理小C',
  description: '产品视角',
  provider_id: provider.id,
})
const kimiBot = db.createBot({ name: 'Kimi Bot', provider_id: kimi.id })
assert(botB.reasoning_effort === 'medium', '普通 Bot 默认使用中等推理')
assert(botB.max_tokens === 8192, '普通 Bot 默认最大输出为 8192 Token')
assert(botB.response_decision_strategy === 'auto', 'Bot 默认自动优先使用可用的 Jev 响应决策')
assert(kimiBot.reasoning_effort === 'medium', 'Kimi Bot 默认也使用中等推理')
assert(kimiBot.max_tokens === 8192, 'Kimi Bot 默认最大输出为 8192 Token')
db.deleteBot(kimiBot.id)
for (const bot of [botA, botB, botC])
  db.updateBot(bot.id, { response_decision_strategy: 'llm' })
assert(db.listBots().length === 3, '3 个 bot 已创建')
workspace.ensureWorkspace(botA.id)
assert(
  fs.existsSync(path.join(userData, 'workspaces', botA.id)),
  'bot A 工作区目录已创建',
)
{
  const tools = workspace.createWorkspaceTools(botA.id)
  const read = tools.find((tool) => tool.name === 'workspace_read')
  const write = tools.find((tool) => tool.name === 'workspace_write')
  const signal = new AbortController().signal
  let absoluteRejected = false
  try {
    await write.execute(
      'absolute-path',
      { path: path.join(tmp, 'escape.txt'), content: '不应写入' },
      signal,
    )
  } catch {
    absoluteRejected = true
  }
  assert(absoluteRejected, '工作区工具拒绝绝对路径')

  const outside = path.join(tmp, 'outside.txt')
  const link = path.join(workspace.botWorkspaceDir(botA.id), 'outside-link.txt')
  fs.writeFileSync(outside, '工作区外的内容')
  fs.symlinkSync(outside, link)
  let symlinkRejected = false
  try {
    await read.execute('symlink-path', { path: 'outside-link.txt' }, signal)
  } catch {
    symlinkRejected = true
  }
  assert(symlinkRejected, '工作区工具拒绝符号链接逃逸')
}

console.log('\n[3] 建群（默认顺序回复）并发送用户消息')
const group = db.createGroup('冒烟讨论组', [botA.id, botB.id, botC.id])
assert(group.type === 'group', '群聊已创建')
assert(group.reply_mode === 'sequential', '新群默认使用顺序回复')
assert(
  typeof group.background_image === 'string' &&
    group.background_image.endsWith('.png'),
  '新群随机分配群聊背景',
)
const t0 = Date.now()
await orchestrator.sendUserMessage(
  group.id,
  '大家觉得这个新功能怎么做比较好？',
  [],
)
console.log(
  `  （3 个 mock bot 串行发言耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s）`,
)

const msgs = db.listMessages(group.id, undefined, 100)
const firstBotReply = msgs.find((message) => message.sender_type === 'bot' && message.status === 'done')
const groupReport = diagnostics.getDiagnosticReport(`covan-debug:v1:${firstBotReply.id}`)
assert(
  groupReport.events.some((event) => event.event === 'completion.started' && event.fields.operation === 'group_reply_decision') &&
    groupReport.events.some((event) => event.event === 'group.reply_decision' && ['reply', 'skip', 'forced_reply'].includes(event.fields.outcome)),
  '群聊判断模型调用及决策结果通过轮次追踪 ID 汇入回复诊断报告',
)
assert(
  msgs.some((m) => m.sender_type === 'user' && m.content.includes('新功能')),
  '用户消息已落库',
)
assert(
  !msgs.some(
    (m) =>
      m.sender_type === 'system' &&
      (m.content.includes('依次发言') || m.content.includes('已发消息给')),
  ),
  '不在聊天记录中插入回复机制提示',
)
for (const [label, bot] of [
  ['A', botA],
  ['B', botB],
  ['C', botC],
]) {
  const done = msgs.filter(
    (m) =>
      m.sender_type === 'bot' &&
      m.sender_bot_id === bot.id &&
      m.status === 'done' &&
      m.content.length > 0,
  )
  assert(
    done.length > 0,
    `bot ${label}（${bot.name}）产生 done 消息：「${done[0]?.content.slice(0, 30) ?? ''}…」`,
  )
}
assert(
  events.some((e) => e.type === 'agent-activity' && e.state === 'preparing'),
  '推送了 Agent 准备回复状态',
)
assert(
  events.some((e) => e.type === 'agent-activity' && e.state === 'speaking'),
  '推送了 Agent 正在回复状态',
)
assert(
  events.some((e) => e.type === 'message-delta'),
  '推送了 message-delta 事件',
)
assert(
  events.some((e) => e.type === 'message-done'),
  '推送了 message-done 事件',
)
assert(
  events.some((e) => e.type === 'chat-updated'),
  '推送了 chat-updated 事件',
)
const chatAfter = db.getChat(group.id)
assert(chatAfter.last_message_at > 0, 'last_message_at 已更新')

console.log('\n[3b] 顺序回复 + @mention 强制首位')
{
  events.length = 0
  const g2 = db.createGroup(
    '协调者冒烟组',
    [botA.id, botB.id, botC.id],
    botA.id,
  )
  assert(g2.coordinator_bot_id === botA.id, '协调者已设置')
  await orchestrator.sendUserMessage(g2.id, '请 @测试员小B 先说下风险', [
    botB.id,
  ])
  const m2 = db.listMessages(g2.id, undefined, 100)
  const botMsgs = m2.filter(
    (m) => m.sender_type === 'bot' && m.status === 'done',
  )
  assert(
    botMsgs.length >= 2,
    `成员判断后至少 2 个 bot 发言（实际 ${botMsgs.length}）`,
  )
  assert(
    botMsgs[0]?.sender_bot_id === botB.id,
    '@mention 的 bot B 被强制排在首位发言',
  )
}

console.log('\n[3c] 主动回复：并发判断 + 思考中插入新消息')
{
  events.length = 0
  const active = db.createGroup('主动回复冒烟组', [botA.id, botB.id, botC.id])
  db.updateChat(active.id, { replyMode: 'active' })
  assert(db.getChat(active.id).reply_mode === 'active', '可切换为主动回复')
  const running = orchestrator.sendUserMessage(
    active.id,
    '第一条：你们怎么看？',
    [],
  )
  await sleep(5)
  await orchestrator.sendUserMessage(active.id, '补充：请优先考虑可靠性。', [])
  await running
  const activeMessages = db.listMessages(active.id, undefined, 100)
  assert(
    activeMessages.filter((message) => message.sender_type === 'user')
      .length === 2,
    '思考中的新消息会立即落库',
  )
  assert(
    activeMessages.filter(
      (message) => message.sender_type === 'bot' && message.status === 'done',
    ).length === 3,
    '三位成员并发判断后完成回复',
  )
  const preparing = events.filter(
    (event) => event.type === 'agent-activity' && event.state === 'preparing',
  )
  assert(preparing.length >= 6, '新消息使尚未完成的三个判断重新开始')
}

console.log('\n[3d] 顺序回复：思考中插入新消息并更新当前成员上下文')
{
  events.length = 0
  const sequential = db.createGroup('顺序插话冒烟组', [botA.id, botB.id])
  const running = orchestrator.sendUserMessage(
    sequential.id,
    '第一条：请评估这个方案。',
    [],
  )
  await sleep(5)
  await orchestrator.sendUserMessage(
    sequential.id,
    '补充：先回答可靠性。',
    [botA.id],
  )
  await running
  const messages = db.listMessages(sequential.id, undefined, 100)
  assert(
    messages.filter((message) => message.sender_type === 'user').length === 2,
    '顺序模式思考中的新消息会立即落库',
  )
  const firstReply = messages.find(
    (message) => message.sender_type === 'bot' && message.status === 'done',
  )
  assert(
    firstReply?.content.includes('补充：先回答可靠性'),
    '正在思考的顺序成员用补充消息重新判断并回复',
  )
  const preparing = events.filter(
    (event) =>
      event.type === 'agent-activity' &&
      event.botId === botA.id &&
      event.state === 'preparing',
  )
  assert(preparing.length >= 2, '顺序成员的过期判断被取消并重新开始')
}

console.log('\n[4] 单聊（dm）直调')
const dm = db.createDm(botB.id)
db.updateChat(dm.id, {
  backgroundImage: '03-starry-night-milky-way.png',
})
assert(
  db.getChat(dm.id).background_image === '03-starry-night-milky-way.png',
  'dm 可设置聊天背景',
)
db.updateChat(dm.id, { backgroundImage: '' })
assert(db.getChat(dm.id).background_image === '', 'dm 可清除聊天背景')
await orchestrator.sendUserMessage(dm.id, '帮我看看这个用例怎么写', [])
const dmMsgs = db.listMessages(dm.id, undefined, 50)
assert(
  dmMsgs.some((m) => m.sender_bot_id === botB.id && m.status === 'done'),
  'dm 中 bot B 产生 done 消息',
)

console.log('\n[4a] 新话题：保留历史、压缩摘要并切断原文上下文')
{
  const before = db.listMessages(dm.id, undefined, 100)
  const beforeIds = new Set(before.map((message) => message.id))
  const initialState = orchestrator.getChatTopicState(dm.id)
  assert(initialState.current_message_count >= 2, '新话题前统计当前上下文消息')
  const result = await orchestrator.startChatTopic(dm.id)
  const after = db.listMessages(dm.id, undefined, 100)
  const nextState = orchestrator.getChatTopicState(dm.id)
  assert(
    result.marker.sender_type === 'system' &&
      result.marker.system_kind === 'topic_boundary' &&
      after.some((message) => message.id === result.marker.id),
    '创建可见的新话题分界消息',
  )
  assert(
    [...beforeIds].every((id) => after.some((message) => message.id === id)),
    '开始新话题不会删除历史消息',
  )
  assert(
    result.topic.summary.length > 0 &&
      nextState.current_message_count === 0 &&
      db.listCurrentTopicMessages(dm.id, 30).length === 0,
    '旧话题保存摘要且当前模型原文上下文归零',
  )
  await orchestrator.sendUserMessage(dm.id, '新话题里的第一条消息', [])
  const current = db.listCurrentTopicMessages(dm.id, 30)
  assert(
    current.some((message) => message.content.includes('新话题里的第一条')) &&
      current.every((message) => !beforeIds.has(message.id)),
    '边界后的消息独立进入新上下文',
  )
  const topicEvents = events.filter(
    (event) =>
      event.type === 'system-message' && event.message.id === result.marker.id,
  )
  assert(topicEvents.length === 1, '新话题边界通过实时事件推送到 UI')
  const topicLog = fs.readFileSync(
    path.join(userData, 'logs', 'observability.jsonl'),
    'utf8',
  )
  assert(
    topicLog.includes('chat.topic.summary.started') &&
      topicLog.includes('chat.topic.started'),
    '新话题摘要与边界写入可观测日志',
  )

  const topicGroup = db.createGroup('群聊新话题冒烟', [botA.id])
  db.insertMessage({
    chat_id: topicGroup.id,
    sender_type: 'user',
    content: '群聊旧话题的目标与约束',
  })
  db.insertMessage({
    chat_id: topicGroup.id,
    sender_type: 'bot',
    sender_bot_id: botA.id,
    content: '群聊旧话题已有一个结论',
  })
  db.updateChatSummary(topicGroup.id, '旧滚动摘要')
  const groupTopicResult = await orchestrator.startChatTopic(topicGroup.id)
  assert(
    groupTopicResult.topic.previous_message_count === 2 &&
      db.getChat(topicGroup.id).context_summary === '' &&
      db.listCurrentTopicMessages(topicGroup.id, 5).length === 0,
    '群聊同样创建话题边界，并从新话题重新计算滚动摘要',
  )
  db.deleteChat(topicGroup.id)

  const unconfigured = db.createBot({ name: '无摘要模型' })
  const failedTopicChat = db.createDm(unconfigured.id)
  db.insertMessage({
    chat_id: failedTopicChat.id,
    sender_type: 'user',
    content: '摘要失败时必须保留原状',
  })
  const failedBefore = db.listMessages(failedTopicChat.id).length
  let topicFailed = false
  try {
    await orchestrator.startChatTopic(failedTopicChat.id)
  } catch {
    topicFailed = true
  }
  assert(
    topicFailed &&
      db.getLatestChatTopic(failedTopicChat.id) === null &&
      db.listMessages(failedTopicChat.id).length === failedBefore,
    '摘要模型失败时不写入半成品话题或系统分界',
  )
  db.deleteBot(unconfigured.id)
}

console.log('\n[4b] 定时 Agent 任务：持久化、工具与消息投递')
{
  const appTools = agentTools.createAppTools(botB.id, dm.id)
  const names = appTools.map((tool) => tool.name)
  assert(
    ['list_scheduled_tasks', 'create_scheduled_task', 'update_scheduled_task', 'delete_scheduled_task'].every((name) => names.includes(name)),
    '普通会话向 Agent 暴露定时任务查看与管理工具',
  )
  const create = appTools.find((tool) => tool.name === 'create_scheduled_task')
  const created = await create.execute(
    'scheduled-tool-create',
    {
      title: '工具创建的日报',
      prompt: '整理今天的测试重点，给出三条清单。',
      schedule: 'cron',
      cron: '0 9 * * *',
      timezone: 'Asia/Shanghai',
    },
    new AbortController().signal,
  )
  const createdTask = JSON.parse(created.content[0].text)
  assert(
    createdTask.bot_id === undefined &&
      db.listScheduledTasks(botB.id).some((task) => task.id === createdTask.id && task.model === ''),
    'Agent 工具创建的任务绑定当前 Bot 并默认继承模型',
  )

  const task = db.saveScheduledTask({
    bot_id: botB.id,
    chat_id: dm.id,
    title: '立即执行回归',
    prompt: '只用一句话汇报定时任务完成。',
    schedule: 'once',
    run_at: Date.now() + 60 * 60 * 1000,
    timezone: 'Asia/Shanghai',
    model: 'mock-scheduled-override',
    enabled: false,
  })
  assert(
    task.next_run_at === null && task.model === 'mock-scheduled-override',
    '暂停任务保留模型覆盖但不安排下次执行',
  )
  const before = db.listMessages(dm.id, undefined, 100).length
  const eventStart = events.length
  scheduledTasks.startScheduledTasks(orchestrator.runScheduledTask)
  await scheduledTasks.runScheduledTaskNow(task.id)
  const finished = db.getScheduledTask(task.id)
  const scheduledMessages = db.listMessages(dm.id, undefined, 100)
  assert(
    finished.last_status === 'done' && !finished.enabled,
    '单次任务手动执行后写入完成状态且保持暂停',
  )
  assert(
    scheduledMessages.length === before + 1 &&
      scheduledMessages.at(-1).sender_bot_id === botB.id &&
      scheduledMessages.at(-1).status === 'done',
    '定时任务完成后只投递 Bot 真实结果，不插入伪造用户消息',
  )
  const scheduledReport = diagnostics.getDiagnosticReport(`covan-debug:v1:${scheduledMessages.at(-1).id}`)
  assert(
    scheduledReport.events.some((event) => event.event === 'scheduled_task.triggered' && event.fields.trigger_source === 'manual') &&
      scheduledReport.events.some((event) => event.event === 'scheduled_task.completed' && event.fields.result_status === 'done') &&
      scheduledReport.events.some((event) => event.event === 'agent.dispatch.started' && event.fields.scheduled_task_id === observability.anonymizeId(task.id)),
    '定时任务触发、Agent 执行和完成状态通过追踪 ID 汇入同一诊断报告',
  )
  const taskLog = fs.readFileSync(path.join(userData, 'logs', 'observability.jsonl'), 'utf8')
  assert(
    !/整理今天的测试重点|只用一句话汇报定时任务完成/.test(taskLog),
    '定时任务提示词不写入观测日志',
  )
  const taskStates = events
    .slice(eventStart)
    .filter((event) => event.type === 'scheduled-task-state')
    .map((event) => event.running)
  assert(
    JSON.stringify(taskStates) === '[true,false]',
    '定时任务运行状态成对发送，渲染可可靠结束回复状态',
  )
  scheduledTasks.stopScheduledTasks()
}

console.log('\n[4b] 单聊自然追问：有价值才续发，过滤元话术，最多两条')
const naturalDm = db.createDm(botC.id)
await orchestrator.sendUserMessage(
  naturalDm.id,
  '自然追问冒烟：帮我一起想想方案',
  [],
)
const naturalReplies = db
  .listMessages(naturalDm.id, undefined, 20)
  .filter((m) => m.sender_type === 'bot' && m.status === 'done')
assert(
  naturalReplies.length === 2 &&
    naturalReplies[1].content === '你更想先确认目标还是约束？',
  `自然追问只追加一条具体消息并及时停止（实际 ${naturalReplies.length} 条）`,
)
const countDoneBotMessages = (chatId) =>
  db
    .listMessages(chatId, undefined, 50)
    .filter((m) => m.sender_type === 'bot' && m.status === 'done').length
const beforeGuarded = countDoneBotMessages(naturalDm.id)
await orchestrator.sendUserMessage(
  naturalDm.id,
  '自然追问元话术防护',
  [],
)
assert(
  countDoneBotMessages(naturalDm.id) === beforeGuarded + 1,
  '包含“下一条来了”等调度元话术的候选不会发送',
)
const beforeCapped = countDoneBotMessages(naturalDm.id)
await orchestrator.sendUserMessage(
  naturalDm.id,
  '自然追问两条上限冒烟',
  [],
)
assert(
  countDoneBotMessages(naturalDm.id) === beforeCapped + 3,
  `有两个具体承接点时最多追加两条（新增 ${countDoneBotMessages(naturalDm.id) - beforeCapped} 条）`,
)
const beforeSegmented = countDoneBotMessages(naturalDm.id)
await orchestrator.sendUserMessage(naturalDm.id, '自然分段冒烟', [])
const segmentedReplies = db
  .listMessages(naturalDm.id, undefined, 3)
  .filter((m) => m.sender_type === 'bot' && m.status === 'done')
assert(
  countDoneBotMessages(naturalDm.id) === beforeSegmented + 3 &&
    segmentedReplies.map((message) => message.content).join('|') ===
      '第一段先说明目标。|第二段提供约束。|第三段给出下一步。',
  '较长回答按三个不重复的语义段依次发送',
)
db.setSetting('natural_follow_up', '0')
const beforeDisabled = countDoneBotMessages(naturalDm.id)
await orchestrator.sendUserMessage(
  naturalDm.id,
  '自然追问冒烟：关闭后只要一条',
  [],
)
assert(
  countDoneBotMessages(naturalDm.id) === beforeDisabled + 1,
  '关闭自然追问后不再附加消息',
)
db.setSetting('natural_follow_up', '1')

console.log('\n[4c] Jev 响应策略：自动优先、群聊判断、自然续发与低置信度回退')
{
  const jevBot = db.createBot({
    name: 'Jev 决策测试',
    provider_id: provider.id,
  })
  const jevGroup = db.createGroup('Jev 群聊', [jevBot.id])
  await orchestrator.sendUserMessage(jevGroup.id, 'Jev 群聊冒烟', [])
  const groupReplies = db
    .listMessages(jevGroup.id, undefined, 20)
    .filter((message) => message.sender_type === 'bot' && message.status === 'done')
  assert(groupReplies.length === 1, '自动策略在 Jev 已配置时优先使用 Jev')

  const jevDm = db.createDm(jevBot.id)
  await orchestrator.sendUserMessage(jevDm.id, 'Jev 续发冒烟', [])
  const dmReplies = db
    .listMessages(jevDm.id, undefined, 20)
    .filter((message) => message.sender_type === 'bot' && message.status === 'done')
  assert(
    dmReplies.length === 2 &&
      dmReplies[1].content === '还需要你确认更看重速度还是稳定性？',
    'Jev 只决定续发，正文仍由 Bot 当前生成模型起草',
  )

  const fallbackGroup = db.createGroup('Jev 低置信度', [jevBot.id])
  await orchestrator.sendUserMessage(fallbackGroup.id, 'Jev 低置信度冒烟', [])
  const fallbackReplies = db
    .listMessages(fallbackGroup.id, undefined, 20)
    .filter((message) => message.sender_type === 'bot' && message.status === 'done')
  assert(fallbackReplies.length === 1, 'Jev 低置信度时回退传统 LLM 判断')
  const log = fs.readFileSync(
    path.join(userData, 'logs', 'observability.jsonl'),
    'utf8',
  )
  assert(
    log.includes('decision.jev.completed') &&
      log.includes('low_confidence') &&
      !log.includes('jev-smoke-secret'),
    'Jev 决策、置信度回退可观测且日志不含 API Key',
  )
  assert(
    jevRequests.every(
      (request) =>
        request.authorization === 'Bearer jev-smoke-secret' &&
        request.question.type === 'choice',
    ),
    'Jev 请求使用加密配置中的密钥和 Choice 结构化问题',
  )
  db.deleteBot(jevBot.id)
}

console.log('\n[4d] 群聊延展讨论：有新观点才进入下一轮，最多五轮')
const multiRound = db.createGroup('多轮冒烟组', [botA.id, botC.id])
await orchestrator.sendUserMessage(
  multiRound.id,
  '多轮冒烟：请大家就方案继续讨论并互相补充',
  [],
)
const multiRoundReplies = db
  .listMessages(multiRound.id, undefined, 30)
  .filter((m) => m.sender_type === 'bot' && m.status === 'done')
assert(
  multiRoundReplies.length === 4,
  `两位成员完成首轮和一轮延展（实际 ${multiRoundReplies.length} 条）`,
)
assert(multiRoundReplies.length <= 2 * 5, '群聊延展严格受最多五轮上限约束')
const roundCap = db.createGroup('五轮上限组', [botA.id])
await orchestrator.sendUserMessage(
  roundCap.id,
  '五轮上限冒烟：请持续提出新的具体方案',
  [],
)
assert(
  db
    .listMessages(roundCap.id, undefined, 12)
    .filter((m) => m.sender_type === 'bot' && m.status === 'done').length === 5,
  '即使每轮都决定回复，群聊也在第 5 轮硬停止',
)

console.log('\n[4e] 本地 CLI Bot 的群聊判断：Jev 可用则参与，否则只响应 @提及')
{
  const fakeCli = path.join(root, 'scripts/fixtures', 'fake-cli.mjs')
  // [1e] 结束时会清掉环境变量，这里重新指定一个独立的调用日志。
  const cliLog = path.join(tmp, 'cli-group-calls.jsonl')
  process.env.COVAN_FAKE_CLI_LOG = cliLog
  const cliCallCount = () =>
    fs.existsSync(cliLog)
      ? fs.readFileSync(cliLog, 'utf8').trim().split('\n').filter(Boolean).length
      : 0
  const cliReplies = (chatId) =>
    db
      .listMessages(chatId, undefined, 20)
      .filter((message) => message.sender_type === 'bot' && message.status === 'done')

  // 明确的传统 LLM 策略 + 没有判断用 Provider：群里没有判断引擎，只响应 @提及。
  const silent = db.createBot({
    name: 'CLI 静默',
    backend: 'codex-cli',
    cli_path: fakeCli,
    model: 'gpt-5.6-sol',
    response_decision_strategy: 'llm',
  })
  const silentGroup = db.createGroup('CLI 静默群', [silent.id])
  const beforeQuiet = cliCallCount()
  await orchestrator.sendUserMessage(silentGroup.id, '这条没有点名', [])
  assert(cliReplies(silentGroup.id).length === 0, '没有判断引擎的 CLI Bot 在群里保持安静')
  assert(
    cliCallCount() === beforeQuiet,
    '没有判断引擎时不会为每条群消息启动一次 CLI',
  )
  await orchestrator.sendUserMessage(silentGroup.id, '@CLI 静默 你来回答', [silent.id])
  assert(
    cliCallCount() > beforeQuiet && cliReplies(silentGroup.id).length === 1,
    '@提及仍会强制没有判断引擎的 CLI Bot 发言',
  )
  db.deleteBot(silent.id)

  // 默认 auto + 已配置 Jev：判断交给 Jev，不需要判断用 Provider。
  const autoBot = db.createBot({
    name: 'CLI 自动',
    backend: 'codex-cli',
    cli_path: fakeCli,
    model: 'gpt-5.6-sol',
  })
  assert(autoBot.response_decision_strategy === 'auto', 'CLI Bot 默认使用自动判断策略')
  const autoGroup = db.createGroup('CLI 自动群', [autoBot.id])
  const beforeAuto = cliCallCount()
  await orchestrator.sendUserMessage(autoGroup.id, '这条没有点名也要判断', [])
  assert(
    cliReplies(autoGroup.id).length === 1 && cliCallCount() > beforeAuto,
    'auto 策略在 Jev 已配置时让 CLI Bot 正常参与群聊',
  )
  db.deleteBot(autoBot.id)
  delete process.env.COVAN_FAKE_CLI_LOG
}

console.log('\n[5] 记忆：手动写入 + 自动提取触发')
const mem = db.addMemory(botA.id, '用户偏好中文交流', 'preference', 'manual')
assert(
  db.listMemories(botA.id).some((m) => m.id === mem.id),
  '记忆表手动写入成功',
)
// 每个 bot 每 chat 累计 10 条新消息触发自动提取；每轮群发言 = 1(user)+3(bot) = 4 条
// 再来 2 轮群消息（累计 4+4+4=12 >= 10）触发 mock 自动提取
events.length = 0
await orchestrator.sendUserMessage(group.id, '第二轮：成本方面呢？', [])
await orchestrator.sendUserMessage(group.id, '第三轮：排期怎么走？', [])
await sleep(500) // 自动提取是后台异步的
const autoMems = db.listMemories(botB.id).filter((m) => m.source === 'auto')
assert(autoMems.length > 0, `bot B 自动记忆已写入（${autoMems.length} 条）`)

console.log('\n[6] listChats 摘要')
const summaries = db.listChats()
const g = summaries.find((c) => c.id === group.id)
assert(
  !!g &&
    g.member_bots.length === 3 &&
    g.preview.length > 0 &&
    g.background_image === group.background_image,
  '群聊摘要含成员、预览与背景',
)

console.log('\n[7] 邀请 / 隐藏 / 清空聊天记录')
const botD = db.createBot({ name: '研究员小D', provider_id: provider.id })
db.addChatMembers(group.id, [botD.id])
assert(
  db.listMemberBots(group.id).some((bot) => bot.id === botD.id),
  '邀请 Bot 加入既有群聊',
)
db.clearChatMessages(dm.id)
assert(
  db.listMessages(dm.id, undefined, 10).length === 0 &&
    db.getChat(dm.id).last_message_at === 0 &&
    db.getLatestChatTopic(dm.id) === null,
  '清空聊天记录不删除单聊，并同步清除话题边界',
)
db.hideChat(dm.id)
assert(
  !db.listChats().some((chat) => chat.id === dm.id),
  '隐藏单聊后不在列表显示',
)
assert(
  db.createDm(botB.id).id === dm.id &&
    db.listChats().some((chat) => chat.id === dm.id),
  '从我的 Bot 再次打开会恢复显示',
)

await runMemoryRegression(db, memory, assert, userData)

fs.rmSync(tmp, { recursive: true, force: true })
fs.rmSync(bundleDir, { recursive: true, force: true })
if (failures > 0) {
  console.error(`\n冒烟失败：${failures} 项断言未通过`)
  process.exit(1)
}
console.log('\n冒烟通过 ✔')
process.exit(0)
