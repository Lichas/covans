// main/orchestrator.ts — 群聊编排协议（SPEC §5）+ 单聊直调
// 事件推送通过注入的 emit(CovanEvent) 完成，本模块不 import electron。
import type {
  AssistantMessage,
  Message as PiMessage,
  Usage,
} from '@earendil-works/pi-ai'
import type { Attachment, Bot, CovanEvent, Message } from '../shared/types'
import { imageContent, validateChatImages } from './chatImages'
import * as db from './db'
import { abortChat, completeOnce, runAgent } from './agentRuntime'
import { buildSystemPrompt, noteNewMessages, recallChatMemories, type GroupContext } from './memory'
import { emitEvent as emit, setEventEmitter } from './events'
import { classifyObservationError, observe } from './observability'

export type EmitFn = (ev: CovanEvent) => void

/** 注入事件推送函数（index.ts 注入 webContents 广播；冒烟脚本注入收集器） */
export function initOrchestrator(deps: { emit: EmitFn }): void {
  setEventEmitter(deps.emit)
}

// ---------- 历史重建 ----------

const ZERO_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
}

/**
 * 从 messages 表重建 pi 历史（SPEC §8：user/bot→user/assistant 交替，bot 名字前缀保留在文本里）：
 * - user → user（原文）
 * - 自己发的 bot 消息 → assistant
 * - 其他 bot / system → user（带 [名字] 前缀）
 */
function toPiHistory(messages: Message[], self: Bot): PiMessage[] {
  const out: PiMessage[] = []
  for (const m of messages) {
    if (m.sender_type === 'user') {
      out.push({
        role: 'user',
        content: [
          { type: 'text', text: m.content || '请查看这些图片。' },
          ...m.attachments.map(imageContent),
        ],
        timestamp: m.created_at,
      })
    } else if (m.sender_type === 'bot' && m.sender_bot_id === self.id) {
      const assistant: AssistantMessage = {
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: m.content || (m.attachments.length ? '[已发送图片]' : ''),
          },
        ],
        api: 'openai-completions',
        provider: 'covan-history',
        model: 'history',
        usage: ZERO_USAGE,
        stopReason: 'stop',
        timestamp: m.created_at,
      }
      out.push(assistant)
      if (m.attachments.length)
        out.push({
          role: 'user',
          content: [
            {
              type: 'text',
              text: '[历史图片：这是你此前回复中生成的图片，不是新的用户请求]',
            },
            ...m.attachments.map(imageContent),
          ],
          timestamp: m.created_at,
        })
    } else if (m.sender_type === 'bot') {
      const name =
        (m.sender_bot_id && db.getBot(m.sender_bot_id)?.name) || 'Bot'
      out.push({
        role: 'user',
        content: [
          { type: 'text', text: `[${name}]: ${m.content}` },
          ...m.attachments.map(imageContent),
        ],
        timestamp: m.created_at,
      })
    } else {
      out.push({
        role: 'user',
        content: `[系统]: ${m.content}`,
        timestamp: m.created_at,
      })
    }
  }
  return out
}

/** 群聊 transcript（最近 30 条，`[名字]: 内容`），供前文总结 */
function buildTranscript(chatId: string): string {
  return db
    .listRecentMessages(chatId, 30)
    .map((m) => {
      const who =
        m.sender_type === 'user'
          ? '用户'
          : m.sender_type === 'system'
            ? '系统'
            : (m.sender_bot_id && db.getBot(m.sender_bot_id)?.name) || 'Bot'
      return `[${who}]: ${m.content}`
    })
    .join('\n')
}

// ---------- 主流程 ----------

/**
 * 处理用户消息（dm / group 统一入口，SPEC §5）。
 * 立即返回；bot 生成在后台异步推进，通过事件推送进度。
 */
