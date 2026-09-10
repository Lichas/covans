// Deterministic fixtures only; invoked from smoke against its temporary profile.
export async function runMemoryRegression(db, memory, assert, profile) {
  console.log('\n[8] 分层记忆与跨会话回归')
  const provider = db.saveProvider({ name: 'Memory Mock', kind: 'mock', api_key: '', base_url: '', default_model: 'mock' })
  const a = db.createBot({ name: '猛男记忆测试', provider_id: provider.id })
  const b = db.createBot({ name: 'ds记忆测试', provider_id: provider.id })
  const c = db.createBot({ name: '未参与者记忆测试', provider_id: provider.id })
  const dmA = db.createDm(a.id)
  const dmB = db.createDm(b.id)
  const thread = db.createAgentThread(dmA.id, '', a.id, b.id, '天空来源')
  const question = db.addAgentPrivateMessage(thread.id, a.id, '橙色的天空来自意大利')
  const reply = db.addAgentPrivateMessage(thread.id, b.id, '', 'streaming')
  const owns = (id, source) => db.listMemories(id).filter((m) => m.source_id === source)
  assert(owns(a.id, question.id).length === 1 && owns(b.id, question.id).length === 1, 'Bot 私聊问题送达即写入双方，无需等回复和归纳')
  assert(!owns(c.id, question.id).length, '未参与者不获得私聊记忆')
  db.updateAgentPrivateMessage(reply.id, '收到：来自意大利', 'done')
  db.updateAgentPrivateMessage(reply.id, '收到：来自意大利', 'done')
  assert(owns(a.id, reply.id).length === 1 && owns(b.id, reply.id).length === 1, '成功回复写入双方且重复完成不重复记忆')
  const failure = db.addAgentPrivateMessage(thread.id, b.id, '', 'streaming')
  db.updateAgentPrivateMessage(failure.id, '编造的未完成事实', 'error', 'fixture')
  const stopped = db.addAgentPrivateMessage(thread.id, b.id, '', 'streaming')
  db.updateAgentPrivateMessage(stopped.id, '停止的半句话', 'stopped')
  assert(!owns(a.id, failure.id).length && !owns(b.id, stopped.id).length, '失败与停止的残缺回复不写入记忆')

  const group = db.createGroup('记忆群', [a.id, b.id])
  db.getDb().exec("CREATE TEMP TRIGGER memory_failure BEFORE INSERT ON memories WHEN NEW.bot_id='" + b.id + "' BEGIN SELECT RAISE(ABORT, 'fixture memory failure'); END")
  let rolledBack = false
  try {
    db.insertMessage({ chat_id: group.id, sender_type: 'user', content: '不应留下半份记忆' })
  } catch { rolledBack = true }
  db.getDb().exec('DROP TRIGGER memory_failure')
  assert(rolledBack && !db.listMessages(group.id).length &&
    !db.listMemories(a.id).some((m) => m.content === '不应留下半份记忆'), '某成员记忆写入失败时，消息与所有成员副本一起回滚')
  const user = db.insertMessage({ chat_id: group.id, sender_type: 'user', content: '林小雨喜欢蓝色围巾' })
  assert(owns(a.id, user.id).length === 1 && owns(b.id, user.id).length === 1, '群聊全部成员即时记住用户消息')
  db.addChatMembers(group.id, [c.id])
  assert(!owns(c.id, user.id).length, '后加入成员不会获得加入前的记忆')
  const utterance = db.insertMessage({ chat_id: group.id, sender_type: 'bot', sender_bot_id: a.id, content: '本周五去图书馆' })
  assert([a, b, c].every((bot) => owns(bot.id, utterance.id).length === 1), '群内 Bot 发言写入全部当时参与者')
  const direct = db.insertMessage({ chat_id: dmB.id, sender_type: 'user', content: '请记住：我喜欢无糖咖啡' })
  assert(owns(b.id, direct.id).length === 1 && !owns(a.id, direct.id).length, '人和 Bot 单聊仅写入参与 Bot')

  // More than 30 newer distractions must not hide the private delivery.
  for (let i = 0; i < 65; i++)
    db.insertMessage({ chat_id: dmB.id, sender_type: 'user', content: '无关的日常闲聊编号 ' + i })
  const recalled = memory.recallChatMemories(b.id, dmB.id, '橙色的天空来自哪里')
  assert(recalled.some((m) => m.source_id === question.id), '旧私聊原话在 65 条新消息后仍按话题召回')
  const prompt = memory.buildSystemPrompt(b, recalled)
  assert(prompt.includes('橙色的天空来自意大利') && prompt.includes(a.name) && prompt.includes('"来源":"private"'), '接收方上下文包含原话、真实发言者与私聊来源')
  assert(!memory.recallMemories(c.id, { query: '橙色的天空' }).some((m) => m.source_id === question.id), '相同查询不会突破 Bot 记忆归属')
  assert(memory.recallMemories(b.id, { query: '林小雨' }).some((m) => m.source_id === user.id), '普通人名通过原文词法匹配召回')
  assert(memory.recallMemories(b.id, { query: a.name + '之前说了什么' }).some((m) => m.source_id === question.id), '提及 Bot 名称触发参与者相关召回')
  const longText = db.insertMessage({ chat_id: dmB.id, sender_type: 'user', content: '无关段落。'.repeat(1200) + '紫色飞船的密码提示是薰衣草。' })
  assert(memory.recallMemories(b.id, { query: '紫色飞船' }).some((m) => m.source_id === longText.id && m.content.includes('薰衣草')), '长原文末尾的相关片段可进入预算')
  const memoryPart = prompt.split('## 与当前交流相关的分层记忆\n')[1]
  assert(memoryPart.length < 7100 && recalled.length <= 30, '记忆注入有实际字符预算与条数上限')

  const evidence = owns(b.id, question.id)
  const item = { content: '猛男转达天空来自意大利', layer: 'semantic', source_id: question.id, quote: '橙色的天空来自意大利' }
  assert(memory.applyConsolidation(b.id, evidence, JSON.stringify([item])) === 1, '带有效原话与来源的语义归纳写入')
  assert(memory.applyConsolidation(b.id, evidence, JSON.stringify([item])) === 0, '相同归纳幂等去重')
  assert(memory.applyConsolidation(b.id, evidence, JSON.stringify([{ ...item, quote: '无中生有' }])) === 0, '无原文支持的归纳被拒绝')
  assert(memory.applyConsolidation(b.id, evidence, JSON.stringify([{ ...item, layer: 'long' }])) === 0, 'Bot 转述不能升级为用户长期意图')
  assert(memory.applyConsolidation(b.id, owns(b.id, direct.id), JSON.stringify([{
    content: '用户要求记住无糖咖啡偏好', layer: 'long', source_id: direct.id, quote: direct.content,
  }])) === 1, '用户明确记住的归纳进入长期层')
  const correction = db.insertMessage({ chat_id: dmB.id, sender_type: 'user', content: '更正：我不喜欢无糖咖啡了' })
  assert(memory.applyConsolidation(b.id, owns(b.id, correction.id), JSON.stringify([{
    content: '用户不喜欢无糖咖啡了', layer: 'semantic', source_id: correction.id, quote: correction.content,
  }])) === 1, '否定与更正不会被包含关系去重误删')
  const sceneSummary = { ...item, layer: 'episodic' }
  assert(memory.applyConsolidation(b.id, evidence, JSON.stringify([sceneSummary])) === 1, '场景归纳带独立来源标记写入')
  const before = db.listMemories(a.id).length
  await memory.consolidateMemories(a, thread.id, true)
  assert(db.listMemories(a.id).some((m) => m.representation === 'summary' && m.source_id === 'scene-summary:' + thread.id), '真实后台 completion 调用生成有证据的场景归纳')
  const shortSummary = db.listMemories(a.id).find((m) => m.representation === 'summary' && m.source_id === 'working-summary:' + thread.id)
  assert(shortSummary && shortSummary.content.length <= 80 && shortSummary.content !== question.content, '同一次归纳生成不照抄原文的极短工作摘要')
  const after = db.listMemories(a.id).length
  await memory.consolidateMemories(a, thread.id, true)
  assert(db.listMemories(a.id).length === after, '持久归纳游标防止同一场景重复处理')
  const queuedThread = db.createAgentThread(dmB.id, '', b.id, c.id, '并发归纳')
  const queuedMessage = db.addAgentPrivateMessage(queuedThread.id, b.id, '明天讨论图书馆计划')
  const activeJob = memory.consolidateMemories(b, thread.id, true)
  void memory.consolidateMemories(b, 'empty-scene', true)
  void memory.consolidateMemories(b, queuedThread.id, true)
  await activeJob
  for (let i = 0; i < 50 && !db.getSetting('memory_cursor:' + b.id + ':' + queuedThread.id); i++)
    await new Promise((resolve) => setTimeout(resolve, 10))
  assert(db.getSetting('memory_cursor:' + b.id + ':' + queuedThread.id) === queuedMessage.id, '同 Bot 并发场景排队，空场景不会阻塞后续私聊归纳')

  db.deleteMemory(evidence[0].id)
  assert(!db.listMemories(b.id).some((m) => m.evidence.includes(question.id)), '删除来源会同时忘记本 Bot 的所有衍生摘要')
  assert(owns(a.id, question.id).length === 1, '删除不影响另一位 Bot 的独立副本')
  assert(memory.applyConsolidation(b.id, evidence, JSON.stringify([item])) === 0, '后台慢任务不能复活已删除证据')
  db.updateAgentPrivateMessage(question.id, question.content, 'done')
  assert(!owns(b.id, question.id).length, '重复完成回调不能复活已删除记忆')

  const day = 86400000
  const now = Date.now()
  db.getDb().prepare('UPDATE memories SET created_at=? WHERE bot_id=? AND source_id=?').run(now - 2 * day, a.id, question.id)
  db.maintainMemories(a.id, now)
  assert(db.listMemories(a.id).find((m) => m.source_id === 'working-summary:' + thread.id)?.layer === 'short', '短时摘要保持工作层，原文证据独立存在')
  const manual = db.addMemory(a.id, '永久手动记忆')
  db.getDb().prepare("UPDATE memories SET expires_at=? WHERE bot_id=? AND source='auto' AND layer!='long'").run(now - 1, a.id)
  db.maintainMemories(a.id, now)
  assert(!owns(a.id, question.id).length && db.listMemories(a.id).some((m) => m.id === manual.id), '过期自动记忆淘汰，手动长期保留')
  const capacityBot = db.createBot({ name: '容量测试', provider_id: provider.id })
  const seed = { ...owns(b.id, user.id)[0], bot_id: capacityBot.id }
  db.getDb().transaction(() => {
    for (let i = 0; i < 2005; i++)
      db.writeMemory({ ...seed, source_id: 'capacity-' + i, content: '容量条目' + i, created_at: now + i })
  })()
  db.maintainMemories(capacityBot.id, now)
  assert(db.listMemories(capacityBot.id).length === 2000, '普通自动记忆容量限制为 2000 条')

  db.getDb().close()
  db.initDb(profile)
  assert(!owns(b.id, question.id).length, '重启不会再次回填已删除的私聊')
  assert(db.listMemories(a.id).some((m) => m.id === manual.id), '手动长期记忆跨重启保留')

  // Simulate a genuine old schema, without touching real user data.
  db.getDb().exec("DROP TABLE memories; CREATE TABLE memories (id TEXT PRIMARY KEY, bot_id TEXT NOT NULL REFERENCES bots(id), kind TEXT NOT NULL DEFAULT 'fact', content TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'auto', created_at INTEGER NOT NULL)")
  db.getDb().prepare('INSERT INTO memories VALUES (?,?,?,?,?,?)').run('legacy-memory', a.id, 'fact', '旧版手动记录', 'manual', now)
  db.getDb().prepare("DELETE FROM settings WHERE key='memory_v2_private_backfill'").run()
  db.getDb().close()
  db.initDb(profile)
  assert(db.listMemories(a.id).some((m) => m.id === 'legacy-memory' && m.layer === 'long'), '真实旧 schema additive migration 保留手动内容')
  assert(owns(a.id, question.id).length === 1 && owns(b.id, question.id).length === 1, '升级一次性补入旧私聊双方记忆')
  db.getDb().close()
  db.initDb(profile)
  assert(owns(b.id, question.id).length === 1, '重复启动迁移幂等')
}
