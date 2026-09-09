// scripts/smoke.mjs — 纯 Node 冒烟测试（不启动 Electron）
// 用 esbuild 把真实 main/ 模块（db/orchestrator/memory/agentRuntime/mockProvider/workspace）
// 打成临时 ESM bundle（node_modules 依赖保持 external），在临时目录建库后走一遍：
//   mock provider → 建 bot A/B/C → 建群 → sendUserMessage 编排 → 断言事件与落库。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

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

// 2. 初始化（临时目录，WAL）
db.initDb(userData)
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
  ]) {
    assert(tables.includes(t), `表 ${t} 已创建`)
  }
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
assert(botB.reasoning_effort === 'off', '普通 Bot 默认关闭推理')
assert(kimiBot.reasoning_effort === 'high', 'Kimi Bot 保留高推理默认值')
db.deleteBot(kimiBot.id)
assert(db.listBots().length === 3, '3 个 bot 已创建')
workspace.ensureWorkspace(botA.id)
assert(
  fs.existsSync(path.join(userData, 'workspaces', botA.id)),
  'bot A 工作区目录已创建',
)

console.log('\n[3] 建群（默认顺序回复）并发送用户消息')
const group = db.createGroup('冒烟讨论组', [botA.id, botB.id, botC.id])
assert(group.type === 'group', '群聊已创建')
assert(group.reply_mode === 'sequential', '新群默认使用顺序回复')
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
  const active = db.createGroup('主动回复冒烟组', [
    botA.id,
    botB.id,
    botC.id,
  ])
  db.updateChat(active.id, { replyMode: 'active' })
  assert(db.getChat(active.id).reply_mode === 'active', '可切换为主动回复')
  const running = orchestrator.sendUserMessage(
    active.id,
    '第一条：你们怎么看？',
    [],
  )
  await sleep(5)
  await orchestrator.sendUserMessage(
    active.id,
    '补充：请优先考虑可靠性。',
    [],
  )
  await running
  const activeMessages = db.listMessages(active.id, undefined, 100)
  assert(
    activeMessages.filter((message) => message.sender_type === 'user')
      .length === 2,
    '思考中的新消息会立即落库',
  )
  assert(
    activeMessages.filter(
      (message) =>
        message.sender_type === 'bot' && message.status === 'done',
    ).length === 3,
    '三位成员并发判断后完成回复',
  )
  const preparing = events.filter(
    (event) => event.type === 'agent-activity' && event.state === 'preparing',
  )
  assert(
    preparing.length >= 6,
    '新消息使尚未完成的三个判断重新开始',
  )
}

console.log('\n[4] 单聊（dm）直调')
const dm = db.createDm(botB.id)
await orchestrator.sendUserMessage(dm.id, '帮我看看这个用例怎么写', [])
const dmMsgs = db.listMessages(dm.id, undefined, 50)
assert(
  dmMsgs.some((m) => m.sender_bot_id === botB.id && m.status === 'done'),
  'dm 中 bot B 产生 done 消息',
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
  !!g && g.member_bots.length === 3 && g.preview.length > 0,
  '群聊摘要含成员与预览',
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

fs.rmSync(tmp, { recursive: true, force: true })
fs.rmSync(bundleDir, { recursive: true, force: true })
if (failures > 0) {
  console.error(`\n冒烟失败：${failures} 项断言未通过`)
  process.exit(1)
}
console.log('\n冒烟通过 ✔')
process.exit(0)