export async function sendUserMessage(
  chatId: string,
  content: string,
  mentions: string[] = [],
  attachments: Attachment[] = [],
): Promise<void> {
  const chat = db.getChat(chatId)
  if (!chat) throw new Error('会话不存在')
  const running = turns.get(chatId)
  if (running) {
    if (running.signal.aborted) throw new Error('当前会话正在停止')
    const session = groupSessions.get(chatId)
    if (chat.type !== 'group' || !session)
      throw new Error('当前会话正在回复，请稍后再发送')
    appendUserMessage(
      chatId,
      content,
      mentions,
      validateChatImages(attachments),
    )
    session.revision += 1
    for (const botId of mentions) session.forcedMentions.add(botId)
    for (const controller of session.decisions) controller.abort()
    return
  }
  const controller = new AbortController()
  turns.set(chatId, controller)
  if (chat.type === 'group')
    groupSessions.set(chatId, {
      revision: 0,
      decisions: new Set(),
      forcedMentions: new Set(mentions),
    })
  emit({ type: 'generation-state', chatId, generating: true })
  try {
    await runTurn(
      chatId,
      content,
      mentions,
      controller.signal,
      validateChatImages(attachments),
    )
  } catch (e) {
    if (!controller.signal.aborted && db.getChat(chatId)) {
      const message = db.insertMessage({
        chat_id: chatId,
        sender_type: 'system',
        content: `出错了：${e instanceof Error ? e.message : String(e)}`,
      })
      emit({ type: 'system-message', chatId, message })
    }
    throw e
  } finally {
    groupSessions.delete(chatId)
    turns.delete(chatId)
    emit({ type: 'generation-state', chatId, generating: false })
    emit({ type: 'chat-updated', chatId })
  }
}

const turns = new Map<string, AbortController>()
/** 首轮 + 最多四轮基于成员发言的延展讨论，避免群聊无限自我续聊。 */
const MAX_GROUP_DISCUSSION_ROUNDS = 5
const MAX_NATURAL_FOLLOW_UPS = 2
const MAX_NATURAL_FOLLOW_UP_CHARS = 240
interface GroupSession {
  revision: number
  decisions: Set<AbortController>
  forcedMentions: Set<string>
}
const groupSessions = new Map<string, GroupSession>()

export function isTurnRunning(chatId: string): boolean {
  return turns.has(chatId)
}

export function stopTurn(chatId: string): void {
  turns.get(chatId)?.abort()
  for (const controller of groupSessions.get(chatId)?.decisions ?? [])
    controller.abort()
  abortChat(chatId)
}

function appendUserMessage(
  chatId: string,
  content: string,
  mentions: string[],
  attachments: Attachment[],
): void {
  const text = content.trim()
  if (!text && !attachments.length) throw new Error('消息内容不能为空')
  db.insertMessage({
    chat_id: chatId,
    sender_type: 'user',
    content: text,
    attachments,
    mentions,
  })
  db.touchChat(chatId, Date.now())
  emit({ type: 'chat-updated', chatId })
}

async function runTurn(
  chatId: string,
  content: string,
  mentions: string[],
  signal: AbortSignal,
  attachments: Attachment[],
): Promise<void> {
  const chat = db.getChat(chatId)
  if (!chat) throw new Error('会话不存在')
  const text = content.trim()

  const members = db.listMemberBots(chatId)
  if (members.length === 0) throw new Error('会话内没有 Bot 成员')

  // 1. 落库用户消息；发 chat-updated
  appendUserMessage(chatId, content, mentions, attachments)
  let newMessageCount = 1

  if (chat.type === 'dm') {
    const bot =
      (chat.bot_id && members.find((b) => b.id === chat.bot_id)) || members[0]
    const replied = await speakOne(
      chat.id,
      bot,
      text,
      '',
      undefined,
      signal,
      30,
      naturalFollowUpEnabled()
        ? [
            '<<natural-followup-primary>>',
            '请用即时聊天的节奏回答。若内容较长且适合多条消息，本条只发送一个自然完整的小段，把其余非重复内容留给最多两条后续消息；不要先一次说完再复述，也不要预告或解释分段。若一条即可清楚回答，就在本条完整回答。',
          ].join('\n\n')
        : '',
    )
    if (replied) {
      newMessageCount += 1
      newMessageCount += await runNaturalFollowUps(chat.id, bot, signal)
    }
  } else if (chat.reply_mode === 'active') {
    newMessageCount += await runActiveGroup(chat.id, members, signal)
  } else {
    newMessageCount += await runSequentialGroup(chat.id, members, signal)
  }

  if (!signal.aborted) {
    noteNewMessages(
      chatId,
      members.map((m) => m.id),
      newMessageCount,
    )
    if (chat.type === 'group') void refreshGroupSummary(chat.id, members)
  }
}

