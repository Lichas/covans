// scripts/smoke.mjs — 纯 Node 冒烟测试（不启动 Electron）
// 用 esbuild 把真实 main/ 模块（db/orchestrator/memory/agentRuntime/mockProvider/workspace）
// 打成临时 ESM bundle（node_modules 依赖保持 external），在临时目录建库后走一遍：
//   mock provider → 建 bot A/B/C → 建群 → sendUserMessage 编排 → 断言事件与落库。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
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

// 2. 初始化（临时目录，WAL）
db.initDb(userData)
observability.initObservability(userData)
db.setSetting('local_observability', '1')
workspace.initWorkspace(userData)
const events = []
orchestrator.initOrchestrator({ emit: (ev) => events.push(ev) })

console.log('\n[1] 建库 & migration')
{
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
    'memories',
    'settings',
    'scheduled_tasks',
  ]) {
    assert(tables.includes(t), `表 ${t} 已创建`)
  }
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
assert(kimiBot.reasoning_effort === 'medium', 'Kimi Bot 默认也使用中等推理')
assert(kimiBot.max_tokens === 8192, 'Kimi Bot 默认最大输出为 8192 Token')
db.deleteBot(kimiBot.id)
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

console.log('\n[4a] 定时 Agent 任务：持久化、工具与消息投递')
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

console.log('\n[4c] 群聊延展讨论：有新观点才进入下一轮，最多五轮')
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
    db.getChat(dm.id).last_message_at === 0,
  '清空聊天记录不删除单聊',
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