function groupContext(chatId: string, members: Bot[]): GroupContext {
  return {
    chatName: db.getChat(chatId)?.name ?? '群聊',
    otherMembers: members.map((member) => ({
      id: member.id,
      name: member.name,
    })),
  }
}

function groupReviewRules(): string {
  if (db.getSetting('auto_review') !== '1') return ''
  const rules = db.getSetting('review_rules').trim()
  return rules ? `## 群聊发言规则\n${rules}` : ''
}

function decisionTranscript(chatId: string): string {
  const chat = db.getChat(chatId)
  const latest = db.listRecentMessages(chatId, 5)
  const lines = latest.map((message) => {
    const who =
      message.sender_type === 'user'
        ? '用户'
        : message.sender_type === 'bot'
          ? db.getBot(message.sender_bot_id ?? '')?.name ?? 'Bot'
          : '系统'
    const images = message.attachments.length
      ? `（附 ${message.attachments.length} 张图片）`
      : ''
    return `[${who}] ${message.content}${images}`
  })
  return `前文总结：\n${chat?.context_summary || '暂无'}\n\n最新 5 条消息：\n${lines.join('\n')}`
}

async function shouldReply(
  chatId: string,
  bot: Bot,
  forced: boolean,
  signal: AbortSignal,
  round: number,
): Promise<boolean> {
  emit({ type: 'agent-activity', chatId, botId: bot.id, state: 'preparing' })
  try {
    try {
      const raw = await completeOnce(
        bot,
        [
          buildSystemPrompt(
            bot,
            recallChatMemories(bot.id, chatId),
            groupContext(chatId, db.listMemberBots(chatId)),
          ),
          groupReviewRules(),
          '<<group-reply-decision>>',
          '你正在群聊中判断是否应该发言。根据前文总结和最新 5 条消息独立判断。',
          `当前是本次话题的第 ${round} 轮（最多 ${MAX_GROUP_DISCUSSION_ROUNDS} 轮）。`,
          round > 1
            ? '这是一轮延展讨论。只有能补充新信息、回应其他成员的具体观点、提出有价值的异议或推进未解决问题时才回复；复述、附和或换句话重复时必须 SKIP。'
            : '首轮请优先直接回应用户的话题。',
          '需要回应时只输出 REPLY；没有新价值、与自己无关或别人已充分回答时只输出 SKIP。',
          '被用户直接点名时必须回复。不要在判断阶段输出正式回答。',
        ].join('\n\n'),
        decisionTranscript(chatId),
        { signal, reasoning: 'low', maxTokens: 32, temperature: 0 },
      )
      return forced || !/^\s*SKIP\b/i.test(raw)
    } catch (error) {
      if (signal.aborted) throw error
      // 判断请求失败时仍让 Bot 尝试正式回复，由消息气泡展示具体错误。
      return true
    }
  } finally {
    emit({ type: 'agent-activity', chatId, botId: bot.id, state: 'idle' })
  }
}

async function speakWithActivity(
  chatId: string,
  bot: Bot,
  members: Bot[],
  signal: AbortSignal,
  round: number,
): Promise<boolean> {
  emit({ type: 'agent-activity', chatId, botId: bot.id, state: 'speaking' })
  try {
    const latestUser = [...db.listRecentMessages(chatId, 5)]
      .reverse()
      .find((message) => message.sender_type === 'user')
    return await speakOne(
      chatId,
      bot,
      latestUser?.content ?? '',
      db.getChat(chatId)?.context_summary
        ? `请结合此前总结：${db.getChat(chatId)!.context_summary}`
        : '',
      groupContext(chatId, members),
      signal,
      5,
      round > 1
        ? `这是本次话题的第 ${round} 轮延展讨论。只说能推进讨论的新内容：补充事实、回应具体观点、提出有依据的异议或收敛下一步。不要复述、客套附和或重复自己的上一轮。`
        : '',
    )
  } finally {
    emit({ type: 'agent-activity', chatId, botId: bot.id, state: 'idle' })
  }
}

async function runSequentialGroup(
  chatId: string,
  members: Bot[],
  signal: AbortSignal,
): Promise<number> {
  let repliedTotal = 0
  for (let round = 1; round <= MAX_GROUP_DISCUSSION_ROUNDS; round++) {
    const replied = await runSequentialRound(chatId, members, signal, round)
    repliedTotal += replied
    if (signal.aborted || replied === 0) return repliedTotal
  }
  return repliedTotal
}

async function runSequentialRound(
  chatId: string,
  members: Bot[],
  signal: AbortSignal,
  round: number,
): Promise<number> {
  const session = groupSessions.get(chatId)
  if (!session) return 0
  const forced = round === 1 ? session.forcedMentions : new Set<string>()
  const ordered = [
    ...members.filter((member) => forced.has(member.id)),
    ...members.filter((member) => !forced.has(member.id)),
  ]
  let replied = 0
  for (const bot of ordered) {
    if (signal.aborted) return replied
    if (await decideWithLatestContext(chatId, bot, signal, round)) {
      replied += 1
      await speakWithActivity(chatId, bot, members, signal, round)
    }
  }
  return replied
}

async function runActiveGroup(
  chatId: string,
  members: Bot[],
  signal: AbortSignal,
): Promise<number> {
  const session = groupSessions.get(chatId)
  if (!session) return 0
  let repliedTotal = 0
  for (let round = 1; round <= MAX_GROUP_DISCUSSION_ROUNDS; round++) {
    const replied = await runActiveRound(chatId, members, signal, round)
    repliedTotal += replied
    if (signal.aborted || replied === 0) return repliedTotal
  }
  return repliedTotal
}

async function runActiveRound(
  chatId: string,
  members: Bot[],
  signal: AbortSignal,
  round: number,
): Promise<number> {
  const session = groupSessions.get(chatId)
  if (!session) return 0
  while (!signal.aborted) {
    const revision = session.revision
    const decisions = await Promise.all(
      members.map((bot) => decideWithLatestContext(chatId, bot, signal, round)),
    )
    if (signal.aborted) return 0
    if (session.revision !== revision) continue
    const speakers = members.filter((_, index) => decisions[index])
    await Promise.all(speakers.map((bot) => speakWithActivity(chatId, bot, members, signal, round)))
    if (session.revision === revision) return speakers.length
  }
  return 0
}

/**
 * 成员正在判断时收到新用户消息，取消过期请求并用最新上下文重试。
 * 主动与顺序模式共用这个修订号边界，避免过期判断触发幽灵回复。
 */
async function decideWithLatestContext(
  chatId: string,
  bot: Bot,
  signal: AbortSignal,
  round: number,
): Promise<boolean> {
  const session = groupSessions.get(chatId)
  if (!session) return false
  while (!signal.aborted) {
    const revision = session.revision
    const controller = new AbortController()
    session.decisions.add(controller)
    try {
      const reply = await shouldReply(
        chatId,
        bot,
        round === 1 && session.forcedMentions.has(bot.id),
        AbortSignal.any([signal, controller.signal]),
        round,
      )
      if (session.revision === revision) return reply
    } catch {
      if (signal.aborted) return false
      // 补充消息导致的取消由循环重试；普通判断错误已在 shouldReply 内降级为正式回复。
      if (session.revision === revision) return false
    } finally {
      session.decisions.delete(controller)
    }
  }
  return false
}

function naturalFollowUpEnabled(): boolean {
  // 新安装默认开启；用户显式关闭后才不续发。
  return db.getSetting('natural_follow_up') !== '0'
}

function normalizeForComparison(content: string): string {
  return content.toLocaleLowerCase().replace(/[\p{P}\p{S}\s]/gu, '')
}

function substantiallyRepeatsRecentReply(
  candidate: string,
  recentReplies: Message[],
): boolean {
  const normalized = normalizeForComparison(candidate)
  if (normalized.length < 12) return false
  return recentReplies.some((message) => {
    const previous = normalizeForComparison(message.content)
    if (!previous) return false
    if (previous.includes(normalized) || normalized.includes(previous)) return true
    const sharedLength = Math.min(18, normalized.length)
    for (let index = 0; index <= normalized.length - sharedLength; index++) {
      if (previous.includes(normalized.slice(index, index + sharedLength)))
        return true
    }
    return false
  })
}

type FollowUpCandidate = {
  content: string | null
  outcome:
    | 'accepted'
    | 'skip'
    | 'invalid_format'
    | 'empty'
    | 'too_long'
    | 'meta_language'
    | 'duplicate'
}

function parseNaturalFollowUpCandidate(
  raw: string,
  recentReplies: Message[],
): FollowUpCandidate {
  const trimmed = raw.trim()
  if (/^SKIP\b/i.test(trimmed)) return { content: null, outcome: 'skip' }
  const match = trimmed.match(/^REPLY(?:\s*[:：]\s*|\s*\n+)([\s\S]+)$/i)
  if (!match) return { content: null, outcome: 'invalid_format' }
  const candidate = match[1].trim().replace(/\s*\n\s*/g, ' ')
  if (!candidate) return { content: null, outcome: 'empty' }
  if (candidate.length > MAX_NATURAL_FOLLOW_UP_CHARS)
    return { content: null, outcome: 'too_long' }
  if (
    /(重新来|重发|分段回复|一段一段|下一条(?:来了|再|会|我)|(?:这|上|下)一条消息|接着发|继续发送|待续|别催|回复机制|自然追问)/i.test(
      candidate,
    )
  )
    return { content: null, outcome: 'meta_language' }
  if (substantiallyRepeatsRecentReply(candidate, recentReplies))
    return { content: null, outcome: 'duplicate' }
  return { content: candidate, outcome: 'accepted' }
}

async function draftNaturalFollowUp(
  chatId: string,
  bot: Bot,
  signal: AbortSignal,
  index: number,
): Promise<string | null> {
  try {
    const recentReplies = db
      .listRecentMessages(chatId, 5)
      .filter(
        (message) =>
          message.sender_type === 'bot' && message.sender_bot_id === bot.id,
      )
    const raw = await completeOnce(
      bot,
      [
        buildSystemPrompt(bot, recallChatMemories(bot.id, chatId)),
        '<<natural-followup-draft>>',
        `你刚刚在私聊中已经回复过用户。现在判断是否值得发送第 ${index + 1} 条独立短跟进，并同时起草它。默认选择 SKIP。`,
        '只有上一条明确只完成了较长回答的一部分且本条能推进新的内容、确实遗漏了一个重要具体信息，或存在必须由用户回答才能继续的明确问题时，才选择 REPLY。前一条已经完整、只能复述改写、寒暄、泛泛关心时必须 SKIP。',
        '跟进不得复述或改写已经发送的内容，不得提到上一条、下一条、重新发送、分段、追问或任何内部回复机制。正文最多两句、240 字。',
        '只允许输出以下两种格式之一：\nSKIP\nREPLY\n<一条可直接展示给用户的短消息>',
      ].join('\n\n'),
      decisionTranscript(chatId),
      { signal, reasoning: 'low', maxTokens: 180, temperature: 0 },
    )
    const parsed = parseNaturalFollowUpCandidate(raw, recentReplies)
    observe('followup.candidate.evaluated', {
      chat_id: chatId,
      bot_id: bot.id,
      iteration: index + 1,
      outcome: parsed.outcome,
      raw_chars: raw.length,
      candidate_chars: parsed.content?.length ?? 0,
      recent_reply_count: recentReplies.length,
    })
    return parsed.content
  } catch (error) {
    observe('followup.candidate.failed', {
      chat_id: chatId,
      bot_id: bot.id,
      iteration: index + 1,
      error_code: classifyObservationError(error),
    })
    // 追问是体验增强，判断失败时不影响已经完成的主回复。
    return null
  }
}

function publishNaturalFollowUp(
  chatId: string,
  bot: Bot,
  content: string,
): void {
  const placeholder = db.insertMessage({
    chat_id: chatId,
    sender_type: 'bot',
    sender_bot_id: bot.id,
    content: '',
    status: 'streaming',
  })
  emit({ type: 'message-start', chatId, message: placeholder })
  emit({
    type: 'message-delta',
    chatId,
    messageId: placeholder.id,
    delta: content,
  })
  const message = db.updateMessage(placeholder.id, { content, status: 'done' })
  db.touchChat(chatId, Date.now(), true)
  emit({ type: 'message-done', chatId, message })
  emit({ type: 'chat-updated', chatId })
  observe('followup.message.published', {
    chat_id: chatId,
    bot_id: bot.id,
    output_chars: content.length,
  })
}

async function runNaturalFollowUps(
  chatId: string,
  bot: Bot,
  signal: AbortSignal,
): Promise<number> {
  if (!naturalFollowUpEnabled()) return 0
  let sentCount = 0
  for (let index = 0; index < MAX_NATURAL_FOLLOW_UPS; index++) {
    if (signal.aborted) return sentCount
    const candidate = await draftNaturalFollowUp(chatId, bot, signal, index)
    if (signal.aborted || !candidate || !db.getChat(chatId)) return sentCount
    publishNaturalFollowUp(chatId, bot, candidate)
    sentCount += 1
  }
  return sentCount
}

async function refreshGroupSummary(
  chatId: string,
  members: Bot[],
): Promise<void> {
  const bot = members[0]
  const chat = db.getChat(chatId)
  if (!bot || !chat) return
  const recent = db.listRecentMessages(chatId, 20)
  if (recent.length <= 5) return
  const newestMessageId = recent.at(-1)?.id
  try {
    const summary = await completeOnce(
      bot,
      '把群聊压缩成中立、准确的前文总结，保留人物立场、决定和未解决问题。只输出总结，不超过500字。',
      `${chat.context_summary ? `已有总结：${chat.context_summary}\n\n` : ''}${buildTranscript(chatId)}`,
      { reasoning: 'off', maxTokens: 700, temperature: 0 },
    )
    if (db.listRecentMessages(chatId, 1).at(-1)?.id === newestMessageId)
      db.updateChatSummary(chatId, summary)
  } catch {
    // 总结失败不影响聊天主流程。
  }
}

async function speakOne(
  chatId: string,
  bot: Bot,
  userText: string,
  hint: string,
  groupContext?: GroupContext,
  signal?: AbortSignal,
  historyLimit = 30,
  responseInstruction = '',
): Promise<boolean> {
  const memories = recallChatMemories(bot.id, chatId)
  const ctx: GroupContext | undefined = groupContext
    ? {
        ...groupContext,
        otherMembers: groupContext.otherMembers.filter((m) => m.id !== bot.id),
      }
    : undefined
  const systemPrompt = [
    buildSystemPrompt(bot, memories, ctx),
    ctx ? groupReviewRules() : '',
    responseInstruction,
  ]
    .filter(Boolean)
    .join('\n\n')

  // 截取指定条数的历史；hint 作为最后一条真实用户消息的补充上下文。
  const recent = db.listRecentMessages(chatId, historyLimit)
  let userIdx = -1
  for (let i = recent.length - 1; i >= 0; i--) {
    if (recent[i].sender_type === 'user') {
      userIdx = i
      break
    }
  }
  if (hint && userIdx >= 0) {
    recent[userIdx] = {
      ...recent[userIdx],
      content: `（补充上下文：${hint}）\n${userText}`,
    }
  }
  const history = toPiHistory(recent, bot)

  // 先落一条 streaming 占位消息
  const placeholder = db.insertMessage({
    chat_id: chatId,
    sender_type: 'bot',
    sender_bot_id: bot.id,
    content: '',
    status: 'streaming',
  })
  emit({ type: 'message-start', chatId, message: placeholder })

  let acc = ''
  let completed = false
  await runAgent(
    chatId,
    bot,
    history,
    {
      onImages: (images) => {
        const current = db.getMessage(placeholder.id)!
        const msg = db.updateMessage(placeholder.id, {
          content: acc,
          attachments: [...current.attachments, ...images],
        })
        emit({ type: 'message-start', chatId, message: msg })
      },
      onArtifact: (artifact) => {
        const current = db.getMessage(placeholder.id)!
        const artifacts = [
          ...current.artifacts.filter((item) => item.relPath !== artifact.relPath),
          artifact,
        ]
        const msg = db.updateMessage(placeholder.id, {
          content: acc,
          artifacts,
        })
        emit({ type: 'message-start', chatId, message: msg })
        emit({ type: 'workspace-updated', botId: bot.id })
      },
      onWorkspaceChanged: () => {
        emit({ type: 'workspace-updated', botId: bot.id })
      },
      onDelta: (delta) => {
        acc += delta
        emit({
          type: 'message-delta',
          chatId,
          messageId: placeholder.id,
          delta,
        })
      },
      onDone: (full) => {
        const finalContent = full || acc
        const msg = db.updateMessage(placeholder.id, {
          content: finalContent,
          status: 'done',
        })
        db.touchChat(chatId, Date.now(), true)
        emit({ type: 'message-done', chatId, message: msg })
        emit({ type: 'chat-updated', chatId })
        observe('message.completed', {
          chat_id: chatId,
          bot_id: bot.id,
          phase: responseInstruction.includes('<<natural-followup-primary>>')
            ? 'dm_primary'
            : ctx
              ? 'group'
              : 'dm',
          output_chars: finalContent.length,
          continuation_cue:
            /(下一条|下条|接着发|继续发|待续|to be continued)/i.test(
              finalContent,
            ),
        })
        completed = true
      },
      onError: (error) => {
        const msg = db.updateMessage(placeholder.id, {
          content: acc,
          status: 'error',
          error,
        })
        emit({ type: 'message-done', chatId, message: msg })
        emit({ type: 'chat-updated', chatId })
        observe('message.failed', {
          chat_id: chatId,
          bot_id: bot.id,
          phase: responseInstruction.includes('<<natural-followup-primary>>')
            ? 'dm_primary'
            : ctx
              ? 'group'
              : 'dm',
          partial_chars: acc.length,
          error_code: classifyObservationError(error),
        })
      },
    },
    { systemPrompt, signal },
  )
  if (signal?.aborted && db.getChat(chatId)) {
    const msg = db.updateMessage(placeholder.id, {
      content: acc,
      status: 'stopped',
    })
    emit({ type: 'message-done', chatId, message: msg })
  }
  return completed
}
